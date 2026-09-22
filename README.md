# RentReady VIC

RentReady VIC is a Victoria-focused renter toolkit for people navigating income support, work, rental applications and related eligibility rules.

## Product direction

The project is designed as one connected workflow rather than a set of disconnected calculators:

1. Start with an explainer and add a rental listing.
2. Extract and save the property details into a shortlist.
3. Capture the user's income-support profile once.
4. Reuse those details across work/income calculations, rent affordability and RentAssist bond-loan eligibility.
5. Guide the user through Victorian Form 3A.
6. Provide a dedicated references workflow, including explanation, request, response capture and printable/PDF output.
7. Provide plain-language legal/rules information with source links.
8. Support saved user work plus an admin area.

## Current user journey

RentReady now has a five-step financial/property workflow plus a separate linked application review:

1. **Income** — assume the renter receives an income-support payment, select the payment/circumstance, show the current Centrelink rate in its own box, add work and household income, and optionally include future Rent Assistance.
2. **Property** — paste or enter the rental listing, extract rent/bond/bedrooms, and save properties to a shortlist.
3. **RentAssist** — assess the selected property against Housing Victoria RentAssist Bond Loan settings, including income, assets, residency, property ownership, rent share and bond amount.
4. **Affordability** — compare the property against a general planning benchmark and the RentAssist rent-share test, with explicit dollar shortfalls.
5. **Optimise** — adjust work income and target rent with sliders and recalculate payment, Rent Assistance and affordability together.

**Application & Rights Review** is deliberately separate from the numbered financial workflow. It reuses the payment, income, household and selected-property information already entered to suggest permitted evidence, identify application shortfalls, surface contextual protected-characteristic cautions, check user-reported application red flags, and recommend practical optimisation strategies.

Public pages deliberately do not expose the internal payment-data system. The public application calls the RentReady endpoint at `/api/social-security`; upstream connector configuration is admin/backend-only.

## Source of truth

- `index.html` — explainer homepage describing the connected RentReady journey and each calculator/tool.
- `app.html` — current integrated prototype/workspace, preserving the established RentReady visual layout.
- `archive/` — earlier prototype variants retained for reference.
- `docs/original-structure.txt` — earlier proposed file structure.

## Data integration

The intended social-security data source is the separate `dghx23/riskatlas` repository / Social Security Compass backend. The current prototype may still contain placeholder or locally defined rates until that integration is completed.

## Status

Prototype / active development. Figures and eligibility logic should be verified against authoritative sources before production use.
