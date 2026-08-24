import assert from "node:assert/strict";

import { isAlreadyRegisteredAuthError, isForeignKeyRestrictError } from "../lib/dashboard/auth-user-errors";
import { sortPlatformTeamMembers } from "../lib/dashboard/platform-admin-team";
import { isSbkmStaffEmail } from "../lib/dt/sbkm-staff";

assert.equal(isSbkmStaffEmail("vanessa.may@sichtbarkeitsmeister.de"), true);
assert.equal(isSbkmStaffEmail("  Mail@Sichtbarkeitsmeister.DE  "), true);
assert.equal(isSbkmStaffEmail("ads@sichtbarkeitsmeister.de"), true);
assert.equal(isSbkmStaffEmail("kunde@praxis.de"), false);
assert.equal(isSbkmStaffEmail("evil@notsichtbarkeitsmeister.de"), false);
assert.equal(isSbkmStaffEmail("vanessa@sichtbarkeitsmeister.de.evil.com"), false);
assert.equal(isSbkmStaffEmail("sichtbarkeitsmeister.de"), false);
assert.equal(isSbkmStaffEmail("@sichtbarkeitsmeister.de"), false);
assert.equal(isSbkmStaffEmail(""), false);
assert.equal(isSbkmStaffEmail(null), false);

assert.deepEqual(
  sortPlatformTeamMembers([
    { id: "1", email: "vanessa.may@sichtbarkeitsmeister.de", role: "admin" },
    { id: "3", email: "mail@sichtbarkeitsmeister.de", role: "admin" },
    { id: "2", email: "al@sichtbarkeitsmeister.de", role: "admin" },
  ]).map((m) => m.email),
  [
    "al@sichtbarkeitsmeister.de",
    "mail@sichtbarkeitsmeister.de",
    "vanessa.may@sichtbarkeitsmeister.de",
  ],
);

assert.equal(isAlreadyRegisteredAuthError("User already registered"), true);
assert.equal(
  isAlreadyRegisteredAuthError("A user with this email address has already been registered"),
  true,
);
assert.equal(isAlreadyRegisteredAuthError("invalid redirect"), false);
assert.equal(isForeignKeyRestrictError("violates foreign key constraint"), true);
assert.equal(isForeignKeyRestrictError("User already registered"), false);

console.log("sbkm-staff-email: all ok");
