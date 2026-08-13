import assert from "node:assert/strict";

import {
  resolveOrganisationSlug,
  slugifyOrganisationName,
} from "../lib/dt/org-slug";

assert.equal(slugifyOrganisationName("MSH Rechtsanwälte GmbH"), "msh-rechtsanwaelte");
assert.equal(slugifyOrganisationName("Acme GmbH"), "acme");

// Free-form slug fields (users often paste the company name) must be normalized.
assert.equal(
  resolveOrganisationSlug({ slug: "MSH Rechtsanwälte", name: "Ignored" }),
  "msh-rechtsanwaelte",
);
assert.equal(
  resolveOrganisationSlug({ slug: "Custom-Client", name: "Ignored" }),
  "custom-client",
);
assert.equal(
  resolveOrganisationSlug({ slug: "", name: "MSH Rechtsanwälte" }),
  "msh-rechtsanwaelte",
);
assert.equal(resolveOrganisationSlug({ slug: null, name: "???" }), null);

console.log("org-slug: all ok");
