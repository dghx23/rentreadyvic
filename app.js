(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const STORAGE = {
    props: "rentready-properties-v3",
    active: "rentready-active-property-v3",
    config: "rentready-admin-config-v1",
    account: "rentready-account-v1"
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
  let accountEmail = localStorage.getItem(STORAGE.account) || "";

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
    const payment = selectedPayment();
    const test = payment && payment.incomeTest ? payment.incomeTest : null;
    const label = String(rateLabel || "").toLowerCase();

    if (test) {
      let rule = test;
      if (Array.isArray(test.variants) && test.variants.length) {
        const matched = test.variants.find(v =>
          Array.isArray(v.match) && v.match.length &&
          v.match.every(term => label.includes(String(term).toLowerCase()))
        );
        rule = matched || test.variants.find(v => !v.match || !v.match.length) || test.variants[0];
      }

      if (rule.type === "complex_threshold" || test.type === "complex_threshold") return null;
      return {
        ...test,
        ...rule,
        freeArea: Number(rule.free_area ?? test.free_area ?? rule.freeArea ?? test.freeArea ?? 0),
        secondThreshold: rule.second_threshold == null && test.second_threshold == null
          ? null : Number(rule.second_threshold ?? test.second_threshold),
        taper1: rule.taper1 == null && test.taper1 == null ? null : Number(rule.taper1 ?? test.taper1),
        taper2: rule.taper2 == null && test.taper2 == null ? null : Number(rule.taper2 ?? test.taper2),
        singleTaper: rule.single_taper == null && test.single_taper == null
          ? null : Number(rule.single_taper ?? test.single_taper),
        incomeBasis: rule.income_basis || test.income_basis || "personal_employment_income",
        otherTests: rule.other_tests || test.other_tests || [],
        workConcession: payment.workConcession || null
      };
    }

    // Backward-compatible fallback while an older backend is still deployed.
    if (slug === "jobseeker") {
      const principal = /principal carer/i.test(rateLabel || "");
      return principal ? { freeArea: cfg.jobseeker.freeArea, singleTaper: cfg.jobseeker.principalCarerTaper } : cfg.jobseeker;
    }
    if (slug === "youth-allowance" || slug === "youth-allowance-jobseeker") return cfg.youthJobseeker;
    if (slug === "parenting-payment") {
      if (/single/i.test(rateLabel || "")) return { freeArea: 232.60, singleTaper: 0.40 };
      return cfg.jobseeker;
    }
    return null;
  }

  function selectedWorkConcession() {
    const p = selectedPayment();
    if (!p || !p.workConcession) return null;
    const configured = data.workConcessions && data.workConcessions[p.workConcession];
    return configured ? { code: p.workConcession, ...configured } : {
      code: p.workConcession,
      name: "Work concession",
      description: "A payment-specific work-income concession may apply depending on your circumstances."
    };
  }

  function renderPaymentScenarioGuidance() {
    if (!$("scenario-prompts")) return;
    const p = selectedPayment();
    if (!p) return;

    const concession = selectedWorkConcession();
    const input = $("working-credit");
    if (concession && concession.code === "income_bank") {
      $("work-concession-label").textContent = "Income Bank balance";
      input.max = String(concession.student_balance_max || 13500);
      $("work-concession-help").textContent = "Income Bank credits can offset employment income before the student payment income test is applied.";
    } else if (concession && concession.code === "work_bonus") {
      $("work-concession-label").textContent = "Work Bonus income bank balance";
      input.max = String(concession.balance_max || 11800);
      $("work-concession-help").textContent = "For eligible pensioners, the Work Bonus can disregard $300 of work income per fortnight plus available income-bank credits.";
    } else if (concession && concession.code === "working_credit") {
      $("work-concession-label").textContent = "Working Credit balance";
      input.max = String(p.slug === "youth-allowance-jobseeker"
        ? (concession.youth_jobseeker_balance_max || 3500)
        : (concession.balance_max || 1000));
      $("work-concession-help").textContent = "Working Credits offset employment income before the allowance income test is applied.";
    } else if (concession) {
      $("work-concession-label").textContent = "Work concession balance, if applicable";
      input.max = "11800";
      $("work-concession-help").textContent = concession.description || "Enter a balance only if this concession applies to you.";
    } else {
      $("work-concession-label").textContent = "Work-income concession balance";
      input.max = "0";
      $("work-concession-help").textContent = "No automatic work-credit concession is configured for this payment.";
      if (Number(input.value || 0) > 0) input.value = "0";
    }

    const prompts = [...(p.scenarioPrompts || [])];
    const tests = p.incomeTest && Array.isArray(p.incomeTest.other_tests) ? p.incomeTest.other_tests : [];
    tests.forEach(code => {
      const desc = data.otherTests && data.otherTests[code];
      if (desc && !prompts.includes(desc)) prompts.push(desc);
    });
    $("scenario-count").textContent = prompts.length ? prompts.length + " checks" : "No extra checks";
    $("scenario-prompts").innerHTML = prompts.length
      ? prompts.map(x => "<span>" + esc(x) + "</span>").join("")
      : "<span>No additional scenario prompts are configured for this payment.</span>";
  }

  function paymentAtWork(workFN, creditBalance, maxFN = paymentMaxFN) {
    const p = selectedPayment();
    const r = selectedRate();
    if (!p || !maxFN) return { paymentFN: maxFN || 0, reduction: 0, assessableIncome: workFN, rule: null };

    const rule = currentWorkRule(p.slug, r && r.label);
    if (!rule) {
      return { paymentFN: maxFN, reduction: 0, assessableIncome: workFN, rule: null };
    }

    const concession = rule.workConcession || (p && p.workConcession) || null;
    let usableCredits = 0;
    if (concession === "working_credit" || concession === "income_bank" || concession === "working_credit_or_work_bonus_if_age_eligible") {
      usableCredits = Math.min(Math.max(0, Number(creditBalance || 0)), Math.max(0, workFN));
    }
    if (concession === "work_bonus") {
      const automaticBonus = 300;
      usableCredits = Math.min(Math.max(0, Number(creditBalance || 0)) + automaticBonus, Math.max(0, workFN));
    }

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
    const order = ["income","property","result","optimise"];
    const currentIndex = order.indexOf(name);
    document.querySelectorAll(".wizard-step").forEach(b => {
      const stepIndex = order.indexOf(b.dataset.stepTarget);
      b.classList.toggle("active", b.dataset.stepTarget === name);
      b.classList.toggle("completed", currentIndex > stepIndex && stepIndex >= 0);
    });
    document.querySelectorAll(".wizard-rights").forEach(b =>
      b.classList.toggle("active", b.dataset.stepTarget === name)
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (name === "result") recalcAll();
    if (name === "application") renderApplicationReview();
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
      data = { payments: [], additionalSupport: [], workConcessions: {}, otherTests: {}, rentAssistance: { taper: .75, bands: [] } };
      recalcAll();
    }
  }

  function populatePayments() {
    const select = $("payment-select");
    const preferred = [
      "jobseeker",
      "disability-support-pension",
      "parenting-payment",
      "carer-payment",
      "age-pension",
      "youth-allowance-jobseeker",
      "youth-allowance-student",
      "austudy",
      "abstudy-living-allowance",
      "special-benefit",
      "farm-household-allowance",
      "youth-allowance",
      "abstudy"
    ];
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
    renderPaymentScenarioGuidance();

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
    const prop = propertyForAssessment();
    const rent = prop ? Number(prop.rent || 0) : 0;
    const sc = scenario(workIncomeFN, rent);
    renderIncome(sc);
    renderBondChecks(sc, prop);
    renderPropertySummary(sc, prop);
    renderPropertyAssessment();
    renderAffordability(sc, prop);
    renderApplicationReview(sc, prop);
    renderResultOverview(sc, prop);
  }

  function renderPaymentCoverage() {
    if (!$("payment-scenario-prompts") || !$("additional-support-list")) return;
    const p = selectedPayment();
    const r = selectedRate();
    const rule = p && r ? currentWorkRule(p.slug, r.label) : null;
    const prompts = [];

    if (p && Array.isArray(p.scenarioPrompts)) prompts.push(...p.scenarioPrompts);
    if (rule && Array.isArray(rule.otherTests)) {
      rule.otherTests.forEach(key => {
        const text = data && data.otherTests ? data.otherTests[key] : null;
        prompts.push(text || String(key).replaceAll("_"," "));
      });
    }
    if (p && p.workConcession) {
      const wc = data && data.workConcessions ? data.workConcessions[p.workConcession] : null;
      prompts.push(wc ? (wc.name + ": " + wc.description) : String(p.workConcession).replaceAll("_"," "));
    }

    const unique = [...new Set(prompts.filter(Boolean))];
    $("payment-scenario-prompts").innerHTML = unique.length
      ? unique.map(x => '<span>' + esc(x) + '</span>').join("")
      : '<span>No additional scenario prompts supplied for this payment.</span>';

    if (!p) {
      $("payment-scenario-note").textContent = "Select a payment to see the tests that can affect it.";
    } else if (!rule && p.incomeTest) {
      $("payment-scenario-note").textContent = "This payment has a complex or non-linear assessment. RentReady shows the relevant scenario prompts but does not flatten the test into a misleading earnings slider; use your actual awarded payment amount where necessary.";
    } else if (rule && rule.incomeBasis && rule.incomeBasis !== "personal_employment_income") {
      $("payment-scenario-note").textContent = "The work-income chart covers your personal earnings component. This circumstance also needs " + rule.incomeBasis.replaceAll("_"," ") + ", so the actual Centrelink outcome can differ.";
    } else {
      $("payment-scenario-note").textContent = "The earnings chart covers the configured personal work-income test. Other listed tests can still change eligibility or the final payment.";
    }

    const support = (data && Array.isArray(data.additionalSupport)) ? data.additionalSupport : [];
    $("additional-support-list").innerHTML = support.length ? support.map(item => {
      const rates = Array.isArray(item.rates) ? item.rates.filter(x => x && x.amount != null) : [];
      const rateText = rates.slice(0,2).map(x => esc(x.label) + ": " + money(rateToFN(x.amount,x.unit))).join(" · ");
      return '<div class="support-item">' +
        '<b>' + esc(item.name) + '</b>' +
        '<span>' + esc((item.category || "support").replaceAll("_"," ")) + '</span>' +
        (item.description ? '<p>' + esc(item.description) + '</p>' : '') +
        (rateText ? '<small>' + rateText + '</small>' : '') +
        '</div>';
    }).join("") : '<div class="empty-state">Additional support catalogue is unavailable from the current data feed.</div>';
  }

  function renderResultOverview(sc, prop) {
    if (!$("result-overall-status")) return;

    const rent = prop ? Number(prop.rent || 0) : 0;
    const ratio = sc.householdWeek > 0 && rent > 0 ? rent / sc.householdWeek : null;
    const rentAssistLimit = sc.bondIncomeWeek * cfg.bondRentPct;
    const generalLimit = sc.householdWeek * cfg.generalAffordabilityPct;
    const rentAssistPass = prop && rent > 0 ? rent < rentAssistLimit : null;
    const generalPass = prop && rent > 0 && sc.householdWeek > 0 ? rent <= generalLimit : null;
    const cap = prop ? bondCapForBeds(prop.beds) : 0;
    const bondGap = prop ? Math.max(0, Number(prop.bond || 0) - cap) : 0;

    $("result-income").textContent = sc.householdWeek > 0 ? money(sc.householdWeek) + "/wk" : "—";
    $("result-rent").textContent = prop && rent ? money(rent) + "/wk" : "—";
    $("result-ratio").textContent = ratio == null ? "—" : pct(ratio);
    $("result-ra").textContent = money(sc.actualRAFN / 2) + "/wk";

    let status = "Add a property to see the result";
    let copy = "RentReady will compare the property with your projected income, Rent Assistance and RentAssist settings.";

    if (prop && rent > 0 && sc.householdWeek <= 0) {
      status = "Property added — income is still missing";
      copy = "Go back to step 1 and complete the income profile to calculate the rental position.";
    } else if (prop && rent > 0 && sc.householdWeek > 0) {
      if (generalPass && rentAssistPass && bondGap <= 0) {
        status = "This property is inside the current planning ranges";
        copy = "The rent is inside both the general planning benchmark and the RentAssist rent-share test, and the entered bond is within the bedroom-based cap used here.";
      } else if (rentAssistPass && !generalPass) {
        status = "RentAssist may fit, but the rent is financially tight";
        copy = "The RentAssist rent-share test is inside range, but the rent is above the general planning benchmark by " + money(Math.max(0, rent - generalLimit)) + " per week.";
      } else if (!rentAssistPass) {
        status = "The rent is above the current RentAssist range";
        copy = "The rent is " + money(Math.max(0, rent - rentAssistLimit)) + " per week above the RentAssist rent-share ceiling used by this tool.";
      } else if (bondGap > 0) {
        status = "The rent looks workable, but the bond needs attention";
        copy = "The entered bond is " + money(bondGap) + " above the bedroom-based RentAssist cap used here.";
      }
    }

    $("result-overall-status").textContent = status;
    $("result-overall-copy").textContent = copy;
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
      copy += " For " + escText(label) + ", the configured personal work-income test reduces the payment by " + money(sc.pay.reduction) +
        " per fortnight at this work income. Assessable employment income after the selected work-income concession is " + money(sc.pay.assessableIncome) + ".";
      if (sc.pay.rule.incomeBasis && sc.pay.rule.incomeBasis !== "personal_employment_income") {
        copy += " This circumstance also has a " + sc.pay.rule.incomeBasis.replaceAll("_"," ") + " test, so use your actual payment amount if that additional test is already affecting what you receive.";
      }
    } else if (p) {
      copy += " The selected payment does not yet have a work-income taper model in this prototype, so the chosen payment amount is held constant as work income changes.";
    }
    if ($("future-ra").checked) {
      copy += propertyForAssessment() && Number(propertyForAssessment().rent || 0) > 0
        ? " Rent Assistance is estimated from the property you entered."
        : " Until you add a property, the income projection uses the potential maximum Rent Assistance for the selected household situation.";
    }
    $("income-explanation").textContent = copy;
    renderIncomeImpact(sc);
    renderPaymentCoverage();
  }

  function findPaymentCutoff(creditBalance) {
    const p = selectedPayment();
    const r = selectedRate();
    const rule = p && r ? currentWorkRule(p.slug, r.label) : null;
    if (!rule || paymentMaxFN <= 0) return null;

    const maxSearch = 12000;
    for (let income = 0; income <= maxSearch; income += 5) {
      if (paymentAtWork(income, creditBalance).paymentFN <= 0.01) return income;
    }
    return null;
  }

  function renderIncomeImpact(sc) {
    if (!$("income-impact-chart")) return;
    const p = selectedPayment();
    const r = selectedRate();
    const rule = p && r ? currentWorkRule(p.slug, r.label) : null;
    const credit = Number($("working-credit").value || 0);
    const cutoff = findPaymentCutoff(credit);

    $("impact-reduction").textContent = money(displayFromFN(sc.pay.reduction));
    $("impact-free-area").textContent = rule ? money(displayFromFN(Number(rule.freeArea || 0))) : "Not modelled";
    $("impact-cutoff").textContent = cutoff == null ? "Not modelled" : money(displayFromFN(cutoff));

    if (!rule) {
      $("income-impact-title").textContent = "Work-income impact is not yet modelled for this payment";
      $("income-impact-copy").textContent = "Your selected payment rate is included in total income, but RentReady does not yet have a configured earnings taper for this payment. The chart therefore cannot estimate a payment cutoff.";
      $("income-impact-note").className = "income-impact-note warn";
      $("income-impact-note").textContent = "Use your actual payment amount if earnings have already changed what you receive.";
      renderIncomeImpactChart(null, credit);
      return;
    }

    const label = p ? (p.shortName || p.name) : "payment";
    const freeArea = Number(rule.freeArea || 0);
    const assessable = sc.pay.assessableIncome;
    $("income-impact-title").textContent = workIncomeFN <= freeArea + credit
      ? "Your earnings are currently inside the protected/free area"
      : "Your earnings are reducing the estimated " + label;
    let ruleText = "";
    if (rule.singleTaper != null) {
      ruleText = "After the configured income-free area, the estimate reduces by " + Math.round(rule.singleTaper * 100) + " cents for each additional $1 of assessable employment income.";
    } else {
      ruleText = "After the configured income-free area, the first taper is " + Math.round(rule.taper1 * 100) + " cents per $1, then " + Math.round(rule.taper2 * 100) + " cents per $1 above the second threshold.";
    }
    const concession = selectedWorkConcession();
    const concessionText = concession ? " " + (concession.description || (concession.name + " can affect when earnings become assessable.")) : "";
    $("income-impact-copy").textContent = ruleText + concessionText;

    $("income-impact-note").className = "income-impact-note " + (sc.pay.reduction > 0 ? "warn" : "ok");
    $("income-impact-note").textContent = sc.pay.reduction > 0
      ? "At your current earnings, assessable employment income is " + money(displayFromFN(assessable)) + " per " + PERIODS[currentPeriod].label + " and the estimated payment reduction is " + money(displayFromFN(sc.pay.reduction)) + "."
      : "At your current earnings and any applicable work-income concession, this model does not reduce the selected payment yet.";

    renderIncomeImpactChart(cutoff, credit);
  }

  function renderIncomeImpactChart(cutoff, creditBalance) {
    const svg = $("income-impact-chart");
    if (!svg) return;

    const current = Math.max(0, workIncomeFN);
    const maxX = Math.max(800, current * 1.35, cutoff ? cutoff * 1.12 : 3200);
    const points = [];
    for (let i = 0; i <= 24; i++) {
      const x = maxX * i / 24;
      const pay = paymentAtWork(x, creditBalance).paymentFN;
      points.push({ x, pay, total: x + pay });
    }
    const maxY = Math.max(paymentMaxFN, ...points.map(d => d.total), 1) * 1.08;

    const W = 620, H = 230, L = 48, R = 14, T = 14, B = 34;
    const pw = W - L - R, ph = H - T - B;
    const sx = x => L + (x / maxX) * pw;
    const sy = y => T + ph - (y / maxY) * ph;
    const path = key => points.map((d,i) => (i ? "L" : "M") + sx(d.x).toFixed(1) + " " + sy(d[key]).toFixed(1)).join(" ");
    const currentX = sx(Math.min(current, maxX));
    const currentPay = paymentAtWork(current, creditBalance).paymentFN;
    const ticks = [0, .25, .5, .75, 1];

    let markup = '<rect x="0" y="0" width="' + W + '" height="' + H + '" rx="10" fill="white"/>';
    ticks.forEach(t => {
      const y = sy(maxY * t);
      markup += '<line x1="' + L + '" y1="' + y + '" x2="' + (W-R) + '" y2="' + y + '" stroke="#e2e8f0" stroke-width="1"/>';
      markup += '<text x="' + (L-7) + '" y="' + (y+3) + '" text-anchor="end" font-size="9" fill="#64748b">' + money(displayFromFN(maxY*t),0) + '</text>';
    });
    ticks.forEach(t => {
      const x = L + pw * t;
      markup += '<text x="' + x + '" y="' + (H-10) + '" text-anchor="middle" font-size="9" fill="#64748b">' + money(displayFromFN(maxX*t),0) + '</text>';
    });
    markup += '<path d="' + path("pay") + '" fill="none" stroke="#4f46e5" stroke-width="3" stroke-linecap="round"/>';
    markup += '<path d="' + path("total") + '" fill="none" stroke="#15803d" stroke-width="3" stroke-linecap="round"/>';
    markup += '<line x1="' + currentX + '" y1="' + T + '" x2="' + currentX + '" y2="' + (T+ph) + '" stroke="#b45309" stroke-width="1.5" stroke-dasharray="4 4"/>';
    markup += '<circle cx="' + currentX + '" cy="' + sy(currentPay) + '" r="4" fill="#b45309"/>';
    if (cutoff != null && cutoff <= maxX) {
      const cx = sx(cutoff);
      markup += '<line x1="' + cx + '" y1="' + T + '" x2="' + cx + '" y2="' + (T+ph) + '" stroke="#94a3b8" stroke-width="1" stroke-dasharray="2 4"/>';
      markup += '<text x="' + Math.min(cx+5,W-110) + '" y="' + (T+11) + '" font-size="9" fill="#64748b">payment reaches $0</text>';
    }
    markup += '<text x="' + (L+pw/2) + '" y="' + (H-1) + '" text-anchor="middle" font-size="9" fill="#64748b">gross work income per ' + PERIODS[currentPeriod].label + '</text>';
    svg.innerHTML = markup;
  }

  function openIncomeImpactDetail() {
    const p = selectedPayment();
    const r = selectedRate();
    const rule = p && r ? currentWorkRule(p.slug, r.label) : null;
    const q = new URLSearchParams({
      payment: p ? (p.shortName || p.name) : "Payment",
      circumstance: r ? r.label : "Manual amount",
      max: String(paymentMaxFN || 0),
      work: String(workIncomeFN || 0),
      credit: String(Number($("working-credit").value || 0)),
      period: currentPeriod
    });
    if (rule) {
      q.set("freeArea", String(rule.freeArea || 0));
      if (rule.secondThreshold != null) q.set("secondThreshold", String(rule.secondThreshold));
      if (rule.taper1 != null) q.set("taper1", String(rule.taper1));
      if (rule.taper2 != null) q.set("taper2", String(rule.taper2));
      if (rule.singleTaper != null) q.set("singleTaper", String(rule.singleTaper));
    }
    if (p && p.workConcession) q.set("concession", p.workConcession);
    if (p && Array.isArray(p.scenarioPrompts)) q.set("checks", p.scenarioPrompts.join(" | "));
    window.open("income-impact.html?" + q.toString(), "rentready-income-impact", "popup=yes,width=940,height=760,resizable=yes,scrollbars=yes");
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
    if ($("account-shortlist-count")) $("account-shortlist-count").textContent = properties.length + (properties.length === 1 ? " property" : " properties");
    if (!properties.length) {
      el.innerHTML = '<div class="empty-state">No properties yet. Paste a listing or enter one manually.</div>';
      return;
    }
    el.innerHTML = properties.map(p => '<div class="property-card ' + (p.id === activePropertyId ? "active" : "") + '" data-property="' + p.id + '">' +
      '<button type="button" data-remove-property="' + p.id + '" aria-label="Remove">×</button>' +
      '<b>' + esc(p.address) + '</b><small>' + money(p.rent,0) + '/wk · ' + (p.beds || "—") + ' bed · bond ' + money(p.bond,0) + '</small></div>').join("");
  }

  function draftPropertyFromForm() {
    return {
      id: "draft",
      address: $("property-address").value.trim() || "Property being assessed",
      rent: Number($("property-rent").value || 0),
      bond: Number($("property-bond").value || 0),
      beds: Number($("property-beds").value || 0),
      available: $("property-available").value.trim(),
      raw: $("listing-text").value
    };
  }

  function propertyForAssessment() {
    const draft = draftPropertyFromForm();
    if (draft.rent > 0 || draft.bond > 0 || draft.beds > 0 || $("property-address").value.trim()) return draft;
    return activeProperty();
  }

  function loadPropertyIntoForm(prop) {
    if (!prop) return;
    $("property-address").value = prop.address || "";
    $("property-rent").value = prop.rent || "";
    $("property-bond").value = prop.bond || "";
    $("property-beds").value = prop.beds || "";
    $("property-available").value = prop.available || "";
    if (prop.raw) $("listing-text").value = prop.raw;
    renderPropertyAssessment();
  }

  function renderPropertyAssessment() {
    if (!$("property-assessment-status")) return;
    const prop = propertyForAssessment();
    const hasProperty = prop && Number(prop.rent || 0) > 0;
    const status = $("property-assessment-status");

    if (!hasProperty) {
      status.className = "assessment-status pending";
      status.textContent = "Waiting for property";
      $("property-assessment-verdict").textContent = "Paste or enter a property";
      $("property-assessment-copy").textContent = "RentReady will compare the rent and bond with your projected income as soon as the property details are available.";
      ["property-check-rent","property-check-income","property-check-ratio","property-check-ra","property-check-bond","property-check-cap"].forEach(id => $(id).textContent = "—");
      $("property-assessment-details").innerHTML = "<p>Paste a listing or enter rent, bond and bedrooms to see the assessment.</p>";
      return;
    }

    const rent = Number(prop.rent || 0);
    const bond = Number(prop.bond || 0);
    const sc = scenario(workIncomeFN, rent);
    const ratio = sc.householdWeek > 0 ? rent / sc.householdWeek : null;
    const generalLimit = sc.householdWeek * cfg.generalAffordabilityPct;
    const bondLimit = sc.bondIncomeWeek * cfg.bondRentPct;
    const cap = bondCapForBeds(prop.beds);
    const generalGap = rent - generalLimit;
    const rentAssistGap = rent - bondLimit;
    const bondGap = bond > 0 ? bond - cap : 0;

    $("property-check-rent").textContent = money(rent) + "/wk";
    $("property-check-income").textContent = sc.householdWeek > 0 ? money(sc.householdWeek) + "/wk" : "Add income";
    $("property-check-ratio").textContent = ratio == null ? "—" : pct(ratio);
    $("property-check-ra").textContent = money(sc.actualRAFN / 2) + "/wk";
    $("property-check-bond").textContent = bond ? money(bond) : "Not found";
    $("property-check-cap").textContent = prop.beds ? money(cap) : "Need bedrooms";

    let verdict = "", copy = "", state = "pending";
    if (sc.householdWeek <= 0) {
      verdict = "Add your income to assess this property";
      copy = "The listing has been read, but affordability needs the income profile from step 1.";
    } else if (rentAssistGap >= 0) {
      verdict = "This rent is above the current RentAssist rent-share range";
      copy = "The rent is " + money(rentAssistGap) + "/wk above the current RentAssist rent-share ceiling in this model.";
      state = "bad";
    } else if (generalGap > 0) {
      verdict = "RentAssist may fit, but the property is financially tight";
      copy = "The rent is within the RentAssist rent-share range used here but " + money(generalGap) + "/wk above the general planning benchmark.";
      state = "warn";
    } else if (bondGap > 0) {
      verdict = "The weekly rent looks workable, but the bond needs attention";
      copy = "The rent sits inside both rent thresholds, but the entered bond is " + money(bondGap) + " above the bedroom-based RentAssist cap used here.";
      state = "warn";
    } else {
      verdict = "This property looks within the current planning ranges";
      copy = "The weekly rent is inside both the general planning benchmark and the RentAssist rent-share threshold used by this tool.";
      state = "good";
    }

    status.className = "assessment-status " + state;
    status.textContent = state === "good" ? "Within range" : state === "warn" ? "Tight" : state === "bad" ? "Above range" : "Needs income";
    $("property-assessment-verdict").textContent = verdict;
    $("property-assessment-copy").textContent = copy;

    const bullets = [];
    if (ratio != null) bullets.push("Rent is " + pct(ratio) + " of projected weekly household income.");
    bullets.push(generalGap <= 0
      ? "General planning benchmark: " + money(-generalGap) + "/wk of headroom."
      : "General planning benchmark: " + money(generalGap) + "/wk short.");
    bullets.push(rentAssistGap < 0
      ? "RentAssist rent-share test: " + money(-rentAssistGap) + "/wk of headroom."
      : "RentAssist rent-share test: " + money(rentAssistGap) + "/wk above the current ceiling.");
    if (bond && prop.beds) bullets.push(bondGap <= 0
      ? "Bond is within the bedroom-based cap used here."
      : "Bond is " + money(bondGap) + " above the bedroom-based cap used here.");
    $("property-assessment-details").innerHTML = "<ul>" + bullets.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>";
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

  function renderApplicationReview(sc = null, prop = null) {
    if (!$("app-review-payment")) return;

    prop = prop || activeProperty();
    sc = sc || scenario(workIncomeFN, prop ? Number(prop.rent || 0) : 0);

    const payment = selectedPayment();
    const rate = selectedRate();
    const rent = prop ? Number(prop.rent || 0) : 0;
    const rentShare = sc.householdWeek > 0 && rent > 0 ? rent / sc.householdWeek : null;
    const generalLimit = sc.householdWeek * cfg.generalAffordabilityPct;
    const bondLimit = sc.bondIncomeWeek * cfg.bondRentPct;
    const generalGap = prop ? rent - generalLimit : null;
    const bondGap = prop ? rent - bondLimit : null;
    const cap = prop ? bondCapForBeds(prop.beds) : 0;
    const bondAmountGap = prop ? Math.max(0, Number(prop.bond || 0) - cap) : 0;

    $("app-review-payment").textContent = payment ? (payment.shortName || payment.name) : "Manual payment";
    $("app-review-circumstance").textContent = rate ? rate.label : "Manual amount";
    $("app-review-income").textContent = money(sc.householdWeek) + "/wk";
    $("app-review-property").textContent = prop ? prop.address : "No property selected";
    $("app-review-rent").textContent = prop ? money(rent) + "/wk" : "—";
    $("app-review-rent-share").textContent = rentShare == null ? "—" : pct(rentShare);

    const contextFlags = [];
    const paymentSlug = payment ? payment.slug : "";
    const householdType = $("household-type").value;

    if (paymentSlug === "disability-support-pension") {
      contextFlags.push({
        state:"warn",
        text:"DSP can involve disability information. If an agent asks why you receive DSP, asks for medical details, or treats you differently because of disability, that may involve a protected characteristic. Ask why the information is required and request the reason in writing."
      });
    }
    if (paymentSlug === "parenting-payment" || /^family/.test(householdType)) {
      contextFlags.push({
        state:"warn",
        text:"Parent or carer status is a protected characteristic. If children or parenting status appear to be affecting how the application is handled, keep the written communication and review the discrimination guidance below."
      });
    }
    if (paymentSlug === "carer-payment") {
      contextFlags.push({
        state:"warn",
        text:"Carer status can be relevant to protected-attribute rules. A provider may assess capacity to pay, but should not treat you unfavourably because you are a carer."
      });
    }
    if (paymentSlug === "age-pension") {
      contextFlags.push({
        state:"warn",
        text:"Age is a protected characteristic. The provider can assess capacity to pay, but age itself should not be used to treat an applicant unfavourably."
      });
    }
    if (payment) {
      contextFlags.push({
        state:"ok",
        text:"Receiving a Centrelink payment is not, by itself, a finding of discrimination. A current payment statement or letter is recognised financial evidence, and the review below focuses on whether the process asks for prohibited information or treats a protected characteristic differently."
      });
    }
    if (!contextFlags.length) {
      contextFlags.push({
        state:"ok",
        text:"No profile-based protected-characteristic prompt is triggered by the information entered so far. Use the red-flag checklist below for anything that actually happened during the application."
      });
    }
    $("app-context-flags").innerHTML = reviewList(contextFlags);

    const evidence = [];
    if (payment) {
      evidence.push({
        state:"ok",
        text:"A current Centrelink payment statement or letter can be used as one financial-evidence document."
      });
    }
    if (workIncomeFN > 0) {
      evidence.push({
        state:"ok",
        text:"A current or recent payslip can be useful as the second financial-evidence document because work income has been entered."
      });
    } else {
      evidence.push({
        state:"ok",
        text:"If a second financial document is useful, consider a permitted bank statement with daily transaction details removed, rather than oversharing transaction history."
      });
    }
    evidence.push({
      state:"ok",
      text:"Choose no more than two identity documents from the prescribed list; more is not automatically a stronger application."
    });
    $("app-evidence-pack").innerHTML = reviewList(evidence);

    const shortfalls = [];
    if (!prop) {
      shortfalls.push({state:"warn",text:"No property is selected yet, so RentReady cannot assess property-specific affordability or bond-loan shortfalls."});
    } else {
      if (generalGap > 0) {
        shortfalls.push({state:"warn",text:"The selected rent is about " + money(generalGap) + "/wk above the general " + Math.round(cfg.generalAffordabilityPct*100) + "% planning benchmark."});
      } else {
        shortfalls.push({state:"ok",text:"The selected rent is within the general planning benchmark at the projected income."});
      }

      if (bondGap >= 0) {
        shortfalls.push({state:"warn",text:"The selected rent is about " + money(bondGap) + "/wk above the current RentAssist rent-share threshold used by this tool."});
      } else {
        shortfalls.push({state:"ok",text:"The selected rent is within the RentAssist rent-share threshold used by this tool."});
      }

      if (bondAmountGap > 0) {
        shortfalls.push({state:"warn",text:"The entered bond is " + money(bondAmountGap) + " above the published bedroom-based loan cap used by this prototype."});
      }
    }

    const incomeLimit = householdIncomeLimit();
    if (sc.bondIncomeWeek > incomeLimit) {
      shortfalls.push({state:"warn",text:"Estimated weekly household income is " + money(sc.bondIncomeWeek - incomeLimit) + " above the configured RentAssist income limit for the selected household type."});
    }
    if (Number($("assets").value || 0) > cfg.bondAssetLimit) {
      shortfalls.push({state:"warn",text:"Entered assets are above the configured RentAssist asset limit."});
    }
    if (!$("permanent-resident").checked) {
      shortfalls.push({state:"warn",text:"The citizenship/permanent-residency requirement is not marked as met."});
    }
    if ($("owns-property").checked) {
      shortfalls.push({state:"warn",text:"Residential property ownership is marked, which conflicts with the configured RentAssist eligibility test."});
    }
    $("app-shortfalls").innerHTML = reviewList(shortfalls.length ? shortfalls : [{state:"ok",text:"No immediate application shortfall is identified from the information entered so far."}]);

    const strategies = [];
    if (!prop) {
      strategies.push({state:"warn",text:"Add the property first so the review can calculate rent share, bond amount and the relevant target range."});
    } else {
      const target = Math.min(generalLimit || Infinity, bondLimit || Infinity);
      if ((generalGap > 0 || bondGap >= 0) && Number.isFinite(target)) {
        strategies.push({state:"ok",text:"A target rent around " + money(Math.max(0,target),0) + "/wk or below improves the position against the tighter current rent threshold."});
      }
      if (generalGap > 0 || bondGap >= 0) {
        strategies.push({state:"ok",text:"Use the optimisation sliders to test whether additional work income improves the rent position after any payment reduction is taken into account."});
      }
      if (bondAmountGap > 0) {
        strategies.push({state:"ok",text:"Compare properties with a lower bond or check the final eligible RentAssist Bond Loan amount before relying on the loan to cover the full bond."});
      }
      if (properties.length > 1 && (generalGap > 0 || bondGap >= 0 || bondAmountGap > 0)) {
        strategies.push({state:"ok",text:"Compare the other properties in your shortlist. A lower weekly rent or lower bond can improve both affordability and the RentAssist position without changing your income."});
      }
    }
    if (payment) {
      strategies.push({state:"ok",text:"Use the Centrelink statement or letter as permitted evidence of income rather than volunteering unrelated personal information."});
    }
    strategies.push({state:"ok",text:"Keep the application focused on the prescribed form: strong evidence and complete permitted fields are more useful than supplying extra private information."});
    $("app-strategies").innerHTML = reviewList(strategies);

    renderApplicationIssues();
  }

  function reviewList(items) {
    return '<div class="review-list">' + items.map(item =>
      '<div><span class="review-dot ' + esc(item.state || "ok") + '">' +
      (item.state === "warn" ? "!" : item.state === "bad" ? "×" : "✓") +
      '</span><p>' + esc(item.text) + '</p></div>'
    ).join("") + '</div>';
  }

  function renderApplicationIssues() {
    if (!$("app-issue-results")) return;
    const checked = [...document.querySelectorAll("[data-app-issue]:checked")].map(x => x.dataset.appIssue);
    const messages = {
      extra_questions: "Extra application questions may conflict with the prescribed-form requirement. Ask the agent what part of the prescribed form authorises the question.",
      bond_history: "Questions about previous bond history or bond claims are not part of the permitted application information described in the Victorian guidance.",
      prior_dispute: "Questions about previous disputes or legal action with a rental provider are not permitted application questions.",
      bank_transactions: "Detailed daily bank transactions are not required financial evidence. If a bank statement is used, private transaction details can be removed.",
      too_many_financial: "The prescribed application limits requested financial evidence to no more than two documents.",
      too_many_id: "The prescribed application limits requested identity evidence to no more than two documents.",
      protected_no_reason: "A protected-characteristic question without a written reason is a red flag. Ask for the reason in writing and keep a copy.",
      different_treatment: "Different or worse treatment connected with a protected characteristic may raise a discrimination concern. Keep evidence and consider VEOHRC guidance; this tool does not decide whether unlawful discrimination occurred.",
      database_undisclosed: "If a tenancy database is used, the applicant should be told which database is being checked."
    };

    if (!checked.length) {
      $("app-issue-results").innerHTML = '<div class="notice info"><b>No red flags selected.</b> Tick only things that actually happened in the application process. RentReady will explain why each item matters.</div>';
      return;
    }

    $("app-issue-results").innerHTML =
      '<div class="review-list">' +
      checked.map(key =>
        '<div><span class="review-dot warn">!</span><p>' + esc(messages[key] || "Review this request against the prescribed application rules.") + '</p></div>'
      ).join("") +
      '</div><div class="notice info"><b>Strategy:</b> keep screenshots, emails and the listing; ask the agent to explain the request in writing; and use the official complaint pathway if the issue is not resolved.</div>';
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
    const prop = propertyForAssessment();
    $("optimise-work").value = Math.min(Number($("optimise-work").max), workIncomeFN);
    $("optimise-rent").value = prop && prop.rent ? Math.min(Number($("optimise-rent").max), prop.rent) : 350;
    renderOptimiser();
  }

  function renderOptimiser() {
    const work = Number($("optimise-work").value || 0);
    const rent = Number($("optimise-rent").value || 0);
    renderIncomeTarget();
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
      $("optimise-verdict").textContent = "RentAssist rent test passes; general affordability is tighter";
      $("optimise-copy").textContent = "The property is inside the bond-loan rent-share threshold, but above the general planning benchmark.";
    } else {
      $("optimise-verdict").textContent = "The RentAssist rent-share test is still the immediate constraint";
      $("optimise-copy").textContent = "Move rent down or work income up to see where the test crosses into range.";
    }

    $("target-general-income").textContent = requiredWorkText(rent, cfg.generalAffordabilityPct, "general");
    $("target-bond-income").textContent = requiredWorkText(rent, cfg.bondRentPct, "bond");
  }

  function paymentReductionStartFN() {
    const p = selectedPayment();
    const r = selectedRate();
    const rule = p && r ? currentWorkRule(p.slug, r.label) : null;
    if (!rule) return null;

    const balance = Math.max(0, Number($("working-credit").value || 0));
    const concession = rule.workConcession || (p && p.workConcession) || null;
    let offset = 0;

    if (concession === "working_credit" || concession === "income_bank" || concession === "working_credit_or_work_bonus_if_age_eligible") {
      offset = balance;
    } else if (concession === "work_bonus") {
      offset = balance + 300;
    }

    return Math.max(0, Number(rule.freeArea || 0) + offset);
  }

  function workTargetForProperty(rent) {
    rent = Number(rent || 0);
    if (!rent) return null;

    const max = 12000;
    for (let w = 0; w <= max; w += 10) {
      const sc = scenario(w, rent);
      const generalPass = rent <= sc.householdWeek * cfg.generalAffordabilityPct;
      const rentAssistPass = rent < sc.bondIncomeWeek * cfg.bondRentPct;
      if (generalPass && rentAssistPass) return w;
    }
    return Infinity;
  }

  function renderIncomeTarget() {
    if (!$("ideal-work-target")) return;

    const prop = propertyForAssessment();
    const rent = prop ? Number(prop.rent || 0) : 0;
    const current = Math.max(0, workIncomeFN);
    const reductionStart = paymentReductionStartFN();
    const cutoff = findPaymentCutoff(Number($("working-credit").value || 0));
    const target = rent > 0 ? workTargetForProperty(rent) : null;

    $("target-current-work").textContent = money(displayFromFN(current),0) + " / " + PERIODS[currentPeriod].label;
    $("target-reduction-start").textContent = reductionStart == null
      ? "Not modelled"
      : money(displayFromFN(reductionStart),0) + " / " + PERIODS[currentPeriod].label;
    $("target-payment-cutoff").textContent = cutoff == null
      ? "Not modelled"
      : money(displayFromFN(cutoff),0) + " / " + PERIODS[currentPeriod].label;

    if (!rent) {
      $("ideal-work-target").textContent = "Add a property first";
      $("target-extra-work").textContent = "—";
      $("ideal-work-target-copy").textContent = "The income target depends on the weekly rent of the property you are considering.";
      return;
    }

    if (target === Infinity) {
      $("ideal-work-target").textContent = "Above the modelled work-income range";
      $("target-extra-work").textContent = "Above modelled range";
      $("ideal-work-target-copy").textContent = "Increasing work income alone does not bring this property inside both planning thresholds within the modelled range. A lower rent may be the more effective lever.";
      return;
    }

    const extra = Math.max(0, target - current);
    $("ideal-work-target").textContent = money(displayFromFN(target),0) + " / " + PERIODS[currentPeriod].label;
    $("target-extra-work").textContent = extra > 0
      ? money(displayFromFN(extra),0) + " / " + PERIODS[currentPeriod].label
      : "$0 — current work income is already at or above the modelled target";

    if (extra > 0) {
      $("ideal-work-target-copy").textContent =
        "For the current rent of " + money(rent,0) + " per week, the model first reaches both planning thresholds at about " +
        money(displayFromFN(target),0) + " of gross work income per " + PERIODS[currentPeriod].label +
        ". That is about " + money(displayFromFN(extra),0) + " more than the work income currently entered.";
    } else {
      $("ideal-work-target-copy").textContent =
        "Your current work income is already at or above the minimum modelled level needed for this property to sit inside both planning thresholds.";
    }
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

    function setDisplayPeriod(period) {
      currentPeriod = period;
      document.querySelectorAll("[data-period]").forEach(x =>
        x.classList.toggle("active", x.dataset.period === period)
      );
      document.querySelectorAll("[data-rate-period]").forEach(x =>
        x.classList.toggle("active", x.dataset.ratePeriod === period)
      );
      syncInputsToPeriod();
      renderOptimiser();
    }

    document.querySelectorAll("[data-period]").forEach(b =>
      b.addEventListener("click", () => setDisplayPeriod(b.dataset.period))
    );

    document.querySelectorAll("[data-rate-period]").forEach(b =>
      b.addEventListener("click", () => setDisplayPeriod(b.dataset.ratePeriod))
    );

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
    $("open-income-impact").addEventListener("click", openIncomeImpactDetail);
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
      recalcAll();
    });
    ["property-address","property-rent","property-bond","property-beds","property-available"].forEach(id =>
      $(id).addEventListener("input", recalcAll)
    );
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
        persistProperties();
        const selected = activeProperty();
        loadPropertyIntoForm(selected);
        renderShortlist();
        recalcAll();
        setStep("property");
        $("account-popover").hidden = true;
        $("account-toggle").setAttribute("aria-expanded","false");
      }
    });

    document.querySelectorAll("[data-app-issue]").forEach(input =>
      input.addEventListener("change", renderApplicationIssues)
    );

    $("optimise-work").addEventListener("input", renderOptimiser);
    $("optimise-rent").addEventListener("input", renderOptimiser);

    function renderAccount() {
      const signed = !!accountEmail;
      $("account-login").hidden = signed;
      $("account-signed").hidden = !signed;
      $("account-label").textContent = signed ? accountEmail.split("@")[0] : "Sign in";
      $("account-subtitle").textContent = signed ? "Shortlist & saved work" : "Shortlist & saved work";
      $("account-avatar").textContent = signed ? accountEmail.slice(0,1).toUpperCase() : "G";
      $("account-email-display").textContent = signed ? accountEmail : "—";
    }

    $("account-toggle").addEventListener("click", e => {
      e.stopPropagation();
      const pop = $("account-popover");
      pop.hidden = !pop.hidden;
      $("account-toggle").setAttribute("aria-expanded", String(!pop.hidden));
    });
    $("account-popover").addEventListener("click", e => e.stopPropagation());
    document.addEventListener("click", () => {
      $("account-popover").hidden = true;
      $("account-toggle").setAttribute("aria-expanded","false");
    });
    $("account-signin").addEventListener("click", () => {
      const email = $("account-email").value.trim();
      if (!email || !email.includes("@")) {
        $("account-email").focus();
        return;
      }
      accountEmail = email;
      localStorage.setItem(STORAGE.account, accountEmail);
      renderAccount();
    });
    $("account-signout").addEventListener("click", () => {
      accountEmail = "";
      localStorage.removeItem(STORAGE.account);
      renderAccount();
    });
    renderAccount();
  }

  bind();
  renderShortlist();
  loadPaymentData();
  recalcAll();
})();