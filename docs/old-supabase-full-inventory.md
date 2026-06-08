# OLD Supabase inventory (`zijlepanidmvwxbuwldz`)

Captured via MCP on 2026-05-28. Source of truth for Phase 7 migration into **NEW** (`hqjszschgjzfnsecngit` / sbkm).

## Tables (public)

| Table | Rows | RLS | Purpose |
|-------|------|-----|---------|
| `chat_messages` | 2,981 | on | All avatar/SEO chat history |
| `persona_prompts` | 42 | on | Per-client avatar prompts + `avatar_data` |
| `seo_clients` | 14 | **off** | SEO customer config (GA4, GSC, Sistrix, …) |
| `client_config` | 11 | **off** | Avatar page config (webhook, quick actions) |
| `seo_cache` | 9 | **off** | Last SEO report payloads per client |
| `seo_tasks` | 18 | **off** | SEO task board |
| `website_content` | 1 | **off** | Crawled page snapshot (`client`/`url` were `=` — mapped to `naturheilpraxis-weber`) |
| `archived_sessions` | 5 | **off** | Archived chat session ids |

> Six tables have RLS disabled on OLD — data was readable with the anon key (security risk on legacy project).

## Chat volume by `client`

| client | messages | Notes |
|--------|----------|--------|
| intensivpflege-ayags | 818 | |
| sichtbarkeitsmeister | 600 | |
| roggendorf | 277 | |
| steiner-umzuege | 251 | |
| dr-muster | 236 | |
| allround | 192 | |
| hemmersbach-druck | 122 | |
| schoepker | 118 | |
| `=` / `=dr-muster` / `=roggendorf` | 227 | Legacy bugs — normalised on import |
| naturheilpraxis-weber | 61 | |
| online-media-atelier | 39 | |
| FEHLER / null | 34 | Skipped on import |
| droste | 6 | |

## SEO clients (`seo_clients.client` → NEW org `slug`)

| client slug | kunde | aktiv |
|-------------|-------|-------|
| allround | Allround Präzisionsteile GmbH | yes |
| arctictub | ArcticTub | yes |
| dr-muster | Dr. Muster Praxis | yes |
| finedent-duesseldorf | Finedent Düsseldorf | yes |
| gasanov | Gasanov | yes |
| roggendorf | Gebr. Roggendorf | yes |
| hemmersbach-druck | Hemmersbach Druck | yes |
| intensivpflege-ayags | Intensivpflege Ayags GmbH | yes |
| online-media-atelier | Online Media Atelier | yes |
| naturheilpraxis-weber | Praxis für Naturheilverfahren … | yes |
| droste | Provinzial Droste | yes |
| sichtbarkeitsmeister | Sichtbarkeitsmeister | yes |
| steiner-umzuege | Steiner Umzüge | yes |
| schoepker | Tischlerei Schöpker | yes |

## Personas (42 rows)

Clients with avatars: `allround`, `dr-muster`, `droste`, `hemmersbach-druck`, `intensivpflege-ayags`, `naturheilpraxis-weber`, `online-media-atelier`, `roggendorf`, `schoepker`, `sichtbarkeitsmeister`, `steiner-umzuege`. Each has one or more `avatar_id` (often including `seo_advisor`, Wunschkunde-style personas).

## NEW app before migration

| organisations | slug |
|---------------|------|
| Roggendorf | `roggendorf` |
| Sichtbarkeitsmeister | *(null — fixed to `sichtbarkeitsmeister`)* |

## Import mapping

| OLD | NEW |
|-----|-----|
| `seo_clients` | `organisations` + `dt_org_config` |
| `persona_prompts` | `dt_agents` |
| `chat_messages` | `dt_chats` + `dt_chat_messages` (`legacy_session_id`) |
| `seo_tasks` | `dt_seo_tasks` |
| `seo_cache` | `dt_seo_reports` (historical, `done`) |
| `archived_sessions` | `dt_chats.archived_at` |
| `website_content` | `dt_site_pages` |

Run: `OLD_SUPABASE_ANON_KEY=… npm run dt:migrate:apply` (see `docs/dt-portal-migration-runbook.md`).
