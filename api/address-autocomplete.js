const VICTORIA_BBOX = "140.95,-39.25,150.05,-33.95";

function normaliseFeature(feature) {
  const p = feature && feature.properties ? feature.properties : {};
  const countryCode = String(p.countrycode || p.country_code || "").toLowerCase();
  const state = String(p.state || "").toLowerCase();
  const isAustralia = !countryCode || countryCode === "au";
  const isVictoria = !state || state === "victoria" || state === "vic";
  if (!isAustralia || !isVictoria) return null;

  const line1 = [
    p.housenumber,
    p.street || p.name
  ].filter(Boolean).join(" ").trim();

  const locality = p.city || p.town || p.village || p.suburb || p.district || p.county || "";
  const pieces = [
    line1 || p.name || "",
    locality,
    "VIC",
    p.postcode || ""
  ].filter(Boolean);

  const label = pieces.join(", ")
    .replace(/, VIC, (\d{4})$/, ", VIC $1")
    .replace(/\s+/g, " ")
    .trim();

  if (!label) return null;

  const coords = feature.geometry && Array.isArray(feature.geometry.coordinates)
    ? feature.geometry.coordinates
    : [];

  return {
    label,
    street: line1,
    suburb: locality,
    state: "VIC",
    postcode: p.postcode || "",
    lat: coords.length >= 2 ? Number(coords[1]) : null,
    lon: coords.length >= 2 ? Number(coords[0]) : null
  };
}

module.exports = async function addressAutocomplete(req, res) {
  const q = String((req.query && req.query.q) || "").trim();

  if (q.length < 3) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, suggestions: [] });
  }

  try {
    const url = new URL("https://photon.komoot.io/api/");
    url.searchParams.set("q", q);
    url.searchParams.set("limit", "8");
    url.searchParams.set("lang", "en");
    url.searchParams.set("bbox", VICTORIA_BBOX);

    const r = await fetch(url, {
      headers: {
        "accept": "application/json",
        "user-agent": "RentReadyVIC/1.0 (+https://rentready-vic.onrender.com)"
      },
      signal: AbortSignal.timeout(7000)
    });

    if (!r.ok) throw new Error("Address service returned " + r.status);
    const payload = await r.json();

    const suggestions = (payload.features || [])
      .map(normaliseFeature)
      .filter(Boolean)
      .filter((item, index, arr) => arr.findIndex(x => x.label === item.label) === index)
      .slice(0, 6);

    res.setHeader("Cache-Control", "public, max-age=120, s-maxage=600");
    return res.status(200).json({ ok: true, suggestions });
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: false, suggestions: [] });
  }
};
