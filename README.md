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

RentReady now follows an income-first sequence:

1. **Income** — assume the renter receives an income-support payment, select the payment/circumstance, add work and household income, and optionally include future Rent Assistance.
2. **RentAssist bond rules** — test the pre-property income, asset, residency and property-ownership requirements.
3. **Property** — paste or enter the rental listing, extract rent/bond/bedrooms, and save it to a shortlist.
4. **Application rules** — explain the prescribed Victorian rental application, what may be requested, what cannot be requested, and unlawful discrimination.
5. **Affordability** — compare the selected property against a general planning benchmark and the RentAssist bond-loan rent-share rule, with explicit shortfall explanations.
6. **Optimise** — adjust work income and target rent with sliders to find a workable range.

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
