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
  let impactTestWorkFN = null;
  let otherIncomeWeek = 0;
  let workingCreditEstimateFN = null;
  let rentAssistExplored = false;
  let properties = loadJSON(STORAGE.props, []);
  let activePropertyId = localStorage.getItem(STORAGE.active) || null;
  let accountEmail = localStorage.getItem(STORAGE.account) || "";
  let dismissedScenarios = loadJSON("rentready-dismissed-scenarios-v1", {});
  let activeScenarioCode = null;

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

  const SCENARIO_INFO = {
    assets: {
      title: "Assets test",
      summary: "Some payments have asset limits as well as an income test.",
      body: "<p>Centrelink can apply an assets test separately from the work-income test. A person can be under the earnings limit but still have their payment reduced or stopped because of assessable assets.</p><p>RentReady does not infer your Centrelink asset position from the rental form. If you know the assets test does not apply to your situation, you can mark this check not applicable for this assessment.</p>",
      link: "https://guides.dss.gov.au/social-security-guide/4/2"
    },
    deeming: {
      title: "Deeming of financial assets",
      summary: "Some financial assets are converted to deemed income for the income test.",
      body: "<p>For some pension and allowance assessments, financial investments can be treated as producing a set amount of income under deeming rules, regardless of the actual return.</p><p>This can change the payment even when employment income is unchanged.</p>",
      link: "https://guides.dss.gov.au/social-security-guide/4/4"
    },
    partner_income: {
      title: "Partner income",
      summary: "A partner's income can independently reduce or stop some payments.",
      body: "<p>If you are partnered, Centrelink may use your partner's income in addition to your own income. The thresholds and effect depend on the payment and circumstance selected.</p><p>RentReady removes this check automatically when you have selected a Single circumstance.</p>",
      link: "https://guides.dss.gov.au/social-security-guide"
    },
    parental_income_if_dependent: {
      title: "Parental income if you are dependent",
      summary: "Dependent Youth Allowance and ABSTUDY claims can be affected by parental income.",
      body: "<p>For some dependent young people, parental means testing can change entitlement even when the person's own work income is under the personal income limit.</p><p>If Centrelink treats you as independent, mark this check not applicable.</p>",
      link: "https://guides.dss.gov.au/social-security-guide"
    },
    maintenance_income: {
      title: "Maintenance income",
      summary: "Child support or maintenance income can affect some family and student assessments.",
      body: "<p>Some family-assistance and ABSTUDY assessments include maintenance income tests. This is separate from the personal work-income taper shown in the earnings chart.</p>",
      link: "https://guides.dss.gov.au/social-security-guide"
    },
    residence: {
      title: "Residence and waiting-period rules",
      summary: "Residence status and waiting periods can affect eligibility.",
      body: "<p>Some payments require Australian residence conditions or waiting periods. These rules affect whether a payment is payable at all and are separate from the work-income calculation.</p>",
      link: "https://guides.dss.gov.au/social-security-guide"
    },
    working_credit: {
      title: "Working Credit",
      summary: "Credits can offset employment income before the personal income test is applied.",
      body: "<p>Working Credits can reduce the amount of employment income counted by the personal income test. The balance can therefore delay when earnings begin reducing your payment.</p><p>Use the ? beside Working Credit balance for the separate balance estimator.</p>",
      link: "https://www.servicesaustralia.gov.au/working-credit"
    },
    income_bank: {
      title: "Income Bank",
      summary: "Student Income Bank credits can offset employment income before the student income test.",
      body: "<p>For eligible student payments, Income Bank credits can build when income is low and can later offset employment income before the personal income test is applied.</p>",
      link: "https://www.servicesaustralia.gov.au/income-bank"
    },
    work_bonus: {
      title: "Work Bonus",
      summary: "Eligible pensioners may have employment income disregarded before the pension income test.",
      body: "<p>The Work Bonus can reduce the amount of eligible work income counted under the pension income test and can include an income-bank balance.</p>",
      link: "https://www.servicesaustralia.gov.au/work-bonus"
    }
  };

  const NO_WORK_INFO = {
    looking: {
      title: "Looking for work",
      copy: "Not currently working does not by itself create an exemption. Looking for suitable work and taking part in required activities can form part of mutual obligation requirements.",
      body: "<p>If you have mutual obligation requirements, looking for work and taking part in agreed activities can be part of those requirements. Your exact requirements depend on your payment and circumstances.</p>",
      link: "https://www.servicesaustralia.gov.au/mutual-obligation-requirements"
    },
    illness: {
      title: "Temporary illness or injury",
      copy: "You may be able to get a temporary exemption or reduced requirements if Services Australia assesses medical evidence showing that illness or injury temporarily limits your capacity.",
      body: "<p>If you cannot work or study for a short time because of sickness or injury, Services Australia may ask for an approved medical certificate. They assess the certificate and decide whether to grant an exemption or reduce/change your requirements.</p><p>Giving a certificate does not automatically create an exemption. Until Services Australia assesses it, you generally need to keep meeting your existing requirements.</p>",
      link: "https://www.servicesaustralia.gov.au/getting-medical-certificate-for-jobseeker-payment?context=51411"
    },
    reduced_capacity: {
      title: "Ongoing condition or reduced capacity",
      copy: "An ongoing condition can lead to an assessment of your work capacity and different requirements; it is not automatically treated the same as a temporary medical exemption.",
      body: "<p>Services Australia may assess reduced capacity to work, including through an Employment Services Assessment. Ongoing conditions can affect the type and level of requirements that apply.</p>",
      link: "https://www.servicesaustralia.gov.au/mutual-obligation-requirements"
    },
    principal_carer: {
      title: "Principal carer or parenting responsibilities",
      copy: "Principal carers can have different mutual obligation settings and may receive temporary exemptions in particular family circumstances.",
      body: "<p>Principal carers have additional ways to meet mutual obligation requirements because of parenting or guardianship responsibilities. Services Australia can grant temporary exemptions in specified family or special circumstances.</p>",
      link: "https://www.servicesaustralia.gov.au/exemptions-from-mutual-obligation-requirements-for-principal-carers?context=60097"
    },
    short_caring: {
      title: "Short-term caring duties",
      copy: "Short-term caring duties are one of the circumstances Services Australia lists as potentially supporting a temporary exemption.",
      body: "<p>Services Australia lists short-term caring duties among circumstances that may support a temporary exemption. You may need to provide evidence and should keep meeting requirements while an exemption request is being assessed.</p>",
      link: "https://www.servicesaustralia.gov.au/mutual-obligation-requirements"
    },
    crisis: {
      title: "Major personal crisis",
      copy: "Family and domestic violence, homelessness, bereavement and other major crises can be relevant to temporary exemption decisions.",
      body: "<p>Services Australia recognises major personal crises as circumstances that may justify a temporary exemption. Examples include family and domestic violence, homelessness and the death of an immediate family member.</p>",
      link: "https://www.servicesaustralia.gov.au/mutual-obligation-requirements"
    },
    cultural: {
      title: "Cultural or Sorry Business commitments",
      copy: "Cultural or Sorry Business commitments can be relevant to temporary exemption arrangements in some job-seeker settings.",
      body: "<p>Services Australia lists cultural or Sorry Business commitments among circumstances that may support an exemption in relevant employment-services settings.</p>",
      link: "https://www.servicesaustralia.gov.au/mutual-obligation-requirements-remote-australia-employment-service?context=51411"
    },
    disaster: {
      title: "Fire, flood or other disaster",
      copy: "A disaster affecting you at home can be a recognised temporary-exemption circumstance.",
      body: "<p>Services Australia lists disasters such as fire or flood among circumstances that may support a temporary exemption from mutual obligation requirements.</p>",
      link: "https://www.servicesaustralia.gov.au/mutual-obligation-requirements"
    },
    study: {
      title: "Study or training",
      copy: "Approved study or training can sometimes form part of your requirements rather than being an exemption from them.",
      body: "<p>Study and training can be recognised activities in some employment-services arrangements. Whether it satisfies your requirements depends on your payment, plan and circumstances.</p>",
      link: "https://www.servicesaustralia.gov.au/mutual-obligation-requirements"
    },
    other: {
      title: "Another reason",
      copy: "There may be other temporary exemption or participation arrangements depending on your circumstances.",
      body: "<p>Services Australia considers a range of individual circumstances. Contact them or your employment-services provider if none of the listed situations describes why you are not currently working.</p>",
      link: "https://www.servicesaustralia.gov.au/mutual-obligation-requirements"
    }
  };

  function workingCreditApplicable() {
    const concession = selectedWorkConcession();
    return !!(concession && (concession.code === "working_credit" || concession.code === "working_credit_or_work_bonus_if_age_eligible"));
  }

  function workingCreditCap() {
    const p = selectedPayment();
    if (!p || !workingCreditApplicable()) return 0;
    if (p.slug === "youth-allowance-jobseeker") return 3500;
    return 1000;
  }

  function wholeFortnightsBetween(start, end) {
    if (!(start instanceof Date) || isNaN(start) || !(end instanceof Date) || isNaN(end) || end < start) return 0;
    return Math.max(0, Math.floor((end.getTime() - start.getTime()) / (14 * 86400000)));
  }

  function parseLocalDate(value) {
    if (!value) return null;
    const parts = String(value).split("-").map(Number);
    if (parts.length !== 3 || parts.some(x => !Number.isFinite(x))) return null;
    return new Date(parts[0], parts[1]-1, parts[2], 12, 0, 0);
  }

  function formatLocalDate(date) {
    return new Intl.DateTimeFormat("en-AU",{day:"numeric",month:"short",year:"numeric"}).format(date);
  }

  function estimateWorkingCreditBalance() {
    const cap = workingCreditCap();
    const start = parseLocalDate($("credit-payment-start").value);
    const ever = $("credit-ever-income").value;
    const today = new Date();
    workingCreditEstimateFN = null;

    if (!cap) {
      $("credit-estimate-results").hidden = false;
      $("credit-estimated-balance").textContent = "Not a Working Credit payment";
      $("credit-estimated-confidence").textContent = "The selected payment currently uses a different work-income concession.";
      $("use-credit-estimate").disabled = true;
      return;
    }

    $("credit-estimate-cap").textContent = money(cap,0);
    $("credit-estimate-work").textContent = money(workIncomeFN,0) + "/fn";

    if (!start) {
      const fortnightsToCap = Math.ceil(cap / 48);
      $("credit-estimate-results").hidden = false;
      $("credit-estimated-balance").textContent = "Up to " + money(cap,0);
      $("credit-estimated-confidence").textContent =
        "No payment start date was entered. If your total ordinary income stayed below $48/fortnight, the maximum could build after about " +
        fortnightsToCap + " fortnights. Check myGov for the actual balance.";
      $("credit-estimate-built").textContent = "Possible range: $0–" + cap.toLocaleString("en-AU");
      $("credit-estimate-assessable").textContent = "Cannot estimate without a balance";
      $("credit-estimate-until").textContent = "Start date needed";
      $("credit-estimate-until-copy").textContent = "Add the payment start date for a more useful estimate of accumulation and how long credits may affect your income test.";
      $("use-credit-estimate").disabled = true;
      return;
    }

    if (start > today) {
      $("credit-estimate-results").hidden = false;
      $("credit-estimated-balance").textContent = "Check the start date";
      $("credit-estimated-confidence").textContent = "The payment start date is in the future.";
      $("use-credit-estimate").disabled = true;
      return;
    }

    const totalFNs = wholeFortnightsBetween(start,today);
    if ($("credit-estimate-periods")) {
      $("credit-estimate-periods").textContent = totalFNs + " fortnight" + (totalFNs === 1 ? "" : "s");
    }
    let balance = 0;
    let grossBuilt = 0;
    let confidence = "";

    if (!ever) {
      $("credit-estimate-results").hidden = false;
      $("credit-estimated-balance").textContent = "Choose an income-history answer";
      $("credit-estimated-confidence").textContent = "The payment start date has been counted, but RentReady also needs to know whether employment income has been reported since then.";
      $("credit-estimate-built").textContent = "—";
      $("credit-estimate-assessable").textContent = "—";
      $("credit-estimate-until").textContent = "More information needed";
      $("credit-estimate-until-copy").textContent = "Choose whether you have reported employment income since the payment started.";
      $("use-credit-estimate").disabled = true;
      return;
    }

    if (ever === "no") {
      grossBuilt = totalFNs * 48;
      balance = Math.min(cap,grossBuilt);
      confidence = "Upper estimate based on no reported employment income and assuming other ordinary income also stayed below $48/fortnight.";
    } else if (ever === "yes") {
      const incomeStart = parseLocalDate($("credit-income-start").value);
      const typical = Math.max(0,Number($("credit-typical-income").value || 0));
      if (!incomeStart || incomeStart < start || incomeStart > today) {
        $("credit-estimate-results").hidden = false;
        $("credit-estimated-balance").textContent = "Add a valid income start date";
        $("credit-estimated-confidence").textContent = "To estimate a history with reported employment income, enter approximately when that income began.";
        $("use-credit-estimate").disabled = true;
        return;
      }

      const beforeIncomeFNs = wholeFortnightsBetween(start,incomeStart);
      balance = Math.min(cap,beforeIncomeFNs * 48);
      grossBuilt = beforeIncomeFNs * 48;
      const afterIncomeFNs = wholeFortnightsBetween(incomeStart,today);

      for (let i=0;i<afterIncomeFNs;i++) {
        if (typical < 48) {
          const earned = 48 - typical;
          grossBuilt += earned;
          balance = Math.min(cap,balance + earned);
        } else {
          balance = Math.max(0,balance - Math.min(balance,typical));
        }
      }
      confidence = "Rough estimate assuming the typical employment income you entered was the same every fortnight and there was no other ordinary income changing accrual.";
    } else {
      grossBuilt = totalFNs * 48;
      balance = Math.min(cap,grossBuilt);
      confidence = "Upper estimate because you are unsure about reported income history. The actual balance may be lower.";
    }

    workingCreditEstimateFN = Math.max(0,Math.min(cap,balance));
    const nowResult = paymentAtWork(workIncomeFN,workingCreditEstimateFN);
    $("credit-estimate-results").hidden = false;
    $("credit-estimated-balance").textContent = money(workingCreditEstimateFN,0);
    $("credit-estimated-confidence").textContent = confidence;
    $("credit-estimate-built").textContent = money(Math.min(cap,grossBuilt),0);
    $("credit-estimate-assessable").textContent = money(nowResult.assessableIncome,0) + "/fn";
    $("use-credit-estimate").disabled = false;

    const rule = nowResult.rule;
    if (!workIncomeFN) {
      $("credit-estimate-until").textContent = "Credits are not being used by work income";
      $("credit-estimate-until-copy").textContent =
        "With $0 employment income entered, Working Credits would not be needed to offset work income. If total ordinary income remains below $48/fortnight, the balance may continue to build up to the cap.";
      return;
    }

    if (!rule) {
      $("credit-estimate-until").textContent = "Payment taper not modelled";
      $("credit-estimate-until-copy").textContent = "RentReady can estimate the credit balance, but not when this payment would begin reducing.";
      return;
    }

    if (workIncomeFN <= Number(rule.freeArea || 0)) {
      $("credit-estimate-until").textContent = "Current work income is within the income-free area";
      $("credit-estimate-until-copy").textContent =
        "At the current work income, the personal income test would not reduce the payment even after Working Credits were exhausted, based on the configured rule.";
      return;
    }

    let remaining = workingCreditEstimateFN;
    let firstReduction = null;
    for (let fn=0;fn<=260;fn++) {
      const result = paymentAtWork(workIncomeFN,remaining);
      if (result.reduction > 0.01) { firstReduction = fn; break; }
      if (workIncomeFN < 48) remaining = Math.min(cap,remaining + (48-workIncomeFN));
      else remaining = Math.max(0,remaining - Math.min(remaining,workIncomeFN));
    }

    if (firstReduction === 0) {
      $("credit-estimate-until").textContent = "The payment may already be reducing";
      $("credit-estimate-until-copy").textContent =
        "At the current work income and estimated balance, the configured income test already produces a payment reduction this fortnight.";
    } else if (firstReduction != null) {
      const date = new Date(today.getTime() + firstReduction * 14 * 86400000);
      $("credit-estimate-until").textContent = "About " + firstReduction + " fortnight" + (firstReduction===1?"":"s") + " · around " + formatLocalDate(date);
      $("credit-estimate-until-copy").textContent =
        "If your employment income stayed at about " + money(workIncomeFN,0) + "/fortnight and no other factors changed, the model first shows a payment reduction around this point. Your actual reporting cycle and income history can shift the date.";
    } else {
      $("credit-estimate-until").textContent = "No reduction within the modelled period";
      $("credit-estimate-until-copy").textContent = "At the current earnings and configured rule, RentReady did not reach a payment reduction within the modelled period.";
    }
  }

  function renderNoWorkReason() {
    const value = $("no-work-reason") ? $("no-work-reason").value : "";
    const card = $("no-work-reason-card");
    if (!card) return;
    const info = NO_WORK_INFO[value];
    card.hidden = !info;
    if (!info) return;
    $("no-work-reason-title").textContent = info.title;
    $("no-work-reason-copy").textContent = info.copy;
  }

  function openNoWorkInfo() {
    const info = NO_WORK_INFO[$("no-work-reason").value];
    if (!info) return;
    $("reason-modal-title").textContent = info.title;
    $("reason-modal-body").innerHTML = info.body;
    $("reason-modal-link").href = info.link;
    $("reason-modal").hidden = false;
  }

  function closeNoWorkInfo() {
    $("reason-modal").hidden = true;
  }

  function scenarioContextKey() {
    const p = selectedPayment();
    const r = selectedRate();
    return (p ? p.slug : "none") + "|" + (r ? String(r.label || "") : "none");
  }

  function dismissScenario(code) {
    const key = scenarioContextKey();
    const existing = Array.isArray(dismissedScenarios[key]) ? dismissedScenarios[key] : [];
    if (!existing.includes(code)) existing.push(code);
    dismissedScenarios[key] = existing;
    saveJSON("rentready-dismissed-scenarios-v1",dismissedScenarios);
    renderPaymentScenarioGuidance();
  }

  function relevantScenarioCodes() {
    const p = selectedPayment();
    const r = selectedRate();
    const rule = p && r ? currentWorkRule(p.slug,r.label) : null;
    if (!p) return [];

    const codes = new Set();
    const baseTests = p.incomeTest && Array.isArray(p.incomeTest.other_tests) ? p.incomeTest.other_tests : [];
    baseTests.forEach(x => codes.add(x));
    if (rule && Array.isArray(rule.otherTests)) rule.otherTests.forEach(x => codes.add(x));

    if (selectedCircumstanceIsSingle()) codes.delete("partner_income");
    const label = String(r && r.label || "").toLowerCase();
    if (label.includes("independent")) codes.delete("parental_income_if_dependent");

    const concession = selectedWorkConcession();
    if (concession && SCENARIO_INFO[concession.code]) codes.add(concession.code);

    const dismissed = new Set(dismissedScenarios[scenarioContextKey()] || []);
    return [...codes].filter(code => SCENARIO_INFO[code] && !dismissed.has(code));
  }

  function openScenarioModal(code) {
    const info = SCENARIO_INFO[code];
    if (!info) return;
    activeScenarioCode = code;
    $("scenario-modal-title").textContent = info.title;
    $("scenario-modal-body").innerHTML = info.body;
    $("scenario-modal-link").href = info.link;
    $("scenario-modal").hidden = false;
  }

  function closeScenarioModal() {
    $("scenario-modal").hidden = true;
    activeScenarioCode = null;
  }

  function renderPaymentScenarioGuidance() {
    if (!$("scenario-prompts")) return;
    const p = selectedPayment();
    const input = $("working-credit");
    if (!p) {
      $("scenario-prompts").innerHTML = '<div class="empty-state">Select a payment to see any remaining eligibility checks.</div>';
      $("scenario-count").textContent = "No payment selected";
      return;
    }

    const concession = selectedWorkConcession();
    if ($("working-credit-help")) {
      $("working-credit-help").hidden = !(concession && (concession.code === "working_credit" || concession.code === "working_credit_or_work_bonus_if_age_eligible"));
    }
    if (concession && concession.code === "income_bank") {
      $("work-concession-label").textContent = "Income Bank balance";
      input.max = String(concession.student_balance_max || 13500);
      $("work-concession-help").textContent = "Income Bank credits can offset employment income before the student payment income test is applied.";
    } else if (concession && concession.code === "work_bonus") {
      $("work-concession-label").textContent = "Work Bonus income bank balance";
      input.max = String(concession.balance_max || 11800);
      $("work-concession-help").textContent = "For eligible pensioners, the Work Bonus can disregard work income before the pension income test.";
    } else if (concession && (concession.code === "working_credit" || concession.code === "working_credit_or_work_bonus_if_age_eligible")) {
      $("work-concession-label").textContent = "Working Credit balance";
      input.max = String(p.slug === "youth-allowance-jobseeker"
        ? (concession.youth_jobseeker_balance_max || 3500)
        : (concession.balance_max || 1000));
      $("work-concession-help").textContent = "Working Credits can offset employment income before the personal income test is applied.";
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

    const codes = relevantScenarioCodes();
    $("scenario-count").textContent = codes.length
      ? codes.length + (codes.length === 1 ? " relevant check" : " relevant checks")
      : "No other checks showing";

    $("scenario-prompts").innerHTML = codes.length
      ? codes.map(code => {
          const info = SCENARIO_INFO[code];
          return '<button type="button" class="relevant-check" data-scenario-code="' + esc(code) + '">' +
            '<span><b>' + esc(info.title) + '</b><small>' + esc(info.summary) + '</small></span>' +
            '<i>?</i></button>';
        }).join("")
      : '<div class="empty-state">Nothing else is currently flagged from the payment and circumstance you selected.</div>';
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

  function rentAssistAvailable() {
    return !!($("future-ra") && $("future-ra").checked);
  }

  function rentAssistActive() {
    return rentAssistAvailable() && rentAssistExplored;
  }

  function updateRentAssistVisibility() {
    const available = rentAssistAvailable();
    if (!available) rentAssistExplored = false;
    const active = available && rentAssistExplored;

    if ($("rent-assistance-details")) $("rent-assistance-details").hidden = !available;
    if ($("rentassist-explore-offer")) $("rentassist-explore-offer").hidden = !available || active;
    if ($("rentassist-explore-confirmed")) $("rentassist-explore-confirmed").hidden = !active;
    if ($("rentassist-result-section")) $("rentassist-result-section").hidden = !active;
    if ($("target-rentassist-card")) $("target-rentassist-card").hidden = !active;
    if ($("property-rentassist-cap-metric")) $("property-rentassist-cap-metric").hidden = !active;
    if ($("optimise-rentassist-gap")) $("optimise-rentassist-gap").hidden = !active;
    if ($("target-rentassist-rent")) $("target-rentassist-rent").hidden = !active;
    if ($("target-rentassist-income")) $("target-rentassist-income").hidden = !active;

    if ($("property-assessment-note")) {
      $("property-assessment-note").innerHTML = active
        ? "<b>Two different views are active.</b> RentReady shows its general affordability benchmark separately from the official RentAssist Bond Loan rent-share test."
        : available
          ? "<b>Rent Assistance is included.</b> RentAssist Bond Loan is still optional. Choose “Explore RentAssist Bond Loan” in Step 1 if you want the Housing Victoria eligibility rules added."
          : "<b>General affordability first.</b> RentAssist remains hidden unless you choose Rent Assistance and then explicitly explore the bond-loan scheme.";
    }
  }

  function recalcAll() {
    updateRentAssistVisibility();
    updateWorkStatusUI();
    updateRentalArrangementUI();
    updateOtherHouseholdIncomeVisibility();
    renderPaymentScenarioGuidance();
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
    renderTargetRentPlanner();
  }

  function renderPaymentCoverage() {
    if (!$("additional-support-list")) return;
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
    const active = rentAssistActive();
    const rent = prop ? Number(prop.rent || 0) : 0;
    const ratio = sc.householdWeek > 0 && rent > 0 ? rent / sc.householdWeek : null;
    const generalLimit = sc.householdWeek * cfg.generalAffordabilityPct;
    const generalPass = prop && rent > 0 && sc.householdWeek > 0 ? rent <= generalLimit : null;

    $("result-income").textContent = sc.householdWeek > 0 ? money(sc.householdWeek) + "/wk" : "—";
    $("result-rent").textContent = prop && rent ? money(rent) + "/wk" : "—";
    $("result-ratio").textContent = ratio == null ? "—" : pct(ratio);
    $("result-ra").textContent = rentAssistAvailable() ? money(sc.actualRAFN / 2) + "/wk" : "Not included";

    let status = "Add a property to see the result";
    let copy = "RentReady will compare the property with your projected income.";

    if (prop && rent > 0 && sc.householdWeek <= 0) {
      status = "Property added — income is still missing";
      copy = "Go back to Step 1 and complete the income profile to calculate the rental position.";
    } else if (prop && rent > 0 && sc.householdWeek > 0 && !active) {
      if (generalPass) {
        status = "This property is inside the current planning benchmark";
        copy = "The selected rent is within RentReady's general affordability aim. RentAssist is not part of this result unless you explicitly choose to explore the bond-loan scheme.";
      } else {
        status = "This property is above the current planning benchmark";
        copy = "The selected rent is about " + money(Math.max(0,rent-generalLimit),0) + "/wk above RentReady's general affordability aim.";
      }
    } else if (prop && rent > 0 && sc.householdWeek > 0 && active) {
      const rentAssistLimit = sc.bondIncomeWeek * cfg.bondRentPct;
      const rentAssistPass = rent < rentAssistLimit;
      const cap = bondCapForBeds(prop.beds);
      const bondAmountGap = Math.max(0,Number(prop.bond || 0)-cap);

      if (generalPass && rentAssistPass && bondAmountGap <= 0) {
        status = "This property is inside the current planning and RentAssist ranges";
        copy = "The rent is inside the general planning benchmark and under the RentAssist rent-share ceiling; the entered bond is also within the published bedroom-based cap.";
      } else if (rentAssistPass && !generalPass) {
        status = "RentAssist may fit, but the rent is financially tight";
        copy = "The RentAssist rent-share rule is inside range, but the rent is above the general planning benchmark by " + money(Math.max(0,rent-generalLimit),0) + "/wk.";
      } else if (!rentAssistPass) {
        status = "The rent is above the RentAssist rent-share rule";
        copy = "Your rent share is " + pct(sc.bondIncomeWeek > 0 ? rent/sc.bondIncomeWeek : 0) +
          " of the Housing Victoria income basis. The scheme requires it to be under " + Math.round(cfg.bondRentPct*100) + "%.";
      } else if (bondAmountGap > 0) {
        status = "The rent looks workable, but the bond needs attention";
        copy = "The entered bond is " + money(bondAmountGap,0) + " above the published bedroom-based RentAssist maximum.";
      }
    }

    $("result-overall-status").textContent = status;
    $("result-overall-copy").textContent = copy;
  }


  function currentWorkStatus() {
    if ($("work-status-yes") && $("work-status-yes").checked) return "yes";
    if ($("work-status-no") && $("work-status-no").checked) return "no";
    return "";
  }

  function updateWorkStatusUI() {
    if (!$("current-work-income-wrap") || !$("no-work-panel")) return;
    const status = currentWorkStatus();
    $("current-work-income-wrap").hidden = status !== "yes";
    $("no-work-panel").hidden = status !== "no";
    $("work-income").disabled = status !== "yes";
    $("impact-income-slider").disabled = status !== "yes";

    if (status === "no" && workIncomeFN !== 0) {
      workIncomeFN = 0;
      impactTestWorkFN = 0;
      $("work-income").value = "0";
      $("impact-income-slider").value = "0";
    }
  }

  function renderIncomeFreeWarning(sc,rule) {
    if (!$("income-free-warning")) return;
    const status = currentWorkStatus();
    const freeArea = rule ? Number(rule.freeArea || 0) : 0;
    const workEntered = status === "yes" && workIncomeFN > 0 && !$("current-work-income-wrap").hidden;
    const above = workEntered && rule && workIncomeFN > freeArea;
    $("income-free-warning").hidden = !above;
    if (!above) return;

    const freeDisplay = money(displayFromFN(freeArea),0);
    if (sc && sc.pay && sc.pay.reduction > 0.01) {
      $("income-free-warning-title").textContent = "Your work income may already be reducing your Centrelink payment";
      $("income-free-warning-copy").textContent =
        "Your gross work income is above the configured income-free area of about " + freeDisplay +
        " per " + PERIODS[currentPeriod].label + ". This model estimates a current payment reduction of about " +
        money(displayFromFN(sc.pay.reduction),0) + " per " + PERIODS[currentPeriod].label +
        ". Other Centrelink tests can also change the result.";
    } else {
      $("income-free-warning-title").textContent = "Your earnings are above the base income-free area";
      $("income-free-warning-copy").textContent =
        "This may have Centrelink implications. Your gross work income is above about " + freeDisplay +
        " per " + PERIODS[currentPeriod].label +
        ", but available work-income credits may currently be delaying a payment reduction. See the detailed impact section below.";
    }
  }

  function rentalArrangement() {
    if ($("rental-arrangement-share") && $("rental-arrangement-share").checked) return "share";
    if ($("rental-arrangement-own") && $("rental-arrangement-own").checked) return "own";
    return "";
  }

  function selectedCircumstanceHasChildren() {
    const r = selectedRate();
    return !!(r && /(dependent child|with child|children|principal carer)/i.test(String(r.label || "")));
  }

  function syncRentAssistanceToArrangement() {
    const arrangement = rentalArrangement();
    if (!$("ra-situation") || !arrangement) return;
    if (!selectedCircumstanceIsSingle() || selectedCircumstanceHasChildren()) return;

    const options = [...$("ra-situation").options].map(o => o.value);
    if (arrangement === "share" && options.includes("isp_single_sharer")) {
      $("ra-situation").value = "isp_single_sharer";
    }
    if (arrangement === "own" && options.includes("isp_single") && $("ra-situation").value === "isp_single_sharer") {
      $("ra-situation").value = "isp_single";
    }
  }

  function updateRentalArrangementUI() {
    if (!$("target-rent-entry")) return;
    const arrangement = rentalArrangement();
    $("target-rent-entry").hidden = !arrangement;
    if ($("target-rent-label")) {
      $("target-rent-label").textContent = arrangement === "share" ? "Your target weekly rent share" : "Target weekly rent";
    }
    if ($("rental-arrangement-context")) {
      if (!arrangement) {
        $("rental-arrangement-context").textContent = "Choose an arrangement before setting the target rent.";
      } else if (arrangement === "share") {
        $("rental-arrangement-context").textContent =
          "Enter the amount you personally expect to pay each week. For an eligible single renter with no dependent children, RentReady also uses the single-sharer Rent Assistance context.";
      } else {
        $("rental-arrangement-context").textContent =
          "Enter the weekly rent you expect to be responsible for in your own apartment or house.";
      }
    }
    syncRentAssistanceToArrangement();
  }

  function selectedCircumstanceIsSingle() {
    const rate = selectedRate();
    return !!(rate && /\bsingle\b/i.test(String(rate.label || "")));
  }

  function updateOtherHouseholdIncomeVisibility() {
    const field = $("other-household-income-field");
    const input = $("other-income-week");
    if (!field || !input) return;

    const single = selectedCircumstanceIsSingle();
    field.hidden = single;

    if (single) {
      otherIncomeWeek = 0;
      input.value = "0";
    }
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
    let copy = selectedCircumstanceIsSingle()
      ? "Projected income combines work and the selected support payment. Other household income is not included because the selected circumstance is Single."
      : "Projected income combines work, the selected support payment and other household income.";
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
    renderIncomeFreeWarning(sc, rule);

    $("impact-reduction").textContent = money(displayFromFN(sc.pay.reduction));
    $("impact-free-area").textContent = rule ? money(displayFromFN(Number(rule.freeArea || 0))) : "Not modelled";
    $("impact-cutoff").textContent = cutoff == null ? "Not modelled" : money(displayFromFN(cutoff));

    if (!rule) {
      $("income-impact-title").textContent = "Work-income impact is not yet modelled for this payment";
      $("income-impact-copy").textContent = "Your selected payment rate is included in total income, but RentReady does not yet have a configured earnings taper for this payment. The chart therefore cannot estimate a payment cutoff.";
      $("income-impact-note").className = "income-impact-note warn";
      $("income-impact-note").textContent = "Use your actual payment amount if earnings have already changed what you receive.";
      renderCentrelinkImpactNotice(sc, null, cutoff);
      renderIncomeImpactExplorer(null, cutoff);
      renderIncomeImpactChart(cutoff, credit, workIncomeFN);
      return;
    }

    const label = p ? (p.shortName || p.name) : "payment";
    const reductionStart = paymentReductionStartFN();
    const assessable = sc.pay.assessableIncome;

    $("income-impact-title").textContent = reductionStart != null && workIncomeFN <= reductionStart
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

    renderCentrelinkImpactNotice(sc, rule, cutoff);
    renderIncomeImpactExplorer(rule, cutoff);
    renderIncomeImpactChart(cutoff, credit, workIncomeFN);
  }

  function renderCentrelinkImpactNotice(sc, rule, cutoff) {
    if (!$("centrelink-impact-now")) return;

    const period = PERIODS[currentPeriod].label;
    const workDisplay = money(displayFromFN(workIncomeFN),0);
    const paymentDisplay = money(displayFromFN(sc.pay.paymentFN),0);

    if (!rule) {
      $("centrelink-impact-now").textContent =
        "RentReady cannot reliably model how extra earnings change this payment yet. Your entered work income is still included in household income.";
      $("centrelink-impact-more").textContent =
        "Use the actual payment amount from Services Australia if your earnings have already changed what you receive.";
      $("centrelink-impact-example").textContent =
        "The example is unavailable because a reliable personal work-income taper is not configured for this payment.";
      return;
    }

    const reductionStartFN = paymentReductionStartFN();
    const reductionStartDisplay = reductionStartFN == null ? null : money(displayFromFN(reductionStartFN),0);
    const remainingBeforeReduction = reductionStartFN == null ? 0 : Math.max(0, reductionStartFN - workIncomeFN);

    if (sc.pay.reduction <= 0.01) {
      $("centrelink-impact-now").textContent =
        "At " + workDisplay + " of gross work income per " + period + ", the current model keeps your estimated payment at about " +
        paymentDisplay + ". You can earn about " + money(displayFromFN(remainingBeforeReduction),0) +
        " more per " + period + " before this personal work-income test starts reducing the payment.";
    } else {
      $("centrelink-impact-now").textContent =
        "At " + workDisplay + " of gross work income per " + period + ", your estimated payment is reduced by about " +
        money(displayFromFN(sc.pay.reduction),0) + ", leaving about " + paymentDisplay + " of payment per " + period + ".";
    }

    const concession = selectedWorkConcession();
    const concessionName = concession ? (concession.name || "work-income credits") : null;
    const concessionTail = concessionName
      ? " " + concessionName + " is applied before the personal employment-income test, so available credits can delay when earnings start reducing the payment."
      : "";

    if (rule.singleTaper != null) {
      const taperPct = Math.round(rule.singleTaper * 100);
      $("centrelink-impact-more").textContent =
        "Once gross earnings move beyond about " + (reductionStartDisplay || "the income-free point") +
        " per " + period + ", each extra $1 of assessable employment income reduces the payment by about " +
        taperPct + " cents." + concessionTail;

      $("centrelink-impact-example").textContent =
        "In that taper range, an extra $100 of assessable work income would reduce the payment by about $" +
        taperPct + ". Before tax and any other Centrelink tests, combined work income plus payment would still rise by about $" +
        (100 - taperPct) + ".";
    } else {
      const taper1 = Math.round(Number(rule.taper1 || 0) * 100);
      const taper2 = Math.round(Number(rule.taper2 || 0) * 100);
      const creditOffsetFN = Math.max(0, Number(reductionStartFN || 0) - Number(rule.freeArea || 0));
      const secondGrossFN = rule.secondThreshold == null ? null : Number(rule.secondThreshold) + creditOffsetFN;
      const secondDisplay = secondGrossFN == null ? null : money(displayFromFN(secondGrossFN),0);

      $("centrelink-impact-more").textContent =
        "Once gross earnings move beyond about " + (reductionStartDisplay || "the income-free point") + " per " + period +
        ", the first taper reduces the payment by about " + taper1 + " cents for each extra $1. Above " +
        (secondDisplay || "the second threshold") + " per " + period + ", the reduction rises to about " +
        taper2 + " cents per extra $1." + concessionTail;

      $("centrelink-impact-example").textContent =
        "In the first taper range, another $100 of assessable work income reduces the payment by about $" + taper1 +
        ", so work income plus payment still rises by about $" + (100 - taper1) +
        " before tax and other tests. Above the second threshold, the same $100 reduces payment by about $" + taper2 +
        ", leaving about $" + (100 - taper2) + " extra combined income.";
    }
  }

  function impactSliderStep() {
    if (currentPeriod === "week") return 10;
    if (currentPeriod === "fortnight") return 20;
    if (currentPeriod === "month") return 50;
    return 500;
  }

  function renderIncomeImpactExplorer(rule, cutoff) {
    const slider = $("impact-income-slider");
    if (!slider) return;

    const reductionStart = rule ? paymentReductionStartFN() : null;
    const maxFN = Math.max(3200, cutoff ? cutoff * 1.15 : 0, workIncomeFN * 1.5);
    const maxDisplay = Math.max(impactSliderStep(), displayFromFN(maxFN));
    const currentDisplay = Math.min(maxDisplay, Math.max(0, displayFromFN(workIncomeFN)));

    slider.min = "0";
    slider.max = String(Math.ceil(maxDisplay / impactSliderStep()) * impactSliderStep());
    slider.step = String(impactSliderStep());
    slider.value = String(currentDisplay);

    $("impact-slider-free").textContent = reductionStart == null
      ? "Payment reduction starts: —"
      : "Payment reduction starts: " + money(displayFromFN(reductionStart),0);
    $("impact-slider-cutoff").textContent = cutoff == null
      ? "Payment $0: —"
      : "Payment $0: " + money(displayFromFN(cutoff),0);
  }

  function renderIncomeImpactChart(cutoff, creditBalance, testedWorkFN = null) {
    const svg = $("income-impact-chart");
    if (!svg) return;

    const current = Math.max(0, workIncomeFN);
    const tested = Math.max(0, Number(testedWorkFN == null ? current : testedWorkFN));
    const maxX = Math.max(800, current * 1.35, tested * 1.25, cutoff ? cutoff * 1.12 : 3200);
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
    const testedX = sx(Math.min(tested, maxX));
    const testedPay = paymentAtWork(tested, creditBalance).paymentFN;
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
    if (Math.abs(tested-current) > 0.01) {
      markup += '<line x1="' + testedX + '" y1="' + T + '" x2="' + testedX + '" y2="' + (T+ph) + '" stroke="#4f46e5" stroke-width="2" stroke-dasharray="3 3"/>';
      markup += '<circle cx="' + testedX + '" cy="' + sy(testedPay) + '" r="5" fill="#4f46e5"/>';
    }
    if (cutoff != null && cutoff <= maxX) {
      const cx = sx(cutoff);
      markup += '<line x1="' + cx + '" y1="' + T + '" x2="' + cx + '" y2="' + (T+ph) + '" stroke="#94a3b8" stroke-width="1" stroke-dasharray="2 4"/>';
      markup += '<text x="' + Math.min(cx+5,W-110) + '" y="' + (T+11) + '" font-size="9" fill="#64748b">payment reaches $0</text>';
    }
    markup += '<text x="' + (L+pw/2) + '" y="' + (H-1) + '" text-anchor="middle" font-size="9" fill="#64748b">gross work income per ' + PERIODS[currentPeriod].label + '</text>';
    svg.innerHTML = markup;
  }

  function renderTargetRentPlanner() {
    if (!$("target-rent")) return;
    updateRentAssistVisibility();

    const rent = Math.max(0, Number($("target-rent").value || 0));
    const active = rentAssistActive();
    const raIncluded = rentAssistAvailable();
    if ($("target-ra-card")) $("target-ra-card").hidden = !raIncluded;

    if (!rent) {
      if ($("target-ra-amount")) $("target-ra-amount").textContent = "$0/wk";
      if ($("target-ra-detail")) $("target-ra-detail").textContent = raIncluded
        ? "Enter a target weekly rent to estimate Rent Assistance from your selected household situation."
        : "Turn on Rent Assistance above to include it in this estimate.";
      $("target-market-status").textContent = "Enter a target rent";
      $("target-market-detail").textContent = "Based on the general affordability benchmark.";
      if ($("target-rentassist-status")) $("target-rentassist-status").textContent = "Enter a target rent";
      if ($("target-rentassist-detail")) $("target-rentassist-detail").textContent = "Based on the current RentAssist income basis.";
      $("target-rent-summary").textContent = active
        ? "Enter a target weekly rent to see the headroom or shortfall under both the planning benchmark and RentAssist."
        : "Enter a target weekly rent to see the general affordability position.";
      return;
    }

    const sc = scenario(workIncomeFN, rent);

    if (raIncluded && $("target-ra-amount")) {
      const raWeek = Number(sc.actualRAFN || 0) / 2;
      $("target-ra-amount").textContent = money(raWeek,0) + "/wk";
      $("target-ra-detail").textContent =
        money(sc.actualRAFN,0) + "/fortnight estimated from a target rent of " + money(rent,0) +
        "/wk and the Rent Assistance household situation selected above.";
    }

    const marketLimit = sc.householdWeek * cfg.generalAffordabilityPct;
    const marketGap = rent - marketLimit;
    const marketPass = marketGap <= 0;

    $("target-market-status").textContent = marketPass
      ? "Within the planning aim"
      : money(marketGap,0) + "/wk above the planning aim";
    $("target-market-detail").textContent =
      "At this target rent, the general " + Math.round(cfg.generalAffordabilityPct*100) +
      "% planning amount is about " + money(marketLimit,0) + "/wk. This is a planning benchmark, not a government eligibility rule.";

    if (!active) {
      $("target-rent-summary").textContent = marketPass
        ? money(rent,0) + "/wk is within the current general planning aim."
        : money(rent,0) + "/wk is about " + money(marketGap,0) + "/wk above the current general planning aim.";
      return;
    }

    const rentAssistLimit = sc.bondIncomeWeek * cfg.bondRentPct;
    const rentAssistGap = rent - rentAssistLimit;
    const rentAssistPass = rentAssistGap < 0;
    const rentAssistRatio = sc.bondIncomeWeek > 0 ? rent / sc.bondIncomeWeek : 0;

    $("target-rentassist-status").textContent = rentAssistPass
      ? "Within the RentAssist rent-share rule"
      : money(Math.max(0,rentAssistGap),0) + "/wk above the RentAssist ceiling";
    $("target-rentassist-detail").textContent =
      "Your target rent is " + pct(rentAssistRatio) + " of the Housing Victoria income basis. The rule requires your rent share to be under " +
      Math.round(cfg.bondRentPct*100) + "%. The current modelled ceiling is about " + money(rentAssistLimit,0) + "/wk.";

    if (marketPass && rentAssistPass) {
      $("target-rent-summary").textContent =
        money(rent,0) + "/wk is inside both the general planning aim and the current RentAssist rent-share rule.";
    } else if (!marketPass && rentAssistPass) {
      $("target-rent-summary").textContent =
        money(rent,0) + "/wk fits the RentAssist rent-share rule but is above the general planning aim by about " +
        money(marketGap,0) + "/wk.";
    } else if (marketPass && !rentAssistPass) {
      $("target-rent-summary").textContent =
        money(rent,0) + "/wk is inside the general planning aim but is above the RentAssist ceiling by about " +
        money(Math.max(0,rentAssistGap),0) + "/wk.";
    } else {
      $("target-rent-summary").textContent =
        money(rent,0) + "/wk is above both current ranges: about " + money(marketGap,0) +
        "/wk above the planning aim and " + money(Math.max(0,rentAssistGap),0) + "/wk above the RentAssist rent-share ceiling.";
    }
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
    if (!$("bond-checks")) return;
    if (!rentAssistActive()) {
      $("bond-checks").innerHTML = "";
      return;
    }

    const limit = householdIncomeLimit();
    const assets = Number($("assets").value || 0);
    const resident = $("permanent-resident").checked;
    const owns = $("owns-property").checked;
    const incomePass = sc.bondIncomeWeek <= limit;
    const assetPass = assets <= cfg.bondAssetLimit;
    const rent = prop ? Number(prop.rent || 0) : 0;
    const rentCeiling = sc.bondIncomeWeek * cfg.bondRentPct;
    const rentRatio = prop && sc.bondIncomeWeek > 0 ? rent / sc.bondIncomeWeek : null;
    const rentPass = prop ? rent < rentCeiling : null;
    const cap = prop ? bondCapForBeds(prop.beds) : 0;
    const bondAmount = prop ? Number(prop.bond || 0) : 0;
    const bondPass = prop && bondAmount > 0 && prop.beds
      ? bondAmount <= cap
      : prop ? null : null;

    const maximumRAWeek = sc.ra ? Number(sc.ra.maximumFN || 0) / 2 : 0;
    const rentDetail = prop
      ? "Your rent share is " + money(rent,0) + "/wk, which is " + pct(rentRatio || 0) +
        " of the Housing Victoria income basis. The scheme requires less than " +
        Math.round(cfg.bondRentPct*100) + "%. " +
        (rentPass
          ? "You are about " + money(Math.max(0,rentCeiling-rent),0) + "/wk below the current ceiling."
          : "You are about " + money(Math.max(0,rent-rentCeiling),0) + "/wk above the current ceiling.") +
        " This income basis includes up to " + money(maximumRAWeek,0) + "/wk of maximum eligible Rent Assistance."
      : "Add a property to compare your rent share with the under-" + Math.round(cfg.bondRentPct*100) + "% rule.";

    const rows = [
      checkRow(incomePass, "Household income limit",
        "Your estimated income for the scheme is " + money(sc.bondIncomeWeek,0) + "/wk. " +
        (incomePass
          ? "That is within the " + money(limit,0) + "/wk limit for the selected household type."
          : "That is " + money(sc.bondIncomeWeek-limit,0) + "/wk above the " + money(limit,0) + "/wk limit."),
        "Limit " + money(limit,0) + "/wk"),
      checkRow(assetPass, "Asset limit",
        "You entered " + money(assets,0) + " of assessable assets. " +
        (assetPass
          ? "That is within the current " + money(cfg.bondAssetLimit,0) + " asset limit."
          : "That is " + money(assets-cfg.bondAssetLimit,0) + " above the current asset limit."),
        "Limit " + money(cfg.bondAssetLimit,0)),
      checkRow(resident, "Residency",
        resident
          ? "You marked the Australian permanent-residency/citizenship requirement as met."
          : "You have not marked the permanent-residency requirement as met.",
        "Required"),
      checkRow(!owns, "Residential property ownership",
        owns
          ? "You marked that you own or part-own a house, flat or unit, which conflicts with the standard eligibility rule."
          : "You have not entered any residential property ownership.",
        "Must not own"),
      checkRow(rentPass, "Rent share must be under " + Math.round(cfg.bondRentPct*100) + "%", rentDetail,
        prop && rentRatio != null ? pct(rentRatio) : "Property needed"),
      checkRow(bondPass, "Bond amount and bedroom cap",
        prop
          ? (bondAmount
              ? "The entered bond is " + money(bondAmount,0) + ". The published maximum for this bedroom size is " +
                money(cap,0) + ". " + (bondPass === true ? "The entered bond is within that cap." : bondPass === false ? "The entered bond is above that cap by " + money(bondAmount-cap,0) + "." : "Bedroom information is needed to complete this check.")
              : "Enter the bond amount to compare it with the published bedroom-based maximum.")
          : "Add a property to check the bond amount.",
        prop && prop.beds ? "Cap " + money(cap,0) : "Property needed")
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

  function applyImportedProperty() {
    let imported = null;
    try {
      imported = JSON.parse(sessionStorage.getItem("rentready-imported-property-v1") || "null");
    } catch {}
    if (!imported) return false;

    sessionStorage.removeItem("rentready-imported-property-v1");
    $("property-address").value = imported.address || "";
    $("property-rent").value = imported.rent || "";
    $("property-bond").value = imported.bond || "";
    $("property-beds").value = imported.beds || "";
    $("property-available").value = imported.available || "";
    $("listing-text").value = imported.url ? "Imported from property URL: " + imported.url : "";
    if (imported.rent) {
      $("target-rent").value = imported.rent;
      if (Number(imported.rent) >= 100 && Number(imported.rent) <= 1200) {
        $("target-rent-slider").value = imported.rent;
      }
    }
    setStep("property");
    recalcAll();
    return true;
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
    updateRentAssistVisibility();

    const prop = propertyForAssessment();
    const hasProperty = prop && Number(prop.rent || 0) > 0;
    const status = $("property-assessment-status");
    const active = rentAssistActive();

    if (!hasProperty) {
      status.className = "assessment-status pending";
      status.textContent = "Waiting for property";
      $("property-assessment-verdict").textContent = "Paste or enter a property";
      $("property-assessment-copy").textContent = "RentReady will compare the rent with your projected income as soon as the property details are available.";
      ["property-check-rent","property-check-income","property-check-ratio","property-check-ra","property-check-bond","property-check-cap"].forEach(id => $(id).textContent = "—");
      $("property-assessment-details").innerHTML = "<p>Paste a listing or enter rent, bond and bedrooms to see the assessment.</p>";
      return;
    }

    const rent = Number(prop.rent || 0);
    const bond = Number(prop.bond || 0);
    const sc = scenario(workIncomeFN, rent);
    const ratio = sc.householdWeek > 0 ? rent / sc.householdWeek : null;
    const generalLimit = sc.householdWeek * cfg.generalAffordabilityPct;
    const generalGap = rent - generalLimit;
    const bondLimit = sc.bondIncomeWeek * cfg.bondRentPct;
    const rentAssistGap = rent - bondLimit;
    const cap = bondCapForBeds(prop.beds);
    const bondGap = bond > 0 ? bond - cap : 0;

    $("property-check-rent").textContent = money(rent) + "/wk";
    $("property-check-income").textContent = sc.householdWeek > 0 ? money(sc.householdWeek) + "/wk" : "Add income";
    $("property-check-ratio").textContent = ratio == null ? "—" : pct(ratio);
    $("property-check-ra").textContent = rentAssistAvailable() ? money(sc.actualRAFN / 2) + "/wk" : "Not included";
    $("property-check-bond").textContent = bond ? money(bond) : "Not found";
    $("property-check-cap").textContent = prop.beds ? money(cap) : "Need bedrooms";

    let verdict = "", copy = "", state = "pending";
    if (sc.householdWeek <= 0) {
      verdict = "Add your income to assess this property";
      copy = "The listing has been read, but affordability needs the income profile from Step 1.";
    } else if (!active) {
      if (generalGap > 0) {
        verdict = "This property is above the current planning benchmark";
        copy = "The rent is about " + money(generalGap,0) + "/wk above RentReady's general affordability aim at the income entered.";
        state = "warn";
      } else {
        verdict = "This property is inside the current planning benchmark";
        copy = "The weekly rent is within RentReady's general affordability aim at the projected income.";
        state = "good";
      }
    } else if (rentAssistGap >= 0) {
      verdict = "The rent is above the RentAssist rent-share rule";
      copy = "Your rent share is about " + pct(sc.bondIncomeWeek > 0 ? rent/sc.bondIncomeWeek : 0) +
        " of the Housing Victoria income basis. It must be under " + Math.round(cfg.bondRentPct*100) +
        "%. The rent is about " + money(rentAssistGap,0) + "/wk above the current ceiling.";
      state = "bad";
    } else if (generalGap > 0) {
      verdict = "RentAssist rent-share rule may fit, but the property is financially tight";
      copy = "The rent is within the RentAssist rent-share rule but about " + money(generalGap,0) +
        "/wk above the general planning benchmark.";
      state = "warn";
    } else if (bondGap > 0) {
      verdict = "The weekly rent looks workable, but the bond needs attention";
      copy = "The rent sits inside both rent thresholds, but the entered bond is " + money(bondGap,0) +
        " above the published bedroom-based RentAssist cap.";
      state = "warn";
    } else {
      verdict = "This property looks within the current planning ranges";
      copy = "The weekly rent is inside both the general planning benchmark and the RentAssist rent-share rule used by Housing Victoria.";
      state = "good";
    }

    status.className = "assessment-status " + state;
    status.textContent = state === "good" ? "Within range" : state === "warn" ? "Tight" : state === "bad" ? "Above range" : "Needs income";
    $("property-assessment-verdict").textContent = verdict;
    $("property-assessment-copy").textContent = copy;

    const bullets = [];
    if (ratio != null) bullets.push("Rent is " + pct(ratio) + " of projected weekly household income.");
    bullets.push(generalGap <= 0
      ? "General planning benchmark: " + money(-generalGap,0) + "/wk of headroom."
      : "General planning benchmark: " + money(generalGap,0) + "/wk short.");

    if (active) {
      bullets.push(rentAssistGap < 0
        ? "RentAssist rent-share rule: " + money(-rentAssistGap,0) + "/wk of headroom before reaching the under-" + Math.round(cfg.bondRentPct*100) + "% ceiling."
        : "RentAssist rent-share rule: " + money(rentAssistGap,0) + "/wk above the current ceiling.");
      if (bond && prop.beds) bullets.push(bondGap <= 0
        ? "Bond is within the published bedroom-based maximum."
        : "Bond is " + money(bondGap,0) + " above the published bedroom-based maximum.");
    }

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
    const cells = [
      summaryCell("Selected property", prop.address),
      summaryCell("Weekly rent", money(prop.rent,0)),
      summaryCell("Estimated Rent Assistance", rentAssistAvailable() ? money(sc.actualRAFN/2) + "/wk" : "Not included"),
      summaryCell("Bond", money(prop.bond,0))
    ];
    if (rentAssistActive()) {
      cells.push(summaryCell("RentAssist bedroom cap", money(bondCapForBeds(prop.beds),0)));
    }
    box.innerHTML = '<div class="property-summary-grid">' + cells.join("") + '</div>';
  }

  function summaryCell(label, value) {
    return '<div><span>' + esc(label) + '</span><strong>' + esc(String(value)) + '</strong></div>';
  }

  function renderAffordability(sc = null, prop = null) {
    prop = prop || activeProperty();
    sc = sc || scenario(workIncomeFN, prop ? prop.rent : 0);
    const active = rentAssistActive();
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
    $("metric-property-rent").textContent = prop ? money(rent) : "—";
    $("metric-bond-rent").textContent = money(bondLimit);
    $("metric-bond-cap").textContent = prop ? money(cap) : "—";
    $("metric-bond-shortfall").textContent = prop ? money(bondAmountGap) : "—";

    if (!prop) {
      setScore("general", null, 0, "Add a property to compare rent with your projected weekly income.", "");
      if (active) setScore("bond", null, 0, "Add a property to run the RentAssist rent-share test.", "");
      $("shortfall-explainer").innerHTML = "<p>Add a property first.</p>";
      return;
    }

    setScore("general", generalGap <= 0, ratio,
      "Selected rent is " + pct(ratio) + " of projected weekly household income. The planning benchmark is " + Math.round(cfg.generalAffordabilityPct*100) + "%.",
      generalGap <= 0 ? money(-generalGap) + "/wk of headroom to the benchmark." : money(generalGap) + "/wk above the benchmark.");

    if (active) {
      setScore("bond", bondGap < 0, bondRatio,
        "Your rent share is " + pct(bondRatio) + " of the Housing Victoria income basis. RentAssist requires it to be under " + Math.round(cfg.bondRentPct*100) + "%.",
        bondGap < 0 ? money(-bondGap) + "/wk of headroom to the RentAssist ceiling." : money(bondGap) + "/wk above the RentAssist ceiling.");
    }

    const items = [];
    if (generalGap > 0) items.push("For the general affordability benchmark, the rent would need to fall by about " + money(generalGap) + " per week at the current income.");
    else items.push("The selected rent is within the general planning benchmark at the current projected income.");

    if (active) {
      if (bondGap >= 0) items.push("RentAssist: the rent is about " + money(bondGap) + "/wk above the under-" + Math.round(cfg.bondRentPct*100) + "% rent-share ceiling.");
      else items.push("RentAssist: the selected rent is within the under-" + Math.round(cfg.bondRentPct*100) + "% rent-share rule.");

      if (bondAmountGap > 0) items.push("RentAssist: the entered bond is " + money(bondAmountGap) + " above the published bedroom-based maximum loan amount.");
      else if (prop.bond) items.push("RentAssist: the entered bond does not exceed the published bedroom-based maximum loan amount.");

      const incomeLimit = householdIncomeLimit();
      if (sc.bondIncomeWeek > incomeLimit) items.push("RentAssist: estimated weekly household income is " + money(sc.bondIncomeWeek - incomeLimit) + " above the current limit for this household type.");
      if (Number($("assets").value || 0) > cfg.bondAssetLimit) items.push("RentAssist: entered assets are above the current asset limit by " + money(Number($("assets").value || 0) - cfg.bondAssetLimit) + ".");
    }

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
      shortfalls.push({state:"warn",text: rentAssistActive()
        ? "No property is selected yet, so RentReady cannot assess property-specific affordability or RentAssist shortfalls."
        : "No property is selected yet, so RentReady cannot assess property-specific affordability."});
    } else {
      if (generalGap > 0) {
        shortfalls.push({state:"warn",text:"The selected rent is about " + money(generalGap) + "/wk above the general " + Math.round(cfg.generalAffordabilityPct*100) + "% planning benchmark."});
      } else {
        shortfalls.push({state:"ok",text:"The selected rent is within the general planning benchmark at the projected income."});
      }

      if (rentAssistActive()) {
        if (bondGap >= 0) {
          shortfalls.push({state:"warn",text:"RentAssist: the selected rent is about " + money(bondGap) + "/wk above the current under-" + Math.round(cfg.bondRentPct*100) + "% rent-share ceiling."});
        } else {
          shortfalls.push({state:"ok",text:"RentAssist: the selected rent is within the under-" + Math.round(cfg.bondRentPct*100) + "% rent-share rule."});
        }

        if (rentAssistActive() && bondAmountGap > 0) {
          shortfalls.push({state:"warn",text:"RentAssist: the entered bond is " + money(bondAmountGap) + " above the published bedroom-based loan cap."});
        }
      }
    }

    if (rentAssistActive()) {
      const incomeLimit = householdIncomeLimit();
      if (sc.bondIncomeWeek > incomeLimit) {
        shortfalls.push({state:"warn",text:"RentAssist: estimated weekly household income is " + money(sc.bondIncomeWeek - incomeLimit) + " above the current income limit for the selected household type."});
      }
      if (Number($("assets").value || 0) > cfg.bondAssetLimit) {
        shortfalls.push({state:"warn",text:"RentAssist: entered assets are above the current asset limit."});
      }
      if (!$("permanent-resident").checked) {
        shortfalls.push({state:"warn",text:"RentAssist: the permanent-residency requirement is not marked as met."});
      }
      if ($("owns-property").checked) {
        shortfalls.push({state:"warn",text:"RentAssist: residential property ownership is marked, which conflicts with the standard eligibility rule."});
      }
    }
    $("app-shortfalls").innerHTML = reviewList(shortfalls.length ? shortfalls : [{state:"ok",text:"No immediate application shortfall is identified from the information entered so far."}]);

    const strategies = [];
    if (!prop) {
      strategies.push({state:"warn",text:"Add the property first so the review can calculate rent share, bond amount and the relevant target range."});
    } else {
      const target = rentAssistActive()
        ? Math.min(generalLimit || Infinity, bondLimit || Infinity)
        : generalLimit;
      if ((generalGap > 0 || (rentAssistActive() && bondGap >= 0)) && Number.isFinite(target)) {
        strategies.push({state:"ok",text:"A target rent around " + money(Math.max(0,target),0) + "/wk or below improves the position against the tighter current rent threshold."});
      }
      if (generalGap > 0 || (rentAssistActive() && bondGap >= 0)) {
        strategies.push({state:"ok",text:"Use the optimisation sliders to test whether additional work income improves the rent position after any payment reduction is taken into account."});
      }
      if (bondAmountGap > 0) {
        strategies.push({state:"ok",text:"Compare properties with a lower bond or check the final eligible RentAssist Bond Loan amount before relying on the loan to cover the full bond."});
      }
      if (properties.length > 1 && (generalGap > 0 || (rentAssistActive() && (bondGap >= 0 || bondAmountGap > 0)))) {
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
    updateRentAssistVisibility();

    const sc = scenario(work, rent);
    const generalLimit = sc.householdWeek * cfg.generalAffordabilityPct;
    const generalGap = rent - generalLimit;
    const generalPass = generalGap <= 0;

    $("optimise-work-label").textContent = money(displayFromFN(work),0) + " / " + PERIODS[currentPeriod].label;
    $("optimise-rent-label").textContent = money(rent,0) + " / week";
    $("optimise-income").textContent = money(sc.householdWeek) + "/wk";
    $("optimise-general-gap").textContent = gapText(generalGap);
    $("target-general-rent").textContent = money(generalLimit,0) + "/wk";
    $("target-general-income").textContent = requiredWorkText(rent, cfg.generalAffordabilityPct, "general");

    if (!rentAssistActive()) {
      $("optimise-verdict").textContent = generalPass
        ? "This combination is inside the general planning benchmark"
        : "The rent is still above the general planning benchmark";
      $("optimise-copy").textContent = generalPass
        ? "At this work income and rent, the general affordability planning benchmark is within range."
        : "Move rent down or work income up to see where the general planning benchmark crosses into range.";
      return;
    }

    const bondLimit = sc.bondIncomeWeek * cfg.bondRentPct;
    const bondGap = rent - bondLimit;
    const bondPass = bondGap < 0;

    $("optimise-bond-gap").textContent = gapText(bondGap);
    $("target-bond-rent").textContent = money(bondLimit,0) + "/wk";
    $("target-bond-income").textContent = requiredWorkText(rent, cfg.bondRentPct, "bond");

    if (generalPass && bondPass) {
      $("optimise-verdict").textContent = "This combination is inside both active thresholds";
      $("optimise-copy").textContent = "At this work income and target rent, both the general planning benchmark and the RentAssist rent-share rule are within range.";
    } else if (bondPass) {
      $("optimise-verdict").textContent = "RentAssist rent-share rule fits; general affordability is tighter";
      $("optimise-copy").textContent = "The rent is inside the RentAssist rent-share rule, but above the general planning benchmark.";
    } else {
      $("optimise-verdict").textContent = "The RentAssist rent-share rule is still a constraint";
      $("optimise-copy").textContent = "Move rent down or work income up to see where the under-" + Math.round(cfg.bondRentPct*100) + "% RentAssist rule crosses into range.";
    }
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
      const rentAssistPass = !rentAssistActive() || rent < sc.bondIncomeWeek * cfg.bondRentPct;
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
      $("ideal-work-target-copy").textContent = rentAssistActive()
        ? "Increasing work income alone does not bring this property inside both active thresholds within the modelled range. A lower rent may be the more effective lever."
        : "Increasing work income alone does not bring this property inside the general planning benchmark within the modelled range. A lower rent may be the more effective lever.";
      return;
    }

    const extra = Math.max(0, target - current);
    $("ideal-work-target").textContent = money(displayFromFN(target),0) + " / " + PERIODS[currentPeriod].label;
    $("target-extra-work").textContent = extra > 0
      ? money(displayFromFN(extra),0) + " / " + PERIODS[currentPeriod].label
      : "$0 — current work income is already at or above the modelled target";

    if (extra > 0) {
      $("ideal-work-target-copy").textContent =
        "For the current rent of " + money(rent,0) + " per week, the model first reaches " +
        (rentAssistActive() ? "both active thresholds" : "the general planning benchmark") + " at about " +
        money(displayFromFN(target),0) + " of gross work income per " + PERIODS[currentPeriod].label +
        ". That is about " + money(displayFromFN(extra),0) + " more than the work income currently entered.";
    } else {
      $("ideal-work-target-copy").textContent =
        "Your current work income is already at or above the minimum modelled level needed for this property to sit inside " +
        (rentAssistActive() ? "both active thresholds." : "the general planning benchmark.");
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
    $("work-income").addEventListener("input", () => {
      workIncomeFN = fnFromDisplay($("work-income").value);
      impactTestWorkFN = workIncomeFN;
      recalcAll();
    });
    $("other-income-week").addEventListener("input", () => { otherIncomeWeek = weekFromDisplay($("other-income-week").value); recalcAll(); });
    $("working-credit").addEventListener("input", recalcAll);
    $("working-credit-help").addEventListener("click", () => {
      if (!workingCreditApplicable()) return;
      $("credit-modal").hidden = false;
    });
    document.querySelectorAll("[data-close-credit-modal]").forEach(el =>
      el.addEventListener("click", () => { $("credit-modal").hidden = true; })
    );
    $("credit-ever-income").addEventListener("change", () => {
      $("credit-income-history-fields").hidden = $("credit-ever-income").value !== "yes";
    });
    $("estimate-working-credit").addEventListener("click", estimateWorkingCreditBalance);
    $("use-credit-estimate").addEventListener("click", () => {
      if (workingCreditEstimateFN == null) return;
      $("working-credit").value = String(Math.round(workingCreditEstimateFN * 100) / 100);
      $("credit-modal").hidden = true;
      recalcAll();
    });

    ["work-status-yes","work-status-no"].forEach(id =>
      $(id).addEventListener("change", recalcAll)
    );
    $("no-work-reason").addEventListener("change", renderNoWorkReason);
    $("no-work-info-button").addEventListener("click", openNoWorkInfo);
    document.querySelectorAll("[data-close-reason-modal]").forEach(el =>
      el.addEventListener("click", closeNoWorkInfo)
    );

    $("scenario-prompts").addEventListener("click", e => {
      const item = e.target.closest("[data-scenario-code]");
      if (item) openScenarioModal(item.dataset.scenarioCode);
    });
    document.querySelectorAll("[data-close-scenario-modal]").forEach(el =>
      el.addEventListener("click", closeScenarioModal)
    );
    $("scenario-not-applicable").addEventListener("click", () => {
      if (!activeScenarioCode) return;
      const code = activeScenarioCode;
      closeScenarioModal();
      dismissScenario(code);
    });

    ["rental-arrangement-own","rental-arrangement-share"].forEach(id =>
      $(id).addEventListener("change", () => { updateRentalArrangementUI(); recalcAll(); })
    );
    $("rental-arrangement-help").addEventListener("click", () => {
      $("rental-arrangement-modal").hidden = false;
    });
    document.querySelectorAll("[data-close-rental-arrangement]").forEach(el =>
      el.addEventListener("click", () => { $("rental-arrangement-modal").hidden = true; })
    );

    $("income-free-warning-detail").addEventListener("click", () => {
      $("income-impact-chart").scrollIntoView({behavior:"smooth",block:"center"});
    });

    $("open-income-impact").addEventListener("click", openIncomeImpactDetail);
    $("impact-income-slider").addEventListener("input", () => {
      workIncomeFN = fnFromDisplay($("impact-income-slider").value);
      impactTestWorkFN = workIncomeFN;
      $("work-income").value = displayFromFN(workIncomeFN).toFixed(2);
      recalcAll();
    });
    $("target-rent").addEventListener("input", () => {
      const rent = Math.max(0, Number($("target-rent").value || 0));
      if (rent >= 100 && rent <= 1200) $("target-rent-slider").value = String(rent);
      renderTargetRentPlanner();
    });
    $("target-rent-slider").addEventListener("input", () => {
      $("target-rent").value = $("target-rent-slider").value;
      renderTargetRentPlanner();
    });
    $("future-ra").addEventListener("change", () => {
      if (!$("future-ra").checked) rentAssistExplored = false;
      updateRentAssistVisibility();
      recalcAll();
    });
    $("rentassist-explore-button").addEventListener("click", () => {
      if (!$("future-ra").checked) return;
      rentAssistExplored = true;
      updateRentAssistVisibility();
      recalcAll();
    });
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
  const importedPropertyApplied = applyImportedProperty();
  if (!importedPropertyApplied && new URLSearchParams(location.search).get("step") === "property") {
    setStep("property");
  }
  loadPaymentData();
  recalcAll();
})();