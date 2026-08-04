# DigitalTwin n8n — SEO workflows (legacy → v2 port)

Maps the production workflow **Sichtbarkeitsmeister SEO-Report** (`6voT3Eu7jFETcuJP`, webhook `seo-report`) to the NEW portal.

## Workflows

| v2 name | Webhook / cron | Source |
|---------|----------------|--------|
| **DT v2 - SEO Report** | `POST /webhook/dt-seo-report` `{ reportId }` | Clone of legacy + patches |
| **DT v2 - Monthly Analytics** | `POST /webhook/dt-monthly-analytics` `{ organisationId }` | GSC + GA4 nodes (legacy credentials) |
| **DT v2 - Monthly Analytics Scheduler** | Cron `0 3 1 * *` | Lists orgs → triggers collect webhook |

Legacy workflow is **not modified**.

## NEW internal APIs (n8n → Next.js)

| Route | Purpose |
|-------|---------|
| `GET /api/dt/internal/seo-report/[id]/context` | Legacy-shaped config + `reportId` for Parameter verarbeiten |
| `POST /api/dt/seo/reports/[id]/complete` | `running` / `done` / `error` (replaces OLD `seo_cache`) |
| `GET /api/dt/internal/seo-orgs` | All `seo_enabled` orgs (scheduler) |
| `GET /api/dt/internal/seo-org/[orgId]/config` | Per-org config for monthly job |
| `POST /api/dt/internal/seo-monthly-stats` | Upsert `dt_seo_monthly_stats` |

All internal routes: header `X-DT-Webhook-Secret: $DT_INTERNAL_WEBHOOK_SECRET`.

## Legacy node mapping (SEO report)

| Legacy | v2 |
|--------|-----|
| Webhook `seo-report` `{ url, … }` | Webhook `dt-seo-report` `{ reportId }` |
| HTTP Request1 → OLD `seo_clients` | GET internal report context (NEW Supabase) |
| — | **DT Mark Running** → `/complete` `running` |
| Parameter verarbeiten | Unchanged (+ `reportId` in output) |
| GA4 / GSC / Sistrix / Claude / Email nodes | **Copied as-is** (same OAuth credentials) |
| HTTP Request → OLD `seo_cache` | **Removed** (payload saved on `done` only) |
| SEO Cache: Status Done | **DT Complete Done** → `/complete` + tasks |
| SEO Cache: Status Error | **DT Complete Error** |
| Monatlicher Trigger | **Removed** (use portal button or scheduler) |

## Deploy

```bash
# From repo root (.env.local: N8N_*, APP_BASE_URL, DT_INTERNAL_WEBHOOK_SECRET)
npm run dt:n8n:chat               # DT v2 - Chat: Handler-Code + Werkzeuge
npm run dt:n8n:seo-report
npm run dt:n8n:monthly-collect
npm run dt:n8n:monthly-scheduler
```

**Wichtig:** Die SEO-Werkzeuge des Beraters (`read_sitemap`, `inspect_website_url`,
`audit_site_indexability`, `update_seo_task`, `delete_seo_task`, `check_serp_snippet`)
stecken in `scripts/n8n/dt-v2-chat-handler.js`. Läuft der Chat über n8n
(`N8N_DT_CHAT_WEBHOOK` gesetzt), kennt er neue Werkzeuge erst nach
`npm run dt:n8n:chat`. Der direkte Weg über die App ist sofort nach dem Deploy aktuell.
Welcher Pfad gelaufen ist, steht als Badge unter Verwaltung → Nutzung.

Set in Vercel / `.env.local`:

```bash
N8N_DT_SEO_REPORT_WEBHOOK=https://sichtbarkeitsmeister.app.n8n.cloud/webhook/dt-seo-report
```

## Manual test

1. Portal → **Verwaltung → SEO Modus** → trigger report.
2. n8n execution should: load context → GA4/GSC/Sistrix → email → `dt_seo_reports.state=done`.
3. Monthly: `POST /webhook/dt-monthly-analytics` with `{ "organisationId": "<uuid>" }`.

## Still on legacy credentials

Google Analytics OAuth (`By9v2sueCb89FnqT`), GSC OAuth (`HIb6PZVkNIemvbtI`), Anthropic, SMTP, Sistrix API key in n8n — same as production SEO report. No secrets in repo.
