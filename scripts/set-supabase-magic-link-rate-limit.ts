/**
 * Set hosted Supabase Auth email/OTP rate limits to 12 magic links per hour.
 *
 * Usage:
 *   npx tsx scripts/set-supabase-magic-link-rate-limit.ts
 *   npx tsx scripts/set-supabase-magic-link-rate-limit.ts --dry-run
 *
 * Needs SUPABASE_ACCESS_TOKEN (https://supabase.com/dashboard/account/tokens)
 * and SUPABASE_PROJECT_ID or NEXT_PUBLIC_SUPABASE_URL.
 */
import { loadEnvConfig } from "@next/env";

import {
  MAGIC_LINK_EMAILS_PER_HOUR,
  authEmailRateLimitPatch,
  supabaseProjectRefFromUrl,
} from "../lib/auth/magic-link-rate-limit";

loadEnvConfig(process.cwd());

const dryRun = process.argv.includes("--dry-run");
const patch = authEmailRateLimitPatch(MAGIC_LINK_EMAILS_PER_HOUR);
const projectRef =
  process.env.SUPABASE_PROJECT_ID?.trim() ||
  supabaseProjectRefFromUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();

if (!projectRef) {
  console.error(
    "Missing project ref. Set SUPABASE_PROJECT_ID or NEXT_PUBLIC_SUPABASE_URL.",
  );
  process.exit(1);
}
if (!token) {
  console.error(
    "Missing SUPABASE_ACCESS_TOKEN. Create one at https://supabase.com/dashboard/account/tokens",
  );
  process.exit(1);
}

const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`;

async function readAuthConfig(): Promise<Record<string, unknown>> {
  const res = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`GET auth config failed (${res.status}): ${body.slice(0, 500)}`);
  }
  return JSON.parse(body) as Record<string, unknown>;
}

async function main() {
  const before = await readAuthConfig();
  console.log("Project:", projectRef);
  console.log("Current rate_limit_email_sent:", before.rate_limit_email_sent);
  console.log("Current rate_limit_otp:", before.rate_limit_otp);
  console.log("Target:", patch);

  if (dryRun) {
    console.log("Dry run — no change written.");
    return;
  }

  const res = await fetch(endpoint, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(patch),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`PATCH auth config failed (${res.status}): ${body.slice(0, 800)}`);
  }

  const after = await readAuthConfig();
  console.log("Updated rate_limit_email_sent:", after.rate_limit_email_sent);
  console.log("Updated rate_limit_otp:", after.rate_limit_otp);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
