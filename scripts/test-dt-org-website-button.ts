import assert from "node:assert/strict";

import {
  normalizeWebsiteHref,
  websiteHostnameLabel,
} from "../components/dt/dt-org-website-button";

function testNormalizeWebsiteHref() {
  assert.equal(
    normalizeWebsiteHref("https://www.intensivpflege-ayags.de/"),
    "https://www.intensivpflege-ayags.de/",
  );
  assert.equal(
    normalizeWebsiteHref("intensivpflege-ayags.de"),
    "https://intensivpflege-ayags.de/",
  );
  assert.equal(normalizeWebsiteHref("  "), null);
  assert.equal(normalizeWebsiteHref("javascript:alert(1)"), null);
  console.log("normalizeWebsiteHref: ok");
}

function testHostnameLabel() {
  assert.equal(
    websiteHostnameLabel("https://www.intensivpflege-ayags.de/pflegen"),
    "intensivpflege-ayags.de",
  );
  assert.equal(websiteHostnameLabel("not a url :::"), "Website");
  console.log("websiteHostnameLabel: ok");
}

testNormalizeWebsiteHref();
testHostnameLabel();
console.log("all org website button tests passed");
