# AGENTS.md

## Cursor Cloud specific instructions

This is a Next.js (App Router, TypeScript) app backed by Supabase (Postgres + Auth + RLS).
Standard commands live in `package.json` `scripts` and are documented in `README.md`
(sections 4–6). Below are only the non-obvious things needed to run it locally in this
cloud VM.

### Services

- Next.js dev server: `npm run dev` → http://localhost:3000
- Local Supabase stack (Postgres, Auth/GoTrue, REST, Studio, Mailpit): `npx supabase start`
  - Studio: http://localhost:54323, Mailpit (email inbox): http://localhost:54324
  - Postgres: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- The AI/chat, SEO, and email-notification features additionally need external
  credentials (`ANTHROPIC_API_KEY`, SMTP, n8n webhooks). These are NOT required for the
  core auth / organisations / surveys flows and are absent by default here.

### Running the environment (order matters)

1. Ensure the Docker daemon is running (local Supabase needs it). If `docker ps` fails,
   start it: `sudo dockerd > /tmp/dockerd.log 2>&1 &` and, if the socket is
   root-only, `sudo chmod 666 /var/run/docker.sock`.
2. `npx supabase start` (first run pulls images; the local keys/URLs it prints are
   deterministic across runs).
3. Apply the schema to the fresh local DB (the `supabase/migrations` dir is intentionally
   empty; `database/schema.sql` is the single source of truth for the schema):
   `docker exec -i supabase_db_workspace psql -U postgres -d postgres < database/schema.sql`
4. IMPORTANT: restart the Auth container once after `supabase start` so it loads the
   custom magic-link email template (GoTrue caches the default template if it boots
   before the template server is ready): `docker restart supabase_auth_workspace`
5. Create `.env.local` (gitignored) pointing at local Supabase, then `npm run dev`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<Publishable key from `npx supabase status`>
   SUPABASE_SERVICE_ROLE_KEY=<Secret key from `npx supabase status`>
   APP_BASE_URL=http://localhost:3000
   NEXT_PUBLIC_APP_BASE_URL=http://localhost:3000
   ```

### Auth flow gotchas (magic link)

- Login/signup is passwordless magic link (`signInWithOtp`). Emails are delivered to
  Mailpit (http://localhost:54324), not sent for real.
- The app's `/auth/confirm` route expects the `token_hash` query-param flow. The local
  Supabase default email template uses the `/auth/v1/verify?token=...` redirect flow,
  which lands on `/auth/confirm` with no `token_hash` and fails
  ("No token hash or type"). This repo's `supabase/templates/magic_link.html` (wired via
  `supabase/config.toml`) fixes this by linking to
  `/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink&next=/dashboard`.
  If magic-link login errors with "No token hash or type", re-do step 4 above
  (restart the auth container).
- New signups get `profiles.role = 'customer'`. Only platform admins can create
  organisations. To test admin flows, promote a user:
  `docker exec -i supabase_db_workspace psql -U postgres -d postgres -c "UPDATE public.profiles SET role='admin' WHERE email='<you>';"`
- Regular (non-admin) users only see organisations they are invited to; there is no
  self-serve org creation in the UI.

### Lint / build

- Lint: `npm run lint`. Note the repo currently has pre-existing lint errors (unused
  vars, unescaped entities) unrelated to environment setup.
- There is no automated unit/integration test framework; `npm run test:survey-to-agent`
  is a standalone tsx script that needs `ANTHROPIC_API_KEY`.

### Notes

- After creating an organisation via the admin form, the org list on the right does not
  live-update; it refreshes on navigation/reload (uses `revalidatePath`). This is
  existing app behavior, not a setup issue.
- `.env.local`, `supabase/.temp`, and `supabase/.branches` are gitignored. The committed
  `supabase/config.toml` + `supabase/templates/` are local-dev config only.
