const path = require("path");
const crypto = require("crypto");
const express = require("express");
const socialSecurity = require("./api/social-security.js");
const propertyExtract = require("./api/property-extract.js");
const addressSearch = require("./api/address-search.js");
const addressAutocomplete = require("./api/address-autocomplete.js");
const rentalMarket = require("./api/rental-market.js");

const app = express();
const port = Number(process.env.PORT || 10000);
const root = __dirname;

app.disable("x-powered-by");

// Private-preview access is enabled by default in production. Credentials and
// cookie-signing secret live in Render environment variables, never in Git.
const PREVIEW_USER = process.env.RENTREADY_PREVIEW_USER || "";
const PREVIEW_PASSWORD = process.env.RENTREADY_PREVIEW_PASSWORD || "";
const PREVIEW_SECRET = process.env.RENTREADY_PREVIEW_SECRET || "";
const PREVIEW_DISABLED = ["1", "true", "yes"].includes(
  String(process.env.RENTREADY_PREVIEW_DISABLED || "").toLowerCase()
);
const PREVIEW_COOKIE = "rentready_preview";

if (!PREVIEW_DISABLED && !(PREVIEW_USER && PREVIEW_PASSWORD && PREVIEW_SECRET)) {
  throw new Error(
    "RentReady private preview requires RENTREADY_PREVIEW_USER, RENTREADY_PREVIEW_PASSWORD and RENTREADY_PREVIEW_SECRET."
  );
}

function parseCookies(req) {
  const raw = String(req.headers.cookie || "");
  return Object.fromEntries(
    raw
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const idx = item.indexOf("=");
        return idx < 0
          ? [decodeURIComponent(item), ""]
          : [decodeURIComponent(item.slice(0, idx)), decodeURIComponent(item.slice(idx + 1))];
      })
  );
}

function previewToken() {
  return crypto
    .createHmac("sha256", PREVIEW_SECRET)
    .update("rentready-vic-private-preview-v1")
    .digest("hex");
}

function timingSafeEqualText(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isPreviewUnlocked(req) {
  if (PREVIEW_DISABLED) return true;
  return timingSafeEqualText(parseCookies(req)[PREVIEW_COOKIE], previewToken());
}

function safeNext(raw) {
  const value = String(raw || "").trim();
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://rentready.invalid");
    if (url.origin !== "https://rentready.invalid") return "/";
    if (url.pathname === "/preview-login") return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}

function previewLoginPage(nextPath, error = "") {
  const safe = String(nextPath || "/").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const errorBlock = error ? `<p class="error">${error}</p>` : "";
  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RentReady VIC — Private preview</title>
<style>
:root{--brand:#4f46e5;--ink:#172033;--muted:#657083;--line:#dde3ec;--soft:#f5f6ff}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:linear-gradient(135deg,#f8fafc,#eef0ff);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink)}
.card{width:min(100%,430px);background:white;border:1px solid var(--line);border-radius:18px;padding:28px;box-shadow:0 24px 60px rgba(31,42,68,.13)}
.mark{width:46px;height:46px;display:grid;place-items:center;border-radius:13px;background:var(--brand);color:white;font-weight:900;font-size:20px}
.kicker{margin:20px 0 5px;color:var(--brand);font-size:10px;text-transform:uppercase;letter-spacing:.09em;font-weight:900}
h1{margin:0;font-size:28px;letter-spacing:-.04em}p{color:var(--muted);font-size:13px;line-height:1.6}
label{display:block;margin:14px 0 5px;font-size:11px;font-weight:800}input{width:100%;height:46px;border:1px solid #cbd4e1;border-radius:10px;padding:0 12px;font:inherit}button{width:100%;height:48px;margin-top:18px;border:0;border-radius:10px;background:var(--brand);color:white;font-weight:900;cursor:pointer}.error{color:#a12835;background:#fff0f1;border:1px solid #f0c6cb;padding:9px 10px;border-radius:8px}
.note{margin-top:16px;padding-top:14px;border-top:1px solid var(--line);font-size:11px}
</style>
</head>
<body><main class="card">
<div class="mark">R</div>
<p class="kicker">RentReady VIC · Private preview</p>
<h1>Early access</h1>
<p>RentReady is still being validated. Enter the preview credentials supplied by Sentrix Digital to continue.</p>
${errorBlock}
<form method="post" action="/preview-login">
<input type="hidden" name="next" value="${safe}">
<label for="user">Username</label><input id="user" name="username" autocomplete="username" required autofocus>
<label for="pass">Password</label><input id="pass" name="password" type="password" autocomplete="current-password" required>
<button type="submit">Continue to RentReady</button>
</form>
<p class="note">This gate protects the application and its connected API routes while the product remains in private preview.</p>
</main></body></html>`;
}

app.get("/_health", (_req, res) => {
  res.status(200).json({ ok: true, service: "rentready-vic" });
});

app.use(express.urlencoded({ extended: false, limit: "8kb" }));

app.get("/preview-login", (req, res) => {
  if (isPreviewUnlocked(req)) return res.redirect(safeNext(req.query.next || "/"));
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(previewLoginPage(safeNext(req.query.next || "/")));
});

app.post("/preview-login", (req, res) => {
  const nextPath = safeNext(req.body.next || "/");
  const userOk = timingSafeEqualText(req.body.username || "", PREVIEW_USER);
  const passOk = timingSafeEqualText(req.body.password || "", PREVIEW_PASSWORD);
  if (!userOk || !passOk) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(401).send(previewLoginPage(nextPath, "That username or password is not recognised."));
  }
  const cookie = [
    `${PREVIEW_COOKIE}=${encodeURIComponent(previewToken())}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=2592000"
  ].join("; ");
  res.setHeader("Set-Cookie", cookie);
  return res.redirect(nextPath);
});

app.use((req, res, next) => {
  if (isPreviewUnlocked(req)) return next();
  const target = encodeURIComponent(req.originalUrl || "/");
  return res.redirect(302, `/preview-login?next=${target}`);
});

app.use(express.json({ limit:"32kb" }));
app.get("/api/social-security", socialSecurity);
app.get("/api/rental-market", rentalMarket);
app.post("/api/property-extract", propertyExtract);
app.get("/api/address-search", addressSearch);
app.get("/api/address-autocomplete", addressAutocomplete);

app.use(express.static(root, {
  extensions: ["html"],
  setHeaders(res, filePath) {
    if (/\.(html|js|css)$/.test(filePath)) {
      res.setHeader("Cache-Control", "private, max-age=300");
    }
  }
}));

app.get("/", (_req, res) => res.sendFile(path.join(root, "index.html")));

app.use((_req, res) => {
  res.status(404).sendFile(path.join(root, "index.html"));
});

app.listen(port, "0.0.0.0", () => {
  console.log(`RentReady VIC listening on port ${port}`);
  const probe = `http://127.0.0.1:${port}/api/rental-market`;
  setTimeout(async () => {
    try {
      const response = await fetch(probe, {
        headers: {
          "User-Agent": "RentReadyVIC-startup-check/1.0",
          "Cookie": PREVIEW_DISABLED ? "" : `${PREVIEW_COOKIE}=${previewToken()}`
        }
      });
      const payload = await response.json().catch(() => ({}));
      const areas = payload && payload.areas ? Object.keys(payload.areas).length : 0;
      if (!response.ok || !payload.ok || !areas) {
        console.warn("Rental market preflight failed", { status: response.status, error: payload.error || null, areas });
        return;
      }
      console.log("Rental market preflight OK", {
        latest_period: payload.latest_period || null,
        source_area_count: areas,
        geometry_mode: payload.geometry_mode || (payload.geojson && payload.geojson.features && payload.geojson.features.length ? "embedded" : "unknown")
      });
    } catch (error) {
      console.warn("Rental market preflight error", error && error.message ? error.message : error);
    }
  }, 1200);
});