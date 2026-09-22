const path = require("path");
const express = require("express");
const socialSecurity = require("./api/social-security.js");
const propertyExtract = require("./api/property-extract.js");
const addressSearch = require("./api/address-search.js");
const addressAutocomplete = require("./api/address-autocomplete.js");
const rentalMarket = require("./api/rental-market.js");

const app = express();
const port = Number(process.env.PORT || 10000);
const root = __dirname;

app.disable("x-powered-by");

app.get("/_health", (_req, res) => {
  res.status(200).json({ ok: true, service: "rentready-vic" });
});

app.use(express.json({ limit:"32kb" }));
app.get("/api/social-security", socialSecurity);
app.get("/api/rental-market", rentalMarket);
app.post("/api/property-extract", propertyExtract);
app.get("/api/address-search", addressSearch);
app.get("/api/address-autocomplete", addressAutocomplete);

app.use(express.static(root, {
  extensions: ["html"],
  setHeaders(res, filePath) {
    if (/\.(html|js|css)$/.test(filePath)) {
      res.setHeader("Cache-Control", "public, max-age=300");
    }
  }
}));

app.get("/", (_req, res) => res.sendFile(path.join(root, "index.html")));

app.use((_req, res) => {
  res.status(404).sendFile(path.join(root, "index.html"));
});

app.listen(port, "0.0.0.0", () => {
  console.log(`RentReady VIC listening on port ${port}`);
});
