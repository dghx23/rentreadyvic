module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
  const base = (process.env.SOCIAL_SECURITY_COMPASS_BASE || "https://coreau.riskatlas.co.za").replace(/\/$/, "");
  const mode = String((req.query && req.query.mode) || "payments");

  try {
    if (mode === "status") {
      const r = await fetch(base + "/api/compass/au", { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error("Upstream returned " + r.status);
      const payload = await r.json();
      const rr = payload.rentready || null;
      return res.status(200).json({
        ok: true,
        jurisdiction: "AU",
        programmeCount: Array.isArray(payload.programmes) ? payload.programmes.length : 0,
        paymentCount: rr && Array.isArray(rr.primary_payments) ? rr.primary_payments.length : 0,
        supportCount: rr && Array.isArray(rr.additional_support) ? rr.additional_support.length : 0,
        rulePackVersion: rr && rr.version ? rr.version : null,
        checkedAt: new Date().toISOString()
      });
    }

    const r = await fetch(base + "/api/compass/au", { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("Upstream returned " + r.status);
    const payload = await r.json();

    const rr = payload.rentready || null;

    const normaliseRates = rates => (rates || []).map(r => ({
      label: r.label,
      amount: r.amount == null ? (r.amount_numeric == null ? null : Number(r.amount_numeric)) : Number(r.amount),
      display: r.display || r.amount_display || "",
      unit: r.unit || "",
      currency: r.currency || "AUD",
      effectiveFrom: r.effective_from || null,
      effectiveTo: r.effective_to || null,
      confidence: r.confidence || null,
      stream: r.stream || null,
      cutoff: r.cutoff == null ? null : Number(r.cutoff),
      notes: r.notes || null
    }));

    let payments = [];
    let additionalSupport = [];
    let workConcessions = {};
    let otherTests = {};
    let rentAssistance = null;

    if (rr && Array.isArray(rr.primary_payments)) {
      payments = rr.primary_payments.map(p => ({
        slug: p.slug,
        name: p.name,
        shortName: p.short_name || p.name,
        category: p.category || "income_support",
        administrator: p.administrator || "Services Australia",
        rentAssistanceEligible: !!p.rent_assistance_eligible,
        workConcession: p.work_concession || null,
        scenarioPrompts: p.scenario_prompts || [],
        incomeTest: p.income_test || null,
        rates: normaliseRates(p.rates)
      }));
      additionalSupport = (rr.additional_support || []).map(p => ({
        slug: p.slug,
        name: p.name,
        category: p.category || "supplementary",
        administrator: p.administrator || "Services Australia",
        description: p.description || "",
        rates: normaliseRates(p.rates)
      }));
      workConcessions = rr.work_concessions || {};
      otherTests = rr.other_tests || {};
      const ra = rr.rent_assistance || {};
      rentAssistance = {
        effectiveFrom: ra.effective_from || null,
        effectiveTo: ra.effective_to || null,
        edition: rr.version || null,
        taper: Number(ra.taper || 0.75),
        bands: (ra.bands || []).map(b => ({
          code: b.code,
          label: b.label,
          table: b.table || null,
          threshold: Number(b.threshold || 0),
          ceiling: Number(b.ceiling || 0),
          maximum: Number(b.maximum || 0)
        }))
      };
    } else {
      // Backward-compatible fallback for an older backend deployment.
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
      payments = (payload.programmes || [])
        .filter(p => allowed.has(p.slug))
        .map(p => ({
          slug: p.slug,
          name: p.name,
          shortName: p.short_name || p.name,
          category: "income_support",
          administrator: p.administrator || "Services Australia",
          rentAssistanceEligible: true,
          workConcession: null,
          scenarioPrompts: [],
          incomeTest: null,
          rates: normaliseRates(p.rates)
        }));

      const rentMethod = (payload.methodology || []).find(m => m.code === "rent_assistance");
      const rentParams = rentMethod && rentMethod.params ? rentMethod.params : {};
      rentAssistance = {
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
    }

    return res.status(200).json({
      ok: true,
      jurisdiction: "AU",
      generatedAt: new Date().toISOString(),
      payments,
      additionalSupport,
      workConcessions,
      otherTests,
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