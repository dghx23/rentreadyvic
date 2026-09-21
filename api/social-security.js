module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
  const base = (process.env.SOCIAL_SECURITY_COMPASS_BASE || "https://coreau.riskatlas.co.za").replace(/\/$/, "");
  const mode = String((req.query && req.query.mode) || "payments");

  try {
    if (mode === "status") {
      const r = await fetch(base + "/api/compass/au", { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error("Upstream returned " + r.status);
      const payload = await r.json();
      return res.status(200).json({
        ok: true,
        jurisdiction: "AU",
        paymentCount: Array.isArray(payload.programmes) ? payload.programmes.length : 0,
        checkedAt: new Date().toISOString()
      });
    }

    const r = await fetch(base + "/api/compass/au", { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("Upstream returned " + r.status);
    const payload = await r.json();

    const allowed = new Set([
      "jobseeker",
      "disability-support-pension",
      "parenting-payment",
      "carer-payment",
      "youth-allowance",
      "austudy",
      "abstudy",
      "age-pension",
      "special-benefit",
      "farm-household-allowance"
    ]);

    const payments = (payload.programmes || [])
      .filter(p => allowed.has(p.slug))
      .map(p => ({
        slug: p.slug,
        name: p.name,
        shortName: p.short_name || p.name,
        summary: p.summary || "",
        rates: (p.rates || []).map(r => ({
          label: r.label,
          amount: r.amount_numeric == null ? null : Number(r.amount_numeric),
          display: r.amount_display || "",
          unit: r.unit || "",
          currency: r.currency || "AUD",
          effectiveFrom: r.effective_from || null,
          effectiveTo: r.effective_to || null,
          confidence: r.confidence || null
        }))
      }));

    const rentMethod = (payload.methodology || []).find(m => m.code === "rent_assistance");
    const rentParams = rentMethod && rentMethod.params ? rentMethod.params : {};
    const rentAssistance = {
      effectiveFrom: rentParams.effective_from || null,
      effectiveTo: rentParams.effective_to || null,
      edition: rentParams.edition || null,
      taper: Number(rentParams.taper || 0.75),
      bands: (rentParams.bands || []).map(b => ({
        code: b.code,
        label: b.label,
        table: b.table,
        threshold: Number(b.threshold || 0),
        ceiling: Number(b.ceiling || 0),
        maximum: Number(b.maximum || 0)
      }))
    };

    return res.status(200).json({
      ok: true,
      jurisdiction: "AU",
      generatedAt: new Date().toISOString(),
      payments,
      rentAssistance
    });
  } catch (err) {
    return res.status(502).json({
      ok: false,
      error: "Current payment data is temporarily unavailable.",
      detail: process.env.NODE_ENV === "development" ? String(err && err.message || err) : undefined
    });
  }
};