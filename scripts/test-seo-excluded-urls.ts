import assert from "node:assert/strict";

import { isDtExcludedPageUrl } from "../lib/dt/seo/build-seo-context";

assert.equal(
  isDtExcludedPageUrl("https://www.kfz-gutachter-steffen.de/datenschutz"),
  false,
);
assert.equal(
  isDtExcludedPageUrl("https://www.kfz-gutachter-steffen.de/impressum"),
  false,
);
assert.equal(
  isDtExcludedPageUrl("https://www.example.com/privacy"),
  false,
);
assert.equal(isDtExcludedPageUrl("https://www.example.com/agb"), true);
assert.equal(isDtExcludedPageUrl("https://www.example.com/widerruf/"), true);
assert.equal(isDtExcludedPageUrl("https://www.example.com/leistungen"), false);

console.log("seo excluded-url tests: ok");
