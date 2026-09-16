import assert from "node:assert/strict";

import { mapTransferOwnershipError } from "../lib/dashboard/transfer-ownership-error";

assert.equal(
  mapTransferOwnershipError({ message: "forbidden" }),
  "Keine Berechtigung: nur Inhaber oder Plattform-Admin können Ownership übertragen.",
);
assert.equal(
  mapTransferOwnershipError({ message: "not_authenticated" }),
  "Keine Berechtigung: nur Inhaber oder Plattform-Admin können Ownership übertragen.",
);
assert.equal(
  mapTransferOwnershipError({ message: "something else" }),
  "Ownership konnte nicht übertragen werden.",
);

console.log("transfer ownership error mapping: ok");
