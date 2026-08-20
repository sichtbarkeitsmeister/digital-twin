import assert from "node:assert/strict";

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

console.log("sbkm-staff-email: all ok");
