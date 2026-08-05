/**
 * Organisation slug helpers.
 * Run: npx tsx scripts/test-org-slug.ts
 */
import assert from "node:assert/strict";

import {
  resolveOrganisationSlug,
  slugifyOrganisationName,
} from "../lib/dt/org-slug";

assert.equal(slugifyOrganisationName("MSH Rechtsanwälte"), "msh-rechtsanwaelte");
assert.equal(slugifyOrganisationName("Acme GmbH"), "acme");
assert.equal(slugifyOrganisationName("Gebr. Roggendorf"), "roggendorf");
assert.equal(slugifyOrganisationName("  Tischlerei Schöpker  "), "tischlerei-schoepker");

assert.equal(
  resolveOrganisationSlug({ slug: "", name: "MSH Rechtsanwälte" }),
  "msh-rechtsanwaelte",
);
assert.equal(
  resolveOrganisationSlug({ slug: "custom-client", name: "Ignored" }),
  "custom-client",
);
assert.equal(resolveOrganisationSlug({ slug: null, name: "???" }), null);

console.log("org-slug tests: ok");
