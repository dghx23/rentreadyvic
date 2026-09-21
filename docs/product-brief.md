# RentReady VIC — Product Brief

## Objective

Help people on income support understand how working and earning more interacts with their payments, while also helping them navigate Victorian rental applications, rental rules and eligibility for related support such as the RentAssist bond loan.

The experience should feel like one connected journey. Information entered once should flow through every relevant tool.

## Entry experience

The first screen should explain what RentReady does in plain language and then provide clear links into the tools.

A primary starting action is **Add a rental listing**:

- Paste the full rental advertisement, or enter details manually.
- Extract and pre-populate address, weekly rent, bond, availability and other useful listing information.
- Show a plain-language property summary highlighting the important details.
- Allow additional properties to be added.
- Maintain a shortlist that the user can move between.
- Reuse the selected property's figures throughout affordability, RentAssist and application workflows.

## Income support profile

When a user selects **I am on income support**:

- Allow selection of payment type, including JobSeeker, Disability Support Pension and Rent Assistance where relevant.
- Pre-populate the variables that apply to that payment.
- Source live/current social-security values from the RiskAtlas / Social Security Compass backend rather than relying on static figures.
- Reuse the selected payment and household variables throughout the site.

## Period controls

For financial figures and payments provide a period control for:

- Weekly
- Fortnightly
- Monthly
- Yearly

Yearly should remain available but visually less prominent.

Changing period should update displayed figures consistently across the connected tools.

## Work and income

Help a user understand:

- current income-support payment;
- earnings from work;
- payment reductions/tapers;
- total disposable/gross income as earnings change;
- relevant thresholds;
- the effect of working additional hours or earning more.

The goal is explanation, not just a calculator result.

## Rental affordability

Use the user's saved income-support profile, work income and selected property to show affordability measures without making the user re-enter figures.

## RentAssist bond loan

Provide a dedicated eligibility tool that:

- reuses saved household, income, asset and property/rent information;
- explains each eligibility test;
- identifies which test is or is not met;
- links to the authoritative Victorian source and application pathway.

## Form 3A

Provide a guided Victorian rental-application workflow based on the prescribed form.

- Explain every field.
- Explain what is required and what is optional.
- Where relevant, explain discrimination/privacy considerations and link to the underlying rules.
- Reuse applicant, income and property details already entered elsewhere.

## References

References require their own click-through page/workflow, not merely a small form.

The page should:

1. Explain what a reference means in the Victorian rental-application context.
2. Explain what can satisfy the reference requirement.
3. Point to the prescribed form, law and authoritative guidance.
4. Let the applicant enter referee details.
5. Let the applicant send a reference request directly from RentReady.
6. Send the referee a short structured set of questions that can be answered directly in email.
7. Accept the returned email through the application backend.
8. Parse and store the answers in structured fields.
9. Present the captured answers back to the applicant.
10. Generate a printable PDF/reference record with an appropriate electronic-signature/attestation mechanism.

## Accounts and persistence

Provide:

- basic applicant sign-up/sign-in so work can be saved;
- guest/local mode where appropriate;
- an admin login;
- an admin console for administering rates, content, records and system configuration.

## Legal and rules content

The site should contain plain-language explanations of:

- Victorian rental application rules;
- relevant Residential Tenancies Act / prescribed-form requirements;
- discrimination/protected-attribute considerations;
- income-support rules;
- RentAssist requirements;
- source links and effective dates.

Rules pages should connect directly back to the tools they explain.

## Data architecture principle

A user should not have to type the same information repeatedly.

Core shared objects should include:

- user/applicant profile;
- household;
- income-support profile;
- employment/work income;
- property shortlist;
- selected property;
- Form 3A application data;
- referees/reference records.

## RiskAtlas integration

RiskAtlas is the intended source for live social-security reference data. Relevant implementation areas currently visible in `dghx23/riskatlas` include:

- `core_social.py`
- `core_social_seed.py`
- `templates/atlascore/social_security.html`
- `templates/compass.html`
- `templates/compass_programme.html`
- `templates/partials/compass_period.html`
- `static/js/compass-period.js`
- `static/js/compass-rent.js`
- `tests/test_compass.py`

The RentReady frontend should consume a stable backend/API contract rather than duplicate rates in frontend code.

## Design constraint

Preserve the established RentReady VIC layout and visual system. New functionality should be integrated into the existing UI rather than replacing it with a new visual redesign.
