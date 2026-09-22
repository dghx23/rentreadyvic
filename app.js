(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const STORAGE = {
    props: "rentready-properties-v3",
    active: "rentready-active-property-v3",
    config: "rentready-admin-config-v1"
  };

  const DEFAULT_CONFIG = {
    generalAffordabilityPct: 0.30,
    bondRentPct: 0.55,
    bondAssetLimit: 27644,
    bondIncomeLimits: {
      single: 811,
      couple: 1385,
      family1: 1419,
      family2: 1462,
      family3: 1505
    },
    extraChildIncomeLimit: 43,
    bondCaps: { one: 2150, two: 2650, three: 2900, fourPlus: 2600 },
    jobseeker: { freeArea: 150, secondThreshold: 256, taper1: 0.50, taper2: 0.60, principalCarerTaper: 0.40 },
    youthJobseeker: { freeArea: 150, secondThreshold: 250, taper1: 0.50, taper2: 0.60 }
  };

  const PERIODS = {
    week: { label: "week", fromFortnight: 0.5, fromWeek: 1 },
    fortnight: { label: "fortnight", fromFortnight: 1, fromWeek: 2 },
    month: { label: "month", fromFortnight: 26 / 12, fromWeek: 52 / 12 },
    year: { label: "year", fromFortnight: 26, fromWeek: 52 }
  };

  let cfg = loadConfig();
  let data = null;
  let currentPeriod = "fortnight";
  let paymentMaxFN = 0;
  let workIncomeFN = 0;
  let otherIncomeWeek = 0;
  let properties = loadJSON(STORAGE.props, []);
  let activePropertyId = localStorage.getItem(STORAGE.active) || null;

  function loadConfig() {
    const custom = loadJSON(STORAGE.config, {});
    return {
      ...DEFAULT_CONFIG,
      ...custom,
      bondIncomeLimits: { ...DEFAULT_CONFIG.bondIncomeLimits, ...(custom.bondIncomeLimits || {}) },
      bondCaps: { ...DEFAULT_CONFIG.bondCaps, ...(custom.bondCaps || {}) },
      jobseeker: { ...DEFAULT_CONFIG.jobseeker, ...(custom.jobseeker || {}) },
      youthJobseeker: { ...DEFAULT_CONFIG.youthJobseeker, ...(custom.youthJobseeker || {}) }
    };
  }

  function loadJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; }
    catch { return fallback; }
  }

  function saveJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function money(n, digits = 2) {
    return new Intl.NumberFormat("en-AU", {
      style: "currency", currency: "AUD",
      minimumFractionDigits: digits, maximumFractionDigits: digits
    }).format(Number(n || 0));
  }

  function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
  function pct(n) { return (Number(n || 0) * 100).toFixed(1) + "%"; }

  function displayFromFN(n) { return Number(n || 0) * PERIODS[currentPeriod].fromFortnight; }
  function fnFromDisplay(n) { return Number(n || 0) / PERIODS[currentPeriod].fromFortnight; }
  function displayFromWeek(n) { return Number(n || 0) * PERIODS[currentPeriod].fromWeek; }
  function weekFromDisplay(n) { return Number(n || 0) / PERIODS[currentPeriod].fromWeek; }

  function rateToFN(amount, unit) {
    amount = Number(amount || 0);
    if (unit === "week") return amount * 2;
    if (unit === "month") return amount * 12 / 26;
    if (unit === "year" || unit === "annual") return amount / 26;
    return amount;
  }

  function activeProperty() {
    return properties.find(p => p.id === activePropertyId) || null;
  }

  function selectedPayment() {
    if (!data) return null;
    return data.payments.find(p => p.slug === $("payment-select").value) || null;
  }

  function selectedRate() {
    const p = selectedPayment();
    if (!p) return null;
    return p.rates[Number($("payment-rate-select").value || 0)] || null;
  }

  function selectedRABand() {
    if (!data || !data.rentAssistance) return null;
    return data.rentAssistance.bands.find(b => b.code === $("ra-situation").value) || null;
  }

  function currentWorkRule(slug, rateLabel) {
    if (slug === "jobseeker") {
      const principal = /principal carer/i.test(rateLabel || "");
      return principal ? { freeArea: cfg.jobseeker.freeArea, singleTaper: cfg.jobseeker.principalCarerTaper } : cfg.jobseeker;
    }
    if (slug === "youth-allowance") return cfg.youthJobseeker;
    if (slug === "parenting-payment") {
      if (/single/i.test(rateLabel || "")) return { freeArea: 150, singleTaper: 0.40 };
      return cfg.jobseeker;
    }
    return null;
  }

  function paymentAtWork(workFN, creditBalance, maxFN = paymentMaxFN) {
    const p = selectedPayment();
    const r = selectedRate();
    if (!p || !maxFN) return { paymentFN: maxFN || 0, reduction: 0, assessableIncome: workFN, rule: null };

    const rule = currentWorkRule(p.slug, r && r.label);
    if (!rule) {
      return { paymentFN: maxFN, reduction: 0, assessableIncome: workFN, rule: null };
    }

    const usableCredits = Math.min(Math.max(0, Number(creditBalance || 0)), Math.max(0, workFN));
    const assessable = Math.max(0, workFN - usableCredits);
    let reduction = 0;

    if (rule.singleTaper != null) {
      reduction = Math.max(0, assessable - rule.freeArea) * rule.singleTaper;
    } else {
      const firstBand = Math.max(0, Math.min(assessable, rule.secondThreshold) - rule.freeArea);
      const secondBand = Math.max(0, assessable - rule.secondThreshold);
      reduction = firstBand * rule.taper1 + secondBand * rule.taper2;
    }

    return {
      paymentFN: Math.max(0, maxFN - reduction),
      reduction: Math.min(maxFN, reduction),
      assessableIncome: assessable,
      rule
    };
  }

  function rentAssistanceForRent(rentWeek) {
    if (!$("future-ra").checked) return { amountFN: 0, maximumFN: 0, band: null };
    const band = selectedRABand();
    if (!band) return { amountFN: 0, maximumFN: 0, band: null };
    const rentFN = Number(rentWeek || 0) * 2;
    let amount = 0;
    if (rentFN > band.threshold) {
      amount = Math.min(band.maximum, (rentFN - band.threshold) * Number(data.rentAssistance.taper || .75));
    }
    return { amountFN: round2(amount), maximumFN: Number(band.maximum || 0), band };
  }

  function scenario(workFN, rentWeek, creditBalance = Number($("working-credit").value || 0)) {
    const pay = paymentAtWork(workFN, creditBalance);
    const ra = rentAssistanceForRent(rentWeek);
    const actualRAFN = rentWeek > 0 ? ra.amountFN : ra.maximumFN;
    const householdWeek = (workFN + pay.paymentFN + actualRAFN) / 2 + otherIncomeWeek;
    const bondIncomeWeek = (workFN + pay.paymentFN + ra.maximumFN) / 2 + otherIncomeWeek;
    return { pay, ra, householdWeek, bondIncomeWeek, workFN, rentWeek, actualRAFN };
  }

  function householdIncomeLimit() {
    const type = $("household-type").value;
    if (type === "family4") return cfg.bondIncomeLimits.family3 + cfg.extraChildIncomeLimit;
    if (type === "family5") return cfg.bondIncomeLimits.family3 + cfg.extraChildIncomeLimit * 2;
    return cfg.bondIncomeLimits[type] || cfg.bondIncomeLimits.single;
  }

  function bondCapForBeds(beds) {
    beds = Number(beds || 0);
    if (beds <= 1) return cfg.bondCaps.one;
    if (beds === 2) return cfg.bondCaps.two;
    if (beds === 3) return cfg.bondCaps.three;
    return cfg.bondCaps.fourPlus;
  }

  function setStep(name) {
    document.querySelectorAll(".step-panel").forEach(p => p.classList.toggle("active", p.id === "step-" + name));
    document.querySelectorAll(".step-tab").forEach(b => b.classList.toggle("active", b.dataset.stepTarget === name));
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (name === "affordability") renderAffordability();
    if (name === "optimise") initialiseOptimiser();
  }

  async function loadPaymentData() {
    const status = $("payment-status");
    status.className = "status-pill loading";
    status.textContent = "Loading current data…";
    try {
      const res = await fetch("/api/social-security?mode=payments", { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error("Payment feed unavailable");
      const json = await res.json();
      if (!json.ok || !Array.isArray(json.payments)) throw new Error("Invalid payment feed");
      data = json;
      status.className = "status-pill ok";
      status.textContent = "Current data connected";
      populatePayments();
      populateRABands();
      recalcAll();
    } catch (err) {
      status.className = "status-pill bad";
      status.textContent = "Live data unavailable";
      $("payment-select").innerHTML = '<option value="manual">Enter payment manually</option>';
      $("payment-rate-select").innerHTML = '<option value="0">Manual amount</option>';
      $("centrelink-rate-display").textContent = "Unavailable";
      $("centrelink-rate-circumstance").textContent = "Manual amount";
      $("manual-payment-toggle").checked = true;
      $("manual-payment-wrap").hidden = false;
      $("payment-max").value = "0";
      $("ra-situation").innerHTML = '<option value="">Rent Assistance data unavailable</option>';
      $("payment-effective").textContent = "Not supplied";
      data = { payments: [], rentAssistance: { taper: .75, bands: [] } };
      recalcAll();
    }
  }

  function populatePayments() {
    const select = $("payment-select");
    const preferred = ["jobseeker","disability-support-pension","parenting-payment","carer-payment","youth-allowance","austudy","abstudy","age-pension"];
    const rows = data.payments.slice().sort((a,b) => {
      const ai = preferred.indexOf(a.slug), bi = preferred.indexOf(b.slug);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.name.localeCompare(b.name);
    });
    select.innerHTML = rows.map(p => '<option value="' + esc(p.slug) + '">' + esc(p.shortName || p.name) + '</option>').join("");
    if (rows.some(p => p.slug === "jobseeker")) select.value = "jobseeker";
    populateRates();
  }

  function populateRates() {
    const p = selectedPayment();
    const select = $("payment-rate-select");
    if (!p) {
      select.innerHTML = '<option value="0">Manual amount</option>';
      return;
    }
    const numericRates = p.rates.filter(r => Number.isFinite(r.amount) && r.amount != null);
    p.rates = numericRates.length ? numericRates : p.rates;
    select.innerHTML = p.rates.map((r,i) =>
      '<option value="' + i + '">' + esc(r.label) + '</option>'
    ).join("");
    select.value = "0";
    applySelectedRate();
  }

  function selectedRateFN() {
    const r = selectedRate();
    return r && r.amount != null ? rateToFN(r.amount, r.unit) : 0;
  }

  function renderSelectedCentrelinkRate() {
    const r = selectedRate();
    const rateFN = selectedRateFN();
    $("centrelink-rate-display").textContent = r && r.amount != null ? money(displayFromFN(rateFN)) : "Unavailable";
    $("centrelink-rate-circumstance").textContent = r ? r.label : "Manual amount";
    if (!r || r.amount == null) {
      $("payment-effective").textContent = "Not supplied";
      return;
    }
    const from = r.effectiveFrom || "—";
    const to = r.effectiveTo ? " to " + r.effectiveTo : "";
    $("payment-effective").textContent = from + to;
  }

  function applySelectedRate() {
    const r = selectedRate();
    const rateFN = selectedRateFN();
    renderSelectedCentrelinkRate();

    // A new circumstance starts from the current published rate.
    $("manual-payment-toggle").checked = false;
    $("manual-payment-wrap").hidden = true;
    paymentMaxFN = rateFN;
    $("payment-max").value = displayFromFN(paymentMaxFN).toFixed(2);

    if (!r || r.amount == null) {
      $("manual-payment-toggle").checked = true;
      $("manual-payment-wrap").hidden = false;
      paymentMaxFN = Number($("payment-max").value || 0);
    }
    recalcAll();
  }

  function populateRABands() {
    const select = $("ra-situation");
    const bands = (data && data.rentAssistance && data.rentAssistance.bands) || [];
    select.innerHTML = bands.map(b => '<option value="' + esc(b.code) + '">' + esc(b.label) + '</option>').join("");
    const single = bands.find(b => b.code === "isp_single");
    if (single) select.value = single.code;
  }

  function syncInputsToPeriod() {
    document.querySelectorAll(".period-label").forEach(el => el.textContent = "per " + PERIODS[currentPeriod].label);
    renderSelectedCentrelinkRate();
    $("payment-max").value = displayFromFN(paymentMaxFN).toFixed(2);
    $("work-income").value = displayFromFN(workIncomeFN).toFixed(2);
    $("other-income-week").value = displayFromWeek(otherIncomeWeek).toFixed(2);
    recalcAll();
  }

  function recalcAll() {
    const prop = activeProperty();
    const rent = prop ? Number(prop.rent || 0) : 0;
    const sc = scenario(workIncomeFN, rent);
    renderIncome(sc);
    renderBondChecks(sc, prop);
    renderPropertySummary(sc, prop);
    renderAffordability(sc, prop);
  }

  function renderIncome(sc) {
    const raMax = sc.ra.maximumFN || 0;
    $("ra-max-display").textContent = money(displayFromFN(raMax));
    $("income-work-result").textContent = money(displayFromFN(sc.workFN));
    $("income-support-result").textContent = money(displayFromFN(sc.pay.paymentFN));
    $("income-ra-result").textContent = money(displayFromFN(sc.actualRAFN));
    const totalFN = sc.householdWeek * 2;
    $("income-total-result").textContent = money(displayFromFN(totalFN));

    const p = selectedPayment();
    const label = p ? p.shortName || p.name : "your payment";
    let copy = "Projected income combines work, the selected support payment and other household income.";
    if (sc.pay.rule) {
      copy += " For " + escText(label) + ", the configured work-income test reduces the payment by " + money(sc.pay.reduction) +
        " per fortnight at this work income. Assessable employment income after Working Credits is " + money(sc.pay.assessableIncome) + ".";
    } else if (p) {
      copy += " The selected payment does not yet have a work-income taper model in this prototype, so the chosen payment amount is held constant as work income changes.";
    }
    if ($("future-ra").checked) {
      copy += activeProperty() ? " Rent Assistance is estimated from the selected property's rent." : " Until you choose a property, the income projection uses the potential maximum Rent Assistance for the selected household situation.";
    }
    $("income-explanation").textContent = copy;
  }

  function renderBondChecks(sc, prop) {
    const limit = householdIncomeLimit();
    const assets = Number($("assets").value || 0);
    const resident = $("permanent-resident").checked;
    const owns = $("owns-property").checked;
    const incomePass = sc.bondIncomeWeek <= limit;
    const assetPass = assets <= cfg.bondAssetLimit;
    const rentPass = prop ? Number(prop.rent || 0) < sc.bondIncomeWeek * cfg.bondRentPct : null;

    const rows = [
      checkRow(incomePass, "Weekly household income", money(sc.bondIncomeWeek) + " estimated for this test.", "Limit " + money(limit,0)),
      checkRow(assetPass, "Assets", money(assets) + " entered.", "Limit " + money(cfg.bondAssetLimit,0)),
      checkRow(resident, "Residency", resident ? "Citizen/permanent-resident requirement marked as met." : "Residency requirement is not met.", "Required"),
      checkRow(!owns, "Property ownership", owns ? "You marked that you own or part-own residential property." : "No residential property ownership entered.", "Must not own"),
      checkRow(rentPass, "Rent share", prop ? money(prop.rent) + "/wk compared with " + money(sc.bondIncomeWeek * cfg.bondRentPct) + "/wk." : "Add a property to run this test.", "Under " + Math.round(cfg.bondRentPct*100) + "%")
    ];
    $("bond-checks").innerHTML = rows.join("");
  }

  function checkRow(pass, title, detail, limit) {
    const state = pass == null ? "pending" : pass ? "pass" : "fail";
    const icon = pass == null ? "…" : pass ? "✓" : "×";
    return '<div class="check-item ' + state + '"><span class="check-icon">' + icon + '</span><div><strong>' + esc(title) +
      '</strong><p>' + esc(detail) + '</p></div><span class="limit">' + esc(limit) + '</span></div>';
  }

  function parseListing(text) {
    const clean = String(text || "").trim();
    const lines = clean.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    let address = lines.find(l => /\bVIC\b\s*\d{4}/i.test(l)) || lines.find(l => /^\d+\s+/.test(l)) || "";
    let rent = matchNumber(clean, [
      /\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:per\s*week|\/\s*week|pw\b)/i,
      /(?:weekly\s*rent|rent)\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i
    ]);
    let bond = matchNumber(clean, [/(?:bond)\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i]);
    let beds = matchNumber(clean, [/(\d+)\s*(?:bed|bedroom)/i]);
    let available = "";
    const av = clean.match(/(?:available|availability)\s*[:\-]?\s*([^\n]+)/i);
    if (av) available = av[1].trim().slice(0,80);
    return { address, rent, bond, beds, available, raw: clean };
  }

  function matchNumber(text, patterns) {
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return Number(String(m[1]).replace(/,/g,""));
    }
    return 0;
  }

  function savePropertyFromForm() {
    const obj = {
      id: String(Date.now()),
      address: $("property-address").value.trim() || "Untitled property",
      rent: Number($("property-rent").value || 0),
      bond: Number($("property-bond").value || 0),
      beds: Number($("property-beds").value || 0),
      available: $("property-available").value.trim(),
      raw: $("listing-text").value
    };
    properties.push(obj);
    activePropertyId = obj.id;
    persistProperties();
    renderShortlist();
    recalcAll();
  }

  function persistProperties() {
    saveJSON(STORAGE.props, properties);
    if (activePropertyId) localStorage.setItem(STORAGE.active, activePropertyId);
    else localStorage.removeItem(STORAGE.active);
  }

  function renderShortlist() {
    const el = $("shortlist");
    if (!properties.length) {
      el.innerHTML = '<div class="empty-state">No properties yet. Paste a listing or enter one manually.</div>';
      return;
    }
    el.innerHTML = properties.map(p => '<div class="property-card ' + (p.id === activePropertyId ? "active" : "") + '" data-property="' + p.id + '">' +
      '<button type="button" data-remove-property="' + p.id + '" aria-label="Remove">×</button>' +
      '<b>' + esc(p.address) + '</b><small>' + money(p.rent,0) + '/wk · ' + (p.beds || "—") + ' bed · bond ' + money(p.bond,0) + '</small></div>').join("");
  }

  function renderPropertySummary(sc, prop) {
    const box = $("property-summary");
    if (!prop) {
      box.className = "property-summary empty";
      box.innerHTML = "<p>Select or save a property to complete the rent and affordability tests.</p>";
      return;
    }
    box.className = "property-summary";
    const cap = bondCapForBeds(prop.beds);
    box.innerHTML = '<div class="property-summary-grid">' +
      summaryCell("Selected property", prop.address) +
      summaryCell("Weekly rent", money(prop.rent,0)) +
      summaryCell("Estimated Rent Assistance", money(sc.actualRAFN/2) + "/wk") +
      summaryCell("Bond", money(prop.bond,0)) +
      summaryCell("Published bedroom cap", money(cap,0)) +
      '</div>';
  }

  function summaryCell(label, value) {
    return '<div><span>' + esc(label) + '</span><strong>' + esc(String(value)) + '</strong></div>';
  }

  function renderAffordability(sc = null, prop = null) {
    prop = prop || activeProperty();
    sc = sc || scenario(workIncomeFN, prop ? prop.rent : 0);
    const rent = prop ? Number(prop.rent || 0) : 0;
    const generalLimit = sc.householdWeek * cfg.generalAffordabilityPct;
    const bondLimit = sc.bondIncomeWeek * cfg.bondRentPct;
    const ratio = sc.householdWeek > 0 && rent ? rent / sc.householdWeek : 0;
    const bondRatio = sc.bondIncomeWeek > 0 && rent ? rent / sc.bondIncomeWeek : 0;
    const generalGap = rent - generalLimit;
    const bondGap = rent - bondLimit;
    const cap = prop ? bondCapForBeds(prop.beds) : 0;
    const bondAmountGap = prop ? Math.max(0, Number(prop.bond || 0) - cap) : 0;

    $("metric-weekly-income").textContent = money(sc.householdWeek);
    $("metric-general-rent").textContent = money(generalLimit);
    $("metric-bond-rent").textContent = money(bondLimit);
    $("metric-property-rent").textContent = prop ? money(rent) : "—";
    $("metric-bond-cap").textContent = prop ? money(cap) : "—";
    $("metric-bond-shortfall").textContent = prop ? money(bondAmountGap) : "—";

    if (!prop) {
      setScore("general", null, 0, "Add a property to compare rent with your projected weekly income.", "");
      setScore("bond", null, 0, "Add a property to run the RentAssist rent-share test.", "");
      $("shortfall-explainer").innerHTML = "<p>Add a property first.</p>";
      return;
    }

    setScore("general", generalGap <= 0, ratio,
      "Selected rent is " + pct(ratio) + " of projected weekly household income. The planning benchmark is " + Math.round(cfg.generalAffordabilityPct*100) + "%.",
      generalGap <= 0 ? money(-generalGap) + "/wk of headroom to the benchmark." : money(generalGap) + "/wk above the benchmark.");

    setScore("bond", bondGap < 0, bondRatio,
      "For the bond-loan rent test, the selected rent is " + pct(bondRatio) + " of the estimated income basis used by this tool. The configured threshold is under " + Math.round(cfg.bondRentPct*100) + "%.",
      bondGap < 0 ? money(-bondGap) + "/wk of headroom to the rent-share limit." : money(bondGap) + "/wk above the rent-share limit.");

    const items = [];
    if (generalGap > 0) items.push("For the general affordability benchmark, the rent would need to fall by about " + money(generalGap) + " per week at the current income.");
    else items.push("The selected rent is within the general planning benchmark at the current projected income.");

    if (bondGap >= 0) items.push("For the bond-loan rent-share test, the rent is about " + money(bondGap) + " per week above the current estimated limit.");
    else items.push("The selected rent is within the bond-loan rent-share test at the current estimated income basis.");

    if (bondAmountGap > 0) items.push("The entered bond is " + money(bondAmountGap) + " above the published bedroom-based maximum loan amount. The final amount can also depend on occupancy.");
    else if (prop.bond) items.push("The entered bond does not exceed the published bedroom-based maximum loan amount.");

    const incomeLimit = householdIncomeLimit();
    if (sc.bondIncomeWeek > incomeLimit) items.push("There is also an income-limit issue: estimated weekly household income is " + money(sc.bondIncomeWeek - incomeLimit) + " above the configured limit for this household type.");
    if (Number($("assets").value || 0) > cfg.bondAssetLimit) items.push("Assets are above the configured bond-loan asset limit by " + money(Number($("assets").value || 0) - cfg.bondAssetLimit) + ".");

    $("shortfall-explainer").innerHTML = "<ul>" + items.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>";
  }

  function setScore(kind, pass, ratio, copy, gap) {
    const prefix = kind === "general" ? "general-afford" : "bond-rent";
    $(prefix + "-status").textContent = pass == null ? "Waiting for a property" : pass ? "Within range" : "Shortfall";
    $(prefix + "-ratio").textContent = pass == null ? "—" : pct(ratio);
    $(prefix + "-copy").textContent = copy;
    const el = $(prefix + "-shortfall");
    el.textContent = gap;
    el.className = "shortfall" + (pass == null ? "" : pass ? " pass" : " fail");
  }

  function initialiseOptimiser() {
    const prop = activeProperty();
    $("optimise-work").value = Math.min(Number($("optimise-work").max), workIncomeFN);
    $("optimise-rent").value = prop && prop.rent ? Math.min(Number($("optimise-rent").max), prop.rent) : 350;
    renderOptimiser();
  }

  function renderOptimiser() {
    const work = Number($("optimise-work").value || 0);
    const rent = Number($("optimise-rent").value || 0);
    const sc = scenario(work, rent);
    const generalLimit = sc.householdWeek * cfg.generalAffordabilityPct;
    const bondLimit = sc.bondIncomeWeek * cfg.bondRentPct;
    const generalGap = rent - generalLimit;
    const bondGap = rent - bondLimit;

    $("optimise-work-label").textContent = money(displayFromFN(work),0) + " / " + PERIODS[currentPeriod].label;
    $("optimise-rent-label").textContent = money(rent,0) + " / week";
    $("optimise-income").textContent = money(sc.householdWeek) + "/wk";
    $("optimise-general-gap").textContent = gapText(generalGap);
    $("optimise-bond-gap").textContent = gapText(bondGap);
    $("target-general-rent").textContent = money(generalLimit,0) + "/wk";
    $("target-bond-rent").textContent = money(bondLimit,0) + "/wk";

    const generalPass = generalGap <= 0;
    const bondPass = bondGap < 0;
    if (generalPass && bondPass) {
      $("optimise-verdict").textContent = "This combination is inside both rent thresholds";
      $("optimise-copy").textContent = "At this work income and target rent, both the general planning benchmark and the bond-loan rent-share test are within range.";
    } else if (bondPass) {
      $("optimise-verdict").textContent = "Bond-loan rent test passes; general affordability is tighter";
      $("optimise-copy").textContent = "The property is inside the bond-loan rent-share threshold, but above the general planning benchmark.";
    } else {
      $("optimise-verdict").textContent = "The bond-loan rent test is still the immediate constraint";
      $("optimise-copy").textContent = "Move rent down or work income up to see where the test crosses into range.";
    }

    $("target-general-income").textContent = requiredWorkText(rent, cfg.generalAffordabilityPct, "general");
    $("target-bond-income").textContent = requiredWorkText(rent, cfg.bondRentPct, "bond");
  }

  function gapText(gap) {
    return gap <= 0 ? money(-gap) + " headroom" : money(gap) + " short";
  }

  function requiredWorkText(rent, ratio, mode) {
    const current = Number($("optimise-work").value || 0);
    const max = 8000;
    for (let w = 0; w <= max; w += 10) {
      const sc = scenario(w, rent);
      const limit = (mode === "bond" ? sc.bondIncomeWeek : sc.householdWeek) * ratio;
      const pass = mode === "bond" ? rent < limit : rent <= limit;
      if (pass) return money(displayFromFN(w),0) + " / " + PERIODS[currentPeriod].label;
    }
    return "Above modelled range";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, ch => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[ch]));
  }
  function escText(s) { return String(s == null ? "" : s); }

  function bind() {
    document.querySelectorAll("[data-step-target]").forEach(b => b.addEventListener("click", () => setStep(b.dataset.stepTarget)));
    document.querySelectorAll("[data-next]").forEach(b => b.addEventListener("click", () => setStep(b.dataset.next)));
    document.querySelectorAll("[data-back]").forEach(b => b.addEventListener("click", () => setStep(b.dataset.back)));

    document.querySelectorAll("[data-period]").forEach(b => b.addEventListener("click", () => {
      document.querySelectorAll("[data-period]").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      currentPeriod = b.dataset.period;
      syncInputsToPeriod();
      renderOptimiser();
    }));

    $("payment-select").addEventListener("change", () => { populateRates(); recalcAll(); });
    $("payment-rate-select").addEventListener("change", applySelectedRate);
    $("manual-payment-toggle").addEventListener("change", () => {
      const manual = $("manual-payment-toggle").checked;
      $("manual-payment-wrap").hidden = !manual;
      if (manual) {
        $("payment-max").value = displayFromFN(paymentMaxFN || selectedRateFN()).toFixed(2);
        paymentMaxFN = fnFromDisplay($("payment-max").value);
      } else {
        paymentMaxFN = selectedRateFN();
        $("payment-max").value = displayFromFN(paymentMaxFN).toFixed(2);
      }
      recalcAll();
    });
    $("payment-max").addEventListener("input", () => {
      if (!$("manual-payment-toggle").checked) return;
      paymentMaxFN = fnFromDisplay($("payment-max").value);
      recalcAll();
    });
    $("work-income").addEventListener("input", () => { workIncomeFN = fnFromDisplay($("work-income").value); recalcAll(); });
    $("other-income-week").addEventListener("input", () => { otherIncomeWeek = weekFromDisplay($("other-income-week").value); recalcAll(); });
    $("working-credit").addEventListener("input", recalcAll);
    $("future-ra").addEventListener("change", recalcAll);
    $("ra-situation").addEventListener("change", recalcAll);
    $("household-type").addEventListener("change", recalcAll);
    $("assets").addEventListener("input", recalcAll);
    $("permanent-resident").addEventListener("change", recalcAll);
    $("owns-property").addEventListener("change", recalcAll);

    $("parse-listing").addEventListener("click", () => {
      const p = parseListing($("listing-text").value);
      if (p.address) $("property-address").value = p.address;
      if (p.rent) $("property-rent").value = p.rent;
      if (p.bond) $("property-bond").value = p.bond;
      if (p.beds) $("property-beds").value = p.beds;
      if (p.available) $("property-available").value = p.available;
    });
    $("save-property").addEventListener("click", savePropertyFromForm);
    $("clear-properties").addEventListener("click", () => { properties = []; activePropertyId = null; persistProperties(); renderShortlist(); recalcAll(); });
    $("shortlist").addEventListener("click", e => {
      const remove = e.target.closest("[data-remove-property]");
      if (remove) {
        const id = remove.dataset.removeProperty;
        properties = properties.filter(p => p.id !== id);
        if (activePropertyId === id) activePropertyId = properties[0] ? properties[0].id : null;
        persistProperties(); renderShortlist(); recalcAll(); return;
      }
      const card = e.target.closest("[data-property]");
      if (card) {
        activePropertyId = card.dataset.property;
        persistProperties(); renderShortlist(); recalcAll();
      }
    });

    $("optimise-work").addEventListener("input", renderOptimiser);
    $("optimise-rent").addEventListener("input", renderOptimiser);
  }

  bind();
  renderShortlist();
  loadPaymentData();
  recalcAll();
})();