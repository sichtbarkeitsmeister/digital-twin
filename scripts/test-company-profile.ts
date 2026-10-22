/**
 * Firmenprofil diffs: only changed fields are logged for staff.
 * Run: npx tsx scripts/test-company-profile.ts
 */
import assert from "node:assert/strict";

import {
  buildCompanyProfileChanges,
  normalizeProfileContacts,
  serializeContacts,
} from "../lib/dt/company-profile";
import { ANBIETER_POINTS, normalizeAnbieterItems } from "../lib/dt/transcripts/workshop-model";

function testDiffs() {
  const emptyPoints = normalizeAnbieterItems([]);
  const withUsp = emptyPoints.map((item) =>
    item.key === "alleinstellung" ? { ...item, current: "Schnelle Termine" } : item,
  );
  const withUspAndZiele = withUsp.map((item) =>
    item.key === "ziele" ? { ...item, current: "Mehr Empfehlungen" } : item,
  );

  const none = buildCompanyProfileChanges({
    before: {
      displayName: "Acme",
      websiteUrl: "https://acme.test",
      contacts: normalizeProfileContacts([{ name: "Ada", role: "GF", email: "a@acme.test", phone: "" }]),
      points: withUsp,
    },
    after: {
      displayName: "Acme",
      websiteUrl: "https://acme.test",
      contacts: normalizeProfileContacts([{ name: "Ada", role: "GF", email: "a@acme.test", phone: "" }]),
      points: withUsp,
    },
  });
  assert.equal(none.length, 0);

  const changed = buildCompanyProfileChanges({
    before: {
      displayName: "Acme",
      websiteUrl: "",
      contacts: normalizeProfileContacts([]),
      points: emptyPoints,
    },
    after: {
      displayName: "Acme GmbH",
      websiteUrl: "https://acme.test",
      contacts: normalizeProfileContacts([
        { name: "Ada", role: "GF", email: "a@acme.test", phone: "0211" },
      ]),
      points: withUspAndZiele,
    },
  });

  assert.deepEqual(
    changed.map((c) => c.key).sort(),
    ["anbieter.alleinstellung", "anbieter.ziele", "contacts", "display_name", "website_url"].sort(),
  );
  assert.equal(changed.find((c) => c.key === "display_name")?.after, "Acme GmbH");
  assert.equal(changed.find((c) => c.key === "anbieter.alleinstellung")?.after, "Schnelle Termine");
  assert.match(serializeContacts(normalizeProfileContacts([{ name: "Ada", role: "GF", email: "", phone: "" }])), /Ada/);
  assert.equal(ANBIETER_POINTS.length, 13);
  console.log("company-profile diffs: ok");
}

testDiffs();
