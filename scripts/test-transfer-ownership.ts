import assert from "node:assert/strict";

import {
  describeOwnerChange,
  describeOwnerRemoval,
  isMissingOwnerRpc,
} from "../lib/dashboard/change-organisation-owner";
import { mapTransferOwnershipError } from "../lib/dashboard/transfer-ownership-error";

assert.equal(
  mapTransferOwnershipError({ message: "forbidden" }),
  "Keine Berechtigung: nur der Inhaber oder ein Plattform-Admin kann den Inhaber ändern.",
);
assert.equal(
  mapTransferOwnershipError({ message: "not_authenticated" }),
  "Keine Berechtigung: nur der Inhaber oder ein Plattform-Admin kann den Inhaber ändern.",
);
assert.equal(
  mapTransferOwnershipError({ message: "org_not_found" }),
  "Organisation wurde nicht gefunden.",
);
assert.equal(
  mapTransferOwnershipError({ message: "something else" }),
  "Der Inhaber konnte nicht geändert werden.",
);

assert.equal(isMissingOwnerRpc("Could not find the function public.transfer_organisation_ownership"), true);
assert.equal(isMissingOwnerRpc("function clear_organisation_owner(uuid) does not exist"), true);
assert.equal(isMissingOwnerRpc("forbidden"), false);

assert.equal(
  describeOwnerChange({
    email: "neu@firma.de",
    createdAccount: false,
    removedPrevious: true,
  }),
  "Inhaber ist jetzt neu@firma.de. Die bisherige Adresse hat keinen Zugang mehr zu dieser Organisation.",
);
assert.match(
  describeOwnerRemoval(["info.fischer-vvs@continentale.de"]),
  /info\.fischer-vvs@continentale\.de/,
);
assert.match(describeOwnerRemoval([]), /keinen Inhaber/);

console.log("transfer ownership error mapping: ok");
