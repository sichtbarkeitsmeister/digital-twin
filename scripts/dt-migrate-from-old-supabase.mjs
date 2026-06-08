/**
 * Phase 7 — migrate legacy DigitalTwin data (OLD → NEW).
 * Usage: npx tsx scripts/dt-migrate-from-old-supabase.mjs --apply
 */
import nextEnv from "@next/env";
import { runDtMigration } from "../lib/dt/migration/run.ts";

nextEnv.loadEnvConfig(process.cwd(), false);

function parseArgs(argv) {
  const apply = argv.includes("--apply");
  const dryRun = !apply || argv.includes("--dry-run");
  const sendInvites = argv.includes("--send-invites");
  const orgArg = argv.find((a) => a.startsWith("--org="));
  const orgFilter = orgArg ? orgArg.split("=")[1]?.trim() ?? null : null;
  return { dryRun, apply, sendInvites, orgFilter };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.sendInvites && !opts.apply) {
    console.error("--send-invites requires --apply");
    process.exit(1);
  }

  console.log(JSON.stringify({ mode: opts.apply ? "apply" : "dry-run", ...opts }, null, 2));

  const { counts, mismatches, orgEntries } = await runDtMigration({
    dryRun: !opts.apply,
    apply: opts.apply,
    sendInvites: opts.sendInvites,
    orgFilter: opts.orgFilter,
  });

  console.log("\nOrganisations:", orgEntries.length);
  console.log("Counts:", counts);

  if (mismatches.length > 0) {
    console.error("\nVerification mismatches:");
    for (const m of mismatches) console.error(`  ${m.legacyClient}: OLD ${m.oldMessages} vs NEW ${m.newMessages}`);
    process.exit(1);
  }

  if (!opts.apply) {
    console.log("\nDry-run done. Run with --apply to import.");
  } else {
    console.log("\nMigration finished.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
