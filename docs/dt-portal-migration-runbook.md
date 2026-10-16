# DigitalTwin Portal — Phase 7 migration runbook

Migrate data from the legacy Supabase project (`zijlepanidmvwxbuwldz`) into this app. **Do not delete anything on OLD** until Phase 8 sign-off.

## Prerequisites

1. Migration `20260609_dt_migration_legacy_session.sql` applied on **NEW** (adds `dt_chats.legacy_session_id`).
2. `.env.local` with:
   - `OLD_SUPABASE_URL` — e.g. `https://zijlepanidmvwxbuwldz.supabase.co`
   - `OLD_SUPABASE_SERVICE_ROLE_KEY` — service role from OLD project (remove after migration)
   - `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — NEW project
   - `APP_BASE_URL` — production URL for magic links
   - For `--send-invites`: `SMTP_*`, `DT_MIGRATION_INVITED_BY_USER_ID` (platform admin user UUID)

## Steps

### 1. Dry-run (no writes)

```bash
npx tsx scripts/dt-migrate-from-old-supabase.ts --dry-run
```

Review:

- `scripts/dt-migration-org-review.tsv` — unmapped legacy `client` slugs
- `scripts/dt-migration-invites-preview.tsv` — who would receive invites
- `logs/dt-migration-*.jsonl` — audit log

Map missing orgs manually in NEW (`organisations.slug` = legacy client slug) or re-run with `--apply` to auto-create orgs from the review file.

### 2. Apply migration

```bash
npx tsx scripts/dt-migrate-from-old-supabase.ts --apply
```

Optional single org:

```bash
npx tsx scripts/dt-migrate-from-old-supabase.ts --apply --org=roggendorf
```

Imports:

| OLD table | NEW target |
|-----------|------------|
| `persona_prompts` | `dt_agents` |
| `seo_clients` | `dt_org_config` |
| `seo_tasks` | `dt_seo_tasks` |
| `chat_messages` | `dt_chats` + `dt_chat_messages` |
| `seo_cache` | `dt_seo_reports` (historical, `state=done`) |
| `archived_sessions` | `dt_chats.archived_at` |
| `website_content` | `dt_site_pages` |

Re-running is **idempotent** for chats (unique `legacy_session_id`) and agents (unique `organisation_id, slug`).

### 3. Verify

The script exits with code **1** if per-org message counts differ. Spot-check in the UI:

- Homepage `/` — team chats for an migrated org
- **Verwaltung → SEO Modus** — tasks, reports, statistik

### 4. Send invites (production cutover only)

After human approval of `dt-migration-invites-preview.tsv`:

```bash
npx tsx scripts/dt-migrate-from-old-supabase.ts --apply --send-invites
```

- Creates `organisation_invites` (employee role)
- Sends magic-link email via SMTP (`lib/email/templates/dt-portal-welcome.ts`)
- Throttled to ~1 email/sec

### 5. WordPress / legacy URLs

Point legacy avatar pages to `https://www.digital-twin-sbkm.de/` (chat) and `/dashboard/verwaltung/seo` (SEO admin). Decommission OLD in Phase 8.

After WordPress is unused, lock down OLD so the public anon key can no longer read customer SEO config / reports / tasks: run `scripts/lock-down-old-supabase-rls.sql` in the OLD project SQL Editor (`zijlepanidmvwxbuwldz` / *digitaltwin n8n Workflow*). See `docs/old-supabase-full-inventory.md`.

## Troubleshooting

- **Missing OLD table** — script logs `skipped` and continues (partial OLD schemas).
- **Message count mismatch** — often duplicate partial run; inspect `dt_chats` for org, delete orphan chats without `legacy_session_id` only after backup.
- **Default chats invisible** — legacy `default` sessions are assigned to the org **owner** `user_id` when known; team/SEO sessions stay shared (`owner_user_id` null).
