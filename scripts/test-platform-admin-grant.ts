import assert from "node:assert/strict";

import {
  ALREADY_PLATFORM_ADMIN,
  GRANT_PLATFORM_ADMIN_SUCCESS,
  escapeIlikeExact,
  mapSetPlatformAdminError,
} from "../lib/dt/platform-admin-grant";

assert.match(GRANT_PLATFORM_ADMIN_SUCCESS, /Fragebögen/);
assert.match(ALREADY_PLATFORM_ADMIN, /bereits Plattform-Admin/);
assert.equal(escapeIlikeExact("a_b%c"), "a\\_b\\%c");

assert.equal(mapSetPlatformAdminError("not_authenticated"), "Nicht angemeldet.");
assert.equal(
  mapSetPlatformAdminError("forbidden"),
  "Nur Plattform-Admins dürfen den Verwaltungszugang ändern.",
);
assert.equal(
  mapSetPlatformAdminError("user_not_found"),
  "Kein Konto zu dieser E-Mail gefunden.",
);
assert.equal(
  mapSetPlatformAdminError("cannot_demote_self"),
  "Du kannst dir den Verwaltungszugang nicht selbst entziehen.",
);
assert.equal(
  mapSetPlatformAdminError("last_admin"),
  "Der letzte Plattform-Admin kann nicht entfernt werden.",
);
assert.match(
  mapSetPlatformAdminError('Could not find the function public.set_platform_admin'),
  /20260818_set_platform_admin/,
);

console.log("platform-admin-grant tests: ok");
