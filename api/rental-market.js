let cache = { at: 0, payload: null, source: null };
const CACHE_MS = 30 * 60 * 1000;

function upstreams() {
  const configured = String(process.env.CORE_AU_RENTAL_URL || "").trim();
  return [
    configured,
    "https://sentrixdigital.com.au/core/au/property-rental/map-data",
    "https://riskatlas-0iob.onrender.com/core/au/property-rental/map-data"
  ].filter((v, i, a) => v && a.indexOf(v) === i);
}

async function loadUpstream(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "RentReadyVIC/1.0"
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Core AU returned ${response.status}`);
    const payload = await response.json();
    if (!payload || payload.ok !== true || !payload.geojson || !Array.isArray(payload.geojson.features)) {
      throw new Error("Core AU payload is not ready");
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function rentalMarket(req, res) {
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400");

  if (cache.payload && Date.now() - cache.at < CACHE_MS) {
    res.setHeader("X-RentReady-Data-Source", cache.source || "core-au");
    return res.status(200).json(cache.payload);
  }

  const errors = [];
  for (const url of upstreams()) {
    try {
      const payload = await loadUpstream(url);
      cache = { at: Date.now(), payload, source: url };
      res.setHeader("X-RentReady-Data-Source", url);
      return res.status(200).json(payload);
    } catch (error) {
      errors.push({ url, error: String(error && error.message || error) });
    }
  }

  if (cache.payload) {
    res.setHeader("Warning", '110 - "Serving stale Core AU rental data"');
    return res.status(200).json(cache.payload);
  }

  return res.status(503).json({
    ok: false,
    error: "Rental market data is temporarily unavailable.",
    detail: errors
  });
};
