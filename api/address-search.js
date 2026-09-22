const VICMAP_QUERY = "https://vicmap.land.vic.gov.au/agsgis/rest/services/vicmap/Vicmap_Address/MapServer/0/query";

function cleanQuery(value) {
  return String(value || "")
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

function sqlLike(value) {
  return value.replace(/'/g, "''");
}

module.exports = async function addressSearch(req, res) {
  const q = cleanQuery(req.query && req.query.q);
  if (q.length < 3) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok:true, results:[] });
  }

  try {
    const params = new URLSearchParams({
      f: "json",
      where: "ezi_address LIKE '%" + sqlLike(q.toUpperCase()) + "%'",
      outFields: "ezi_address,locality_name,state,postcode",
      returnGeometry: "false",
      returnDistinctValues: "true",
      orderByFields: "ezi_address ASC",
      resultRecordCount: "8"
    });

    const response = await fetch(VICMAP_QUERY + "?" + params.toString(), {
      headers: { "accept":"application/json" },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error("Vicmap returned HTTP " + response.status);

    const data = await response.json();
    if (data && data.error) throw new Error(data.error.message || "Vicmap query failed");

    const seen = new Set();
    const results = [];
    for (const feature of (data.features || [])) {
      const a = feature.attributes || {};
      const raw = String(a.ezi_address || "").trim();
      if (!raw) continue;
      const state = String(a.state || "VIC").trim() || "VIC";
      const postcode = String(a.postcode || "").trim();
      let label = raw;
      if (!/\bVIC\b/i.test(label) && state) label += ", " + state;
      if (postcode && !new RegExp("\\b" + postcode + "\\b").test(label)) label += " " + postcode;
      const key = label.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        label,
        address: label,
        locality: String(a.locality_name || "").trim(),
        state,
        postcode
      });
      if (results.length >= 8) break;
    }

    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).json({ ok:true, source:"Vicmap Address", results });
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ ok:false, results:[], error:"Address suggestions are temporarily unavailable." });
  }
};
