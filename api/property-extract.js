const dns = require("node:dns").promises;
const net = require("node:net");

const MAX_BYTES = 2000000;
const MAX_REDIRECTS = 4;

function isPrivateIp(ip) {
  if (!ip) return true;
  if (net.isIPv4(ip)) {
    const p = ip.split(".").map(Number);
    return p[0] === 10 ||
      p[0] === 127 ||
      (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      p[0] === 0;
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    return x === "::1" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe80:");
  }
  return true;
}

async function validatePublicUrl(raw) {
  let u;
  try { u = new URL(String(raw || "").trim()); }
  catch { throw new Error("Enter a valid property URL."); }

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only normal http or https property URLs are supported.");
  }
  if (!u.hostname || u.username || u.password) throw new Error("That URL cannot be used.");
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) throw new Error("Local addresses cannot be fetched.");

  const records = await dns.lookup(host, { all:true, verbatim:true });
  if (!records.length || records.some(r => isPrivateIp(r.address))) {
    throw new Error("That address cannot be fetched.");
  }
  return u;
}

async function fetchPage(raw, depth) {
  depth = depth || 0;
  if (depth > MAX_REDIRECTS) throw new Error("Too many redirects.");
  const u = await validatePublicUrl(raw);

  const response = await fetch(u, {
    redirect:"manual",
    headers:{
      "user-agent":"Mozilla/5.0 (compatible; RentReadyVIC/1.0; +https://rentready-vic.onrender.com)",
      "accept":"text/html,application/xhtml+xml"
    },
    signal:AbortSignal.timeout(12000)
  });

  if ([301,302,303,307,308].includes(response.status)) {
    const location = response.headers.get("location");
    if (!location) throw new Error("The listing redirected without a destination.");
    return fetchPage(new URL(location, u).href, depth + 1);
  }

  if (!response.ok) {
    if ([401,403,429].includes(response.status)) {
      throw new Error("This property website blocked automated access. You can still enter or paste the property details manually.");
    }
    throw new Error("The property page returned HTTP " + response.status + ".");
  }

  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) {
    throw new Error("That URL did not return a normal property webpage.");
  }

  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > MAX_BYTES) {
      try { await reader.cancel(); } catch {}
      break;
    }
    chunks.push(Buffer.from(part.value));
  }
  return { url:u.href, html:Buffer.concat(chunks).toString("utf8") };
}

function decodeHtml(s) {
  return String(s || "")
    .replace(/&nbsp;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'")
    .replace(/&lt;/gi,"<")
    .replace(/&gt;/gi,">")
    .replace(/&#(\d+);/g,function(_,n){ return String.fromCharCode(Number(n)); })
    .replace(/&#x([0-9a-f]+);/gi,function(_,n){ return String.fromCharCode(parseInt(n,16)); });
}

function getMeta(html, key) {
  const tags = String(html || "").match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const prop = (tag.match(/\b(?:property|name)=["']([^"']+)["']/i) || [])[1];
    if (!prop || prop.toLowerCase() !== String(key).toLowerCase()) continue;
    const content = (tag.match(/\bcontent=["']([^"']*)["']/i) || [])[1];
    if (content != null) return decodeHtml(content).trim();
  }
  return "";
}

function stripHtml(html) {
  return decodeHtml(
    String(html || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ")
      .replace(/<br\s*\/?>/gi,"\n")
      .replace(/<\/(?:p|div|li|section|article)\s*>/gi,"\n")
      .replace(/<[^>]+>/g," ")
  ).replace(/[ \t]+/g," ").replace(/\n\s+/g,"\n").replace(/\n{3,}/g,"\n\n").trim();
}

function firstNumber(text, patterns) {
  for (const re of patterns) {
    const m = String(text || "").match(re);
    if (m) return Number(String(m[1]).replace(/,/g,""));
  }
  return 0;
}

function jsonLd(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(decodeHtml(m[1]).trim());
      const queue = Array.isArray(parsed) ? parsed.slice() : [parsed];
      while (queue.length) {
        const obj = queue.shift();
        if (!obj || typeof obj !== "object") continue;
        out.push(obj);
        if (Array.isArray(obj["@graph"])) queue.push.apply(queue,obj["@graph"]);
      }
    } catch {}
  }
  return out;
}

function addressText(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  return [value.streetAddress,value.addressLocality,value.addressRegion,value.postalCode]
    .filter(Boolean).join(", ").replace(/,\s*(\d{4})$/," $1");
}

function extractProperty(html, finalUrl) {
  const title = getMeta(html,"og:title") || getMeta(html,"twitter:title") ||
    decodeHtml((String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  const description = getMeta(html,"og:description") || getMeta(html,"description") || "";
  const text = stripHtml(html);
  const combined = [title,description,text].filter(Boolean).join("\n");

  let address = "";
  let rent = 0;
  let beds = 0;
  for (const obj of jsonLd(html)) {
    if (!address && obj.address) address = addressText(obj.address);
    if (!beds && obj.numberOfBedrooms != null) beds = Number(obj.numberOfBedrooms) || 0;
    if (!rent && obj.offers && obj.offers.price != null) {
      const p = Number(String(obj.offers.price).replace(/[^\d.]/g,""));
      if (p >= 80 && p <= 5000) rent = p;
    }
  }

  if (!address) {
    const lines = combined.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    address = lines.find(x => /\bVIC\b\s*\d{4}/i.test(x)) ||
      lines.find(x => /^\d+\s+\S+/.test(x)) ||
      title.replace(/\s*[|\-–].*$/,"").trim();
  }

  if (!rent) {
    rent = firstNumber(combined,[
      /\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:per\s*week|\/\s*week|pw\b)/i,
      /(?:weekly\s*rent|rent)\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i
    ]);
  }

  const bond = firstNumber(combined,[/(?:bond)\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i]);
  if (!beds) beds = firstNumber(combined,[/(\d+)\s*(?:bed(?:room)?s?\b)/i]);

  let available = "";
  const av = combined.match(/(?:available|availability|available\s+from)\s*[:\-]?\s*([^\n|]{3,80})/i);
  if (av) available = av[1].trim();

  return {
    url: finalUrl,
    address: String(address || "").slice(0,180),
    rent: Number(rent || 0),
    bond: Number(bond || 0),
    beds: Number(beds || 0),
    available: String(available || "").slice(0,100),
    sourceTitle: String(title || "").slice(0,180),
    extractedAt: new Date().toISOString()
  };
}

module.exports = async function propertyExtract(req,res) {
  try {
    const raw = req.body && req.body.url;
    const page = await fetchPage(raw,0);
    const property = extractProperty(page.html,page.url);
    res.setHeader("Cache-Control","no-store");
    return res.status(200).json({ok:true,property});
  } catch (err) {
    res.setHeader("Cache-Control","no-store");
    return res.status(400).json({ok:false,error:err && err.message ? err.message : "Could not extract this listing."});
  }
};
