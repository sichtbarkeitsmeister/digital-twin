# DigitalTwin (Next.js + Supabase)

This repo is a **Next.js App Router** web app backed by **Supabase** (Auth + Postgres + RLS). It includes an authentication flow, an organisation/membership dashboard (invites, roles), and a small settings page.

## Tech stack

- **Next.js** (App Router) + **React 19**
- **Supabase**: SSR client (`@supabase/ssr`), Auth, Postgres, Row Level Security (RLS), RPC functions
- **Tailwind CSS** + **shadcn/ui** (Radix UI primitives)
- **TypeScript** + **Zod** (server action input validation)

## App routes (high level)

- **`/`**: marketing/home; if signed in and you have organisations, shows a chat mockup selector
- **`/auth/login`**, **`/auth/sign-up`**: auth pages
- **`/auth/confirm`**: email OTP confirmation handler (Supabase verify OTP)
- **`/dashboard`**: lists your org memberships + invite inbox; platform admins also see org admin tools
- **`/dashboard/organisations/[organisationId]`**: manage one organisation (members, invites, ownership)
- **`/settings`**: read-only account info (email + user id)

## Local development

### Prerequisites

- Node.js (LTS recommended)
- A Supabase project

### 1) Install dependencies

```bash
npm install
```

### 2) Configure environment variables

Create a `.env.local` in the project root:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
# Use either name for the public browser key (both are supported by this app):
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLIC_KEY
# OR:
# NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLIC_KEY
```

Notes:

- Only use the **anon/publishable** key client-side (never a service role key). See `SECURITY.md`.
- `VERCEL_URL` is used only to build absolute metadata URLs in `app/layout.tsx` (optional locally).

### 3) Set up the database schema (Supabase)

This project expects the schema/RLS/RPCs from `database/schema.sql`.

- Open your Supabase project → **SQL Editor**
- Paste the contents of `database/schema.sql`
- Run it

Additional schema notes live in `database/README.md`.

### 4) Run the dev server

```bash
npm run dev
```

Then open `http://localhost:3000`.

## Supabase session / route protection

- **Server-side checks**: Pages like `app/dashboard/page.tsx` and `app/settings/page.tsx` validate the session server-side and redirect to `"/auth/login"` if needed.
- **Request-level session refresh**: `lib/supabase/proxy.ts` implements an `updateSession()` helper (cookie sync + redirect when unauthenticated).
  - The repo currently exposes it via the root `proxy.ts`. If you want this to run as Next.js middleware, rename `proxy.ts` to `middleware.ts` (Next.js only auto-runs middleware from `middleware.ts`).

## Scripts

- **`npm run dev`**: start Next.js dev server
- **`npm run build`**: production build
- **`npm run start`**: run production server
- **`npm run lint`**: ESLint
- **`npm run types:generate`**: regenerate `lib/types/supabase.ts` from your Supabase project
  - Requires `.env.local` values:
    - `SUPABASE_PROJECT_ID`
    - `SUPABASE_ACCESS_TOKEN` (optional if you’re already logged into the Supabase CLI)

## Project structure

- **`app/`**: Next.js routes (App Router)
- **`components/`**: shared UI + forms
- **`lib/supabase/`**: Supabase clients (browser/server) + session proxy helper
- **`database/`**: SQL schema + documentation
- **`scripts/`**: utilities (e.g. Supabase type generation)

## Security

Read `SECURITY.md` before making auth / database changes, especially:

- never expose a Supabase **service role** key to the browser
- keep **RLS enabled** and prefer **RPCs** for privileged writes
