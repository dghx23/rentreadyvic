# RiskAtlas / Social Security Compass integration notes

RentReady VIC should use the existing RiskAtlas social-security data layer as the upstream source for payment rates, thresholds and related rule variables.

Relevant paths currently identified in `dghx23/riskatlas`:

- `core_social.py`
- `core_social_seed.py`
- `static/js/compass-period.js`
- `static/js/compass-rent.js`
- `templates/atlascore/social_security.html`
- `templates/compass.html`
- `templates/compass_programme.html`
- `templates/partials/compass_period.html`
- `tests/test_compass.py`

## Intended RentReady contract

The RentReady app should be able to request, at minimum:

- payment/program identifier and display name;
- current base/max rates;
- effective date;
- household/relationship categories;
- income-free areas and taper rates;
- relevant cut-offs;
- Rent Assistance rates, thresholds and household variables;
- other variables needed to reproduce the user's entitlement calculation;
- source/provenance URL or source identifier;
- date last verified/updated.

The frontend should not treat copied static rates as authoritative once this integration is connected.

## Next implementation step

Define a small versioned JSON endpoint in RiskAtlas (or document the existing one if already present), then replace RentReady's local placeholder constants with calls to that endpoint plus a cached fallback.
