/**
 * Phase 7 — migrate legacy DigitalTwin data from OLD Supabase into this project.
 *
 * Usage:
 *   npx tsx scripts/dt-migrate-from-old-supabase.ts --dry-run
 *   npx tsx scripts/dt-migrate-from-old-supabase.ts --apply
 *   npx tsx scripts/dt-migrate-from-old-supabase.ts --apply --org=roggendorf
 *   npx tsx scripts/dt-migrate-from-old-supabase.ts --apply --send-invites
 *
 * Requires OLD_SUPABASE_* and SUPABASE_SERVICE_ROLE_KEY in .env.local
 * See docs/dt-portal-migration-runbook.md
 */
import { runDtMigration } from "@/lib/dt/migration/run";

function parseArgs(argv: string[]) {
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

  console.log(
    JSON.stringify(
      {
        mode: opts.apply ? (opts.dryRun ? "dry-run+apply?" : "apply") : "dry-run",
        sendInvites: opts.sendInvites,
        orgFilter: opts.orgFilter,
      },
      null,
      2,
    ),
  );

  const { counts, mismatches, orgEntries } = await runDtMigration({
    dryRun: !opts.apply,
    apply: opts.apply,
    sendInvites: opts.sendInvites,
    orgFilter: opts.orgFilter,
  });

  console.log("\nOrganisations:", orgEntries.length);
  console.log("Counts:", counts);

  if (mismatches.length > 0) {
    console.error("\nVerification mismatches (messages per org):");
    for (const m of mismatches) {
      console.error(
        `  ${m.legacyClient}: OLD ${m.oldMessages} vs NEW ${m.newMessages} (${m.organisationId})`,
      );
    }
    process.exit(1);
  }

  if (!opts.apply) {
    console.log("\nDry-run complete. Review scripts/dt-migration-org-review.tsv and");
    console.log("scripts/dt-migration-invites-preview.tsv, then run with --apply.");
  } else {
    console.log("\nMigration apply finished.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
