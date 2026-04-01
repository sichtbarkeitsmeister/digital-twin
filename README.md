# DigitalTwin App - Entwicklerdokumentation (Atlassian/Confluence)

Diese Dokumentation ist so aufgebaut, dass neue Entwickler das Projekt eigenstaendig lokal starten, verstehen und deployen koennen.
Die Inhalte koennen direkt in Confluence uebernommen werden.

## 1) Projektueberblick

- **Ziel:** Web-App mit Auth, Organisationsverwaltung, Umfragen, Antworten und E-Mail-Benachrichtigungen.
- **Frontend/Backend:** Next.js App Router (TypeScript) in einem Repository.
- **Datenbank/Auth:** Supabase (Postgres + Auth + RLS).
- **Deployment:** Vercel (Production + Preview Deployments pro Branch/PR).

## 2) Tech Stack

- `next` (App Router), `react`, `typescript`
- `@supabase/ssr`, `@supabase/supabase-js`
- `tailwindcss`, `radix-ui`
- `nodemailer` fuer SMTP-Benachrichtigungen

## 3) Repository-Zugang

### Git-Repository

- **Remote URL:** `https://github.com/sichtbarkeitsmeister/digital-twin.git`
- Hauptbranch: `main`

### Zugriff fuer neue Entwickler

1. GitHub-Account bereitstellen.
2. Vom Repo-Owner/Org-Admin als Collaborator einladen lassen.
3. Nach Annahme der Einladung lokal klonen:

```bash
git clone https://github.com/sichtbarkeitsmeister/digital-twin.git
cd digital-twin
```

Optional (SSH statt HTTPS):

```bash
git clone git@github.com:sichtbarkeitsmeister/digital-twin.git
cd digital-twin
```

## 4) Lokales Setup

### Voraussetzungen

- Node.js 20+ (LTS empfohlen)
- npm (mitgeliefert bei Node)
- Supabase Projekt (URL + API Keys)
- SMTP-Zugang (fuer Notification-Mails)

### Installation

```bash
npm install
```

### Umgebungsvariablen

1. Datei `.env.local` im Projektroot anlegen (oder von `.env.example` ausgehen).
2. Werte eintragen:

#### Pflichtvariablen (Runtime)

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (nur serverseitig verwenden)
- `SMTP_HOST`
- `SMTP_PORT` (z. B. `587`)
- `SMTP_USER`
- `SMTP_PASS` (alternativ `SMTP_PASSWORD`)
- `SURVEY_NOTIFICATIONS_TO` (Empfaengerliste, getrennt durch `,` `;` oder Zeilenumbruch)

#### Empfohlene/optionale Variablen

- `SMTP_SECURE` (`true`/`false`, default nach Port)
- `SMTP_FROM` (Absenderadresse)
- `APP_BASE_URL` (z. B. `https://<deine-domain>`)
- `NEXT_PUBLIC_APP_BASE_URL` (Fallback fuer Base URL)
- `SUPABASE_PROJECT_ID` (fuer Type-Generierung)
- `SUPABASE_ACCESS_TOKEN` (optional fuer Script-Login)

Hinweis: `VERCEL_URL` wird in Vercel automatisch gesetzt.

### App starten

```bash
npm run dev
```

Standard-URL lokal: `http://localhost:3000`

## 5) Wichtige NPM-Skripte

- `npm run dev` - lokaler Dev-Server
- `npm run build` - Production Build
- `npm run start` - Production Start (lokal)
- `npm run lint` - ESLint
- `npm run types:generate` - Supabase TypeScript-Typen neu generieren
- `npm run env:check` - schnelle ENV-Pruefung
- `npm run env:check:next` - ENV-Pruefung mit Next ENV-Loader

## 6) Projektstruktur (relevant fuer Onboarding)

- `app/` - Seiten, Layouts und API Routes (Next.js App Router)
- `app/api/notifications/*` - API-Endpunkte fuer E-Mail-Benachrichtigungen
- `app/dashboard/*` - geschuetzter Admin/Mitglieder/Umfragen-Bereich
- `lib/supabase/*` - Client/Server/Service-Clients und Session-Proxy
- `lib/email/*` - SMTP-Versand + E-Mail-Templates
- `database/schema.sql` - zentrale Datenbankstruktur inkl. RLS, RPCs und Trigger
- `scripts/generate-types.ts` - Generierung von `lib/types/supabase.ts`
- `proxy.ts` - Request-Guard / Session-Update fuer geschuetzte Routen

## 7) Architektur und Zugriffsmodell

### Auth + Session

- Supabase Auth wird in SSR und Browser verwendet.
- `proxy.ts` + `lib/supabase/proxy.ts` uebernehmen Session-Refresh und Redirect auf Login fuer geschuetzte Routen.

### Rollenmodell

- Plattformrolle in `profiles.role`: `admin` oder `customer`.
- Organisationsrollen in `organisation_members.org_role`: `owner`, `admin`, `employee`.
- Rechte werden primär ueber RLS-Policies und SQL-RPCs in `database/schema.sql` durchgesetzt.

### Surveys

- Entwuerfe koennen privat oder oeffentlich sein (`surveys.visibility`).
- Oeffentliche Surveys laufen ueber Slug (`/s/[slug]`) und DB-RPCs.
- Fragen/Antworten pro Feld werden in `survey_field_questions` gespeichert.

### Benachrichtigungen

- Endpunkte:
  - `POST /api/notifications/survey-completed`
  - `POST /api/notifications/survey-question-asked`
- Versand via SMTP (`lib/email/mailer.ts`), HTML-Template in `lib/email/templates.ts`.

## 8) Datenbank-Setup (Supabase)

1. In Supabase SQL Editor den Inhalt aus `database/schema.sql` ausfuehren.
2. Pruefen, dass RLS auf den relevanten Tabellen aktiv ist.
3. Optional Typen neu generieren:

```bash
npm run types:generate
```

## 9) Deployment auf Vercel

Das Projekt laeuft auf **Vercel**.

### Initiales Setup

1. Repo in Vercel importieren (`sichtbarkeitsmeister/digital-twin`).
2. Framework: Next.js (wird i. d. R. automatisch erkannt).
3. Build Command: `npm run build`
4. Install Command: `npm install` (oder `npm ci`)
5. Output: Next.js Standard

### Environment Variables in Vercel

Alle Runtime-Variablen aus Abschnitt 4 muessen in Vercel gesetzt werden (mindestens fuer `Production`, idealerweise auch `Preview`).

### Domains

- Production Domain in Vercel konfigurieren.
- `APP_BASE_URL` auf die produktive Domain setzen.

### Deploy-Flow

- Push auf Branch -> Preview Deployment.
- Merge nach `main` -> Production Deployment (je nach Vercel-Settings).

## 10) Betriebs- und Debug-Hinweise

- Build-/Runtime-Logs in Vercel ansehen (Project > Deployments > Logs).
- Bei Login-/Session-Problemen zuerst Supabase Keys + Redirect URLs pruefen.
- Bei Mail-Problemen SMTP-Variablen und `SURVEY_NOTIFICATIONS_TO` pruefen.
- Bei Berechtigungsproblemen RLS-Policies und SQL-RPCs in `database/schema.sql` kontrollieren.

## 11) Empfehlung fuer Atlassian Confluence

Empfohlene Seitenstruktur:

1. **Projektueberblick**
2. **Zugaenge (GitHub, Vercel, Supabase)**
3. **Lokales Setup**
4. **Architektur**
5. **Deployment/Release**
6. **Runbook & Troubleshooting**

So bleibt die Seite fuer neue Teammitglieder und Vertretungen schnell nutzbar.

## 12) Detaillierte Projektlandkarte (wo ist was?)

Dieser Abschnitt beschreibt die Struktur so detailliert, dass ein neuer Entwickler den Codebereich fuer eine Aufgabe schnell findet.

### Root (Projektbasis)

- `package.json`  
  Abhaengigkeiten und Scripts (`dev`, `build`, `lint`, `types:generate` usw.).
- `package-lock.json`  
  Lockfile fuer reproduzierbare npm-Installationen.
- `tsconfig.json`  
  TypeScript-Konfiguration inkl. Alias `@/*`.
- `next.config.ts`  
  Next.js Runtime-Konfiguration (z. B. Images/Build-Verhalten).
- `tailwind.config.ts`, `postcss.config.mjs`  
  Styling-Pipeline fuer TailwindCSS.
- `proxy.ts`  
  Request-Matcher + Einstieg in Session-Handling (leitet auf `lib/supabase/proxy.ts` weiter).
- `.env.example`  
  Vorlage fuer minimale Supabase-Variablen.
- `.env.local`  
  Lokale geheimhaltungsbeduerftige Konfiguration (nicht committen).
- `start.js`  
  Produktionsstart ueber Next Public API.

### `app/` (Next.js App Router)

Enthaelt alle Seiten, Layouts, serverseitige Actions und API Routes.

- `app/layout.tsx`  
  Globales Root-Layout (ThemeProvider, Header/Footer, Metadata).
- `app/page.tsx`  
  Einstiegspunkt Homepage (Marketing/Weiterleitung in App-Flow je nach User/Mitgliedschaft).
- `app/auth/*`  
  Login, Signup, Fehlerseiten und Bestaetigungsroute (`auth/confirm` mit OTP-Verification).
- `app/settings/page.tsx`  
  Einstellungsseite fuer eingeloggte Nutzer.

#### `app/dashboard/` (geschuetzter Bereich)

- `app/dashboard/layout.tsx`  
  Gemeinsames Layout fuer Dashboard-Routen.
- `app/dashboard/page.tsx`  
  Redirect auf Standard-Unterseite.
- `app/dashboard/inbox/page.tsx`  
  Einladungs-Postfach (Organisationseinladungen annehmen).
- `app/dashboard/members/page.tsx`  
  Mitgliederansicht je Organisation.
- `app/dashboard/organisations/*`  
  Organisationsverwaltung und Detailseiten.
- `app/dashboard/admin/organisations/page.tsx`  
  Plattform-Admin-Tools (Organisationen anlegen/verwalten).
- `app/dashboard/surveys/*`  
  Survey-Backoffice:
  - `new` = neue Umfrage
  - `[surveyId]/edit` = Entwurf bearbeiten
  - `[surveyId]/responses` = Antwortliste
  - `[surveyId]/responses/[responseId]` = Detailansicht einer Antwort

#### `app/s/[slug]/page.tsx` (public survey)

- Oeffentliche Umfrage-Seite auf Basis des Slugs.
- Typischerweise fuer externe Antwortgeber ohne Dashboard-Zugang.

#### `app/api/` (Server Endpoints)

- `app/api/notifications/survey-completed/route.ts`  
  Trigger fuer Mail bei abgeschlossener Umfrage.
- `app/api/notifications/survey-question-asked/route.ts`  
  Trigger fuer Mail bei neu gestellter Feldfrage.

### `app/_components/` und `components/` (UI)

- `app/_components/*`  
  Seitennahe Komponenten (z. B. Chat-Mockup oder Dashboard-spezifische Bausteine).
- `components/*`  
  Wiederverwendbare App-Komponenten (Header, Footer, Auth-Buttons usw.).
- `components/ui/*`  
  UI-Grundbausteine (Button, Card, Input, Badge, Select etc.) auf Radix/Tailwind-Basis.

### `lib/` (Business- und Integrationslogik)

- `lib/supabase/client.ts`  
  Browser-Supabase-Client.
- `lib/supabase/server.ts`  
  Server-Supabase-Client mit Cookie-Weitergabe.
- `lib/supabase/service.ts`  
  Service-Role-Client (nur serverseitig; elevated permissions).
- `lib/supabase/proxy.ts`  
  Session-Refresh, Route-Guarding, Redirect-Logik.

- `lib/email/mailer.ts`  
  SMTP-Konfiguration, Transport, Versand, Helper (Empfaengerliste, Base URL).
- `lib/email/templates.ts`  
  HTML-Mail-Rendering (Branding/Templateaufbau).

- `lib/surveys/schema.ts`, `types.ts`, `storage.ts`, `utils.ts`  
  Survey-Domaenenlogik: Typen, Validierung, Mapping und Hilfsfunktionen.

- `lib/types/supabase.ts`  
  Generierte TypeScript-Typen aus dem Supabase-Schema.

- `lib/utils.ts`  
  Allgemeine Utilities (z. B. `cn()` fuer Klassen-Merge).

### `database/` (SQL, RLS, RPC)

- `database/schema.sql`  
  Zentrale DB-Definition:
  - Tabellen (Profiles, Organisations, Surveys, Responses, Questions)
  - Enums
  - Trigger/Functions
  - RPC-Funktionen fuer sichere Flows
  - RLS-Policies (Sicherheitskern)
- `database/README.md`  
  Erlaeuterungen zum Schema und Setup-Hinweise.

### `scripts/` (Entwickler-Tooling)

- `scripts/generate-types.ts`  
  CLI-Script zur Generierung von `lib/types/supabase.ts` aus Supabase.

### Typischer Task -> Wo im Projekt?

- **Login/Session Problem:** `proxy.ts`, `lib/supabase/proxy.ts`, `app/auth/*`
- **Neue API Route:** `app/api/.../route.ts`
- **Survey-Feature erweitern:** `app/dashboard/surveys/*` + `lib/surveys/*` + `database/schema.sql`
- **Mail-Inhalte aendern:** `lib/email/templates.ts` (Layout) und `lib/email/mailer.ts` (Versand)
- **Rechte/Berechtigungen aendern:** `database/schema.sql` (RLS + RPC)
- **Admin-Funktion erweitern:** `app/dashboard/admin/organisations/page.tsx` + passende DB-RPC
