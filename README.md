# DigitalTwin – Anleitung für das Team

Diese Anleitung erklärt das Programm so, dass man es verstehen, auf dem eigenen Rechner starten und im Internet betreiben kann. Fachwörter werden beim ersten Mal in Alltagssprache erklärt.

Die Texte können Abschnitt für Abschnitt nach Confluence kopiert werden.

---

## 1. Was ist DigitalTwin?

DigitalTwin ist die Web-App von Sichtbarkeitsmeister für Kundenfirmen.

Eine **Organisation** ist dabei eine Kundenfirma (oder die eigene Agentur). Für jede Firma gibt es:

- einen **Chat** mit KI-Figuren (Avatare, Team, SEO-Berater). Die KI heißt Claude und kommt von Anthropic.
- **Fragebögen**. Daraus kann ein Avatar entstehen, der so antwortet wie die Zielkunden der Firma.
- ein **SEO-Arbeitsplatz** für die Agentur: Website prüfen, Berichte schreiben, Aufgaben verwalten, Daten aus der Google Search Console holen.
- **Onboarding**: Unterlagen der Firma einsammeln, auch über einen Link, den der Kunde ohne Login öffnen kann.
- **E-Mails**: Einladungen, Willkommensmails, Hinweise zu Fragebögen und SEO.

Wer nicht eingeloggt ist, sieht die öffentliche Startseite. Wer eingeloggt ist und zu mindestens einer Firma gehört, sieht auf der Startseite den Chat.

---

## 2. Die Bausteine in einfachen Worten

Das Programm besteht nicht aus einer einzigen Datei. Es hängt an mehreren Diensten. Fehlt einer, funktioniert ein Teil der App nicht.

| Baustein | Was das im Alltag bedeutet | Was passiert, wenn er fehlt |
|---|---|---|
| **Dieses Git-Repository** | Der Quelltext. Alle Änderungen kommen hier her. | Es gibt nichts zum Starten. |
| **Node.js und npm** | Das Werkzeug, mit dem man das Programm auf dem Rechner startet. Node ist die Laufzeit, npm installiert die mitgelieferten Bausteine. | `npm install` und `npm run dev` gehen nicht. |
| **Supabase** | Die Datenbank und die Anmeldung. Hier liegen Firmen, Nutzer, Chats, Fragebögen und Berichte. Supabase prüft bei jedem Zugriff, ob die Person das sehen darf. | Login und fast alle Seiten gehen nicht. |
| **Vercel** | Der Rechner im Internet, auf dem die öffentliche Website läuft. Jeder Branch und jeder Pull Request bekommt eine eigene Vorschau-Adresse. Der Branch `main` ist die echte Website. | Lokal geht alles, im Internet nicht. |
| **Anthropic (Claude)** | Die KI für Chat, Fragebögen, Avatare und Texte. | Chat und KI-Funktionen antworten mit einem Fehler. |
| **n8n** | Ein Automatisierungs-Dienst. Er stößt lange Aufgaben an: SEO-Berichte, Google-Search-Console, monatliche Zahlen. Die Adresse steht in `.env.example`. | Chat kann trotzdem direkt über Claude laufen. SEO-Berichte und Search Console nicht. |
| **SMTP** | Der E-Mail-Versand (Host, Benutzer, Passwort). | Es gehen keine Einladungen und Hinweis-Mails raus. |
| **Google Search Console** | Googles eigene Daten zur Website des Kunden. Der Abruf läuft über n8n, nicht direkt aus dem Browser. | Index- und Seiten-Daten bleiben leer. |

Die produktive Website in der Beispiel-Konfiguration ist `https://www.digital-twin-sbkm.de`.

---

## 3. Wer darf was?

Es gibt zwei Ebenen. Beide gelten gleichzeitig.

### Ebene 1: Rolle auf der ganzen Plattform

Steht in der Tabelle `profiles`, Spalte `role`.

| Rolle | Wer das ist | Was die Person sieht |
|---|---|---|
| `admin` | Plattform-Admin. Jede Adresse mit `@sichtbarkeitsmeister.de` wird beim Anlegen automatisch Admin. | Den Bereich **Verwaltung** und **Admin**: SEO-Modus, Texte, Agent-Kontext, Transkripte, Erstgespräch, Leads, Integrationen, Token-Nutzung, alle Firmen, Team, Jobs, E-Mail-Protokoll, Agent-Anfragen. |
| `customer` | Alle anderen Konten. | Nur die Firmen, in denen die Person Mitglied ist. |

Ein Admin darf Agenten direkt ändern. Ein Firmeninhaber darf Änderungen nur **beantragen**. Die Anfragen landen unter **Agent-Anfragen**.

### Ebene 2: Rolle innerhalb einer Firma

Steht in `organisation_members`, Spalte `org_role`.

| Rolle | Bedeutung |
|---|---|
| `owner` | Inhaber der Firma. Darf Agenten mitverwalten, SEO-Berichte lesen und die Firma führen. |
| `admin` | Verwalter in der Firma. Darf Agenten mitverwalten, aber nicht die vollen SEO-Werkzeuge der Agentur. |
| `employee` | Normales Mitglied. Darf Chat, Posteingang, Onboarding, Ansprechpartner und Fragebögen der eigenen Firma nutzen. |

Die Datenbank erzwingt das selbst. Diese Regeln heißen **RLS** (Row Level Security): Selbst wenn eine Seite einen Fehler hat, gibt die Datenbank fremde Zeilen nicht heraus. Zusätzlich gibt es fertige Datenbank-Befehle, **RPCs** genannt. Die App ruft sie auf, statt die Tabellen direkt zu beschreiben.

---

## 4. Zugänge, die eine neue Person braucht

Ohne diese Zugänge kann man nur den Quelltext lesen, das Programm aber nicht sinnvoll starten.

1. **GitHub**  
   Repository: `https://github.com/sichtbarkeitsmeister/digital-twin.git`  
   Hauptbranch: `main`  
   Der gemeinsame GitHub-Zugang des Teams ist das Konto `mail@sichtbarkeitsmeister.de`. Neue Personen lässt ein Admin als Mitarbeiter einladen. Danach klont man das Projekt (siehe Abschnitt 5).

2. **Supabase**  
   Im Supabase-Projekt unter **Project Settings → API** liegen drei Werte: die Projekt-URL, der öffentliche Schlüssel (`publishable` oder `anon`) und der geheime **Service-Role-Schlüssel**. Den Service-Role-Schlüssel nur auf dem Server verwenden. Er umgeht die Rechteprüfung und darf nicht in den Browser.

3. **Vercel**  
   Dieselbe Team-Anmeldung wie bei GitHub (`mail@sichtbarkeitsmeister.de`). Dort liegen die echten Produktions-Werte und die Logs.

4. **Anthropic**  
   Ein API-Schlüssel für Claude.

5. **n8n**  
   Instanz: `https://sichtbarkeitsmeister.app.n8n.cloud`  
   Für das Ausrollen der Automationen braucht man den n8n-API-Schlüssel. Für den laufenden Betrieb braucht die App die Webhook-Adressen (siehe Abschnitt 6).

6. **SMTP**  
   Host, Port, Benutzer, Passwort und die Empfängerliste für Fragebogen-Hinweise.

7. **Optional, nur für Entwickler-Skripte**  
   Supabase Management API: `SUPABASE_PROJECT_ID` und `SUPABASE_ACCESS_TOKEN`. Damit erzeugt man TypeScript-Typen neu und kann das Magic-Link-Limit setzen.

Geheimnisse stehen in `.env.local` auf dem Rechner und in Vercel. Diese Datei wird nicht ins Git übernommen.

---

## 5. Das Programm auf dem eigenen Rechner starten

### Was vorher installiert sein muss

- **Node.js 20 oder neuer** (die LTS-Version). npm kommt mit Node mit.
- Ein Supabase-Projekt, dessen Datenbank schon eingerichtet ist (Abschnitt 7).
- Die Schlüssel aus Abschnitt 4.

### Schritt für Schritt

1. Projekt holen:

```bash
git clone https://github.com/sichtbarkeitsmeister/digital-twin.git
cd digital-twin
```

Wer SSH benutzt:

```bash
git clone git@github.com:sichtbarkeitsmeister/digital-twin.git
cd digital-twin
```

2. Bausteine installieren:

```bash
npm install
```

3. Die Beispiel-Datei kopieren und ausfüllen:

```bash
cp .env.example .env.local
```

`.env.example` enthält die DigitalTwin-Einstellungen, aber **keine** SMTP-Werte. Die SMTP-Zeilen aus Abschnitt 6 müssen von Hand dazu.

4. Starten:

```bash
npm run dev
```

5. Im Browser öffnen: `http://localhost:3000`

Ohne die beiden Supabase-Zeilen `NEXT_PUBLIC_SUPABASE_URL` und `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` zeigt die Startseite nur die Marketing-Seite, auch wenn man eingeloggt wäre. Die Anmeldung selbst liegt unter `http://localhost:3000/auth/login`.

---

## 6. Alle Einstellungen erklärt

Jede Zeile ist eine **Umgebungsvariable**: ein Name und ein geheimer Wert. Lokal stehen sie in `.env.local`. Auf Vercel trägt man dieselben Namen unter **Settings → Environment Variables** ein, mindestens für **Production**, besser auch für **Preview**.

### Damit die App überhaupt startet und sich jemand anmelden kann

| Name | Was er bedeutet |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Adresse des Supabase-Projekts. `NEXT_PUBLIC_` heißt: der Browser darf sie sehen. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Öffentlicher Supabase-Schlüssel. Reicht zusammen mit den Datenbank-Regeln für normale Nutzer. |
| `SUPABASE_SERVICE_ROLE_KEY` | Geheimer Hauptschlüssel. Nur der Server darf ihn benutzen. |

### Damit E-Mails rausgehen

| Name | Was er bedeutet |
|---|---|
| `SMTP_HOST` | Server des E-Mail-Anbieters. |
| `SMTP_PORT` | Meist `587`. |
| `SMTP_USER` | Anmeldename. |
| `SMTP_PASS` | Passwort. `SMTP_PASSWORD` ist derselbe Wert unter anderem Namen. |
| `SURVEY_NOTIFICATIONS_TO` | Wer Fragebogen-Hinweise bekommt. Mehrere Adressen mit Komma, Semikolon oder Zeilenumbruch trennen. |
| `SMTP_SECURE` | `true` oder `false`. Wenn leer, gilt bei Port 465 verschlüsselt, sonst nicht. |
| `SMTP_FROM` | Absenderadresse. |
| `SMTP_FROM_NAME` | Angezeigter Absendername. Standard: `Sichtbarkeitsmeister`. |
| `DT_SEO_ALERT_EMAIL` | Zusätzliche Adresse für SEO-Hinweise an die Agentur. Optional. |

### Damit die KI antwortet

| Name | Was er bedeutet |
|---|---|
| `ANTHROPIC_API_KEY` | Schlüssel für Claude. Ohne ihn gibt es keinen Chat und keine Avatar-Erzeugung. |
| `ANTHROPIC_DT_PERSONA_MODEL` | Modell für normale Avatar-Chats. Standard: ein günstigeres Haiku-Modell. |
| `ANTHROPIC_DT_SEO_MODEL` | Modell für den SEO-Chat. Standard: Sonnet. |
| `ANTHROPIC_DT_TEAM_MODEL` | Modell für Team-Chats. |
| `ANTHROPIC_DT_GHOST_MODEL` | Modell für den internen Ghost-Modus. |
| `ANTHROPIC_DT_TITLE_MODEL` | Optionales günstigeres Modell für automatische Chat-Titel. |
| `ANTHROPIC_DT_SURVEY_MODEL` | Modell, das aus einem Fragebogen einen Avatar schreibt. Standard: Sonnet. |
| `ANTHROPIC_DT_SURVEY_MAX_TOKENS` | Wie lang diese Antwort werden darf. Standard ist hoch angesetzt, weil die Texte lang sind. |
| `ANTHROPIC_SURVEY_CHAT_MODEL` | Modell für den Fragebogen-Assistenten im Gespräch. |
| `ANTHROPIC_SURVEY_ACTION_MODEL` | Modell, wenn der Assistent den Fragebogen wirklich ändert. |
| `ANTHROPIC_SURVEY_MODEL` | Älterer Ersatz nur für das Aktions-Modell. |
| `ANTHROPIC_SURVEY_PROMPT_CACHE` | `1` lässt wiederkehrende Anweisungen zwischenspeichern. `0` schaltet das aus. |
| `ANTHROPIC_SURVEY_MULTIPHASE` | `1` baut große neue Fragebögen in mehreren Schritten. `0` schaltet das aus. |

Die genauen Modellnamen stehen in `.env.example`. Sie ändern sich, wenn Anthropic neue Modelle herausbringt.

### Damit Links in Mails und Automationen stimmen

| Name | Was er bedeutet |
|---|---|
| `APP_BASE_URL` | Die öffentliche Adresse der App, zum Beispiel `https://www.digital-twin-sbkm.de`. n8n ruft diese Adresse auf. `http://localhost:3000` funktioniert für n8n im Internet nicht. Zum lokalen Test mit n8n braucht man eine Tunnel-Adresse (zum Beispiel ngrok). |
| `NEXT_PUBLIC_APP_BASE_URL` | Ersatz, falls `APP_BASE_URL` leer ist. |
| `VERCEL_URL` | Setzt Vercel von selbst. Nicht von Hand eintragen. |

`APP_BASE_URL` darf in der Datei nur **einmal** stehen. Eine zweite Zeile überschreibt die erste.

### Damit Hintergrund-Jobs laufen

| Name | Was er bedeutet |
|---|---|
| `JOBS_WORKER_TOKEN` | Ein langes Zufallspasswort. Dieselbe Zeichenkette muss in Supabase in `app_settings` unter dem Schlüssel `jobs_worker_token` stehen. Erzeugen zum Beispiel mit `openssl rand -hex 32`. |
| `DT_INTERNAL_WEBHOOK_SECRET` | Gemeinsames Geheimnis zwischen der App und n8n. n8n weist sich damit aus, wenn es die App aufruft. Ebenfalls ein langes Zufallspasswort. |
| `DT_ONBOARDING_SECRETS_KEY` | Schlüssel, mit dem Zugangsdaten aus dem Onboarding (Hoster, CMS, SMTP) verschlüsselt gespeichert werden. Wenn leer, wird `DT_INTERNAL_WEBHOOK_SECRET` genommen. |

### Damit SEO, Search Console und optional der Chat über n8n laufen

| Name | Was er bedeutet |
|---|---|
| `N8N_BASE_URL` | Adresse der n8n-Instanz. Steht in `.env.example`. |
| `N8N_API_KEY` | Schlüssel, mit dem die Deploy-Skripte Workflows in n8n anlegen oder aktualisieren. |
| `N8N_MCP_ACCESS_TOKEN` | Zugang für die n8n-Anbindung in Cursor. Für den Betrieb der Website nicht nötig. |
| `N8N_DT_CHAT_WEBHOOK` | Adresse, die der Chat aufruft, **wenn** der Umweg über n8n an ist. |
| `N8N_DT_SEO_REPORT_WEBHOOK` | Startet einen SEO-Bericht. |
| `N8N_DT_GSC_PAGES_WEBHOOK` | Holt die Seitenliste aus der Google Search Console. |
| `N8N_DT_GSC_URL_INSPECTION_WEBHOOK` | Prüft, ob eine einzelne URL bei Google indexiert ist. |
| `DT_CHAT_USE_N8N` | Nur wenn der Wert genau `1` ist, läuft der Chat über n8n. Sonst spricht der Chat direkt mit Claude. Für den normalen Betrieb leer lassen. |

### Damit „Texte“ Seitentexte schreibt

**Texte** liegt unter **Verwaltung**, neben SEO Modus (`/dashboard/verwaltung/texte`). Die Organisation wechselt man oben in der Leiste, wie bei SEO Modus und Agenten. Es braucht **keinen eigenen Dienst**. Die acht Schreibschritte laufen in der App selbst, als Hintergrund-Jobs (siehe Abschnitt 10, „Jobs“). Die KI ist Claude, aber über einen **eigenen Schlüssel**, damit die Ausgaben dieses Werkzeugs in der Anthropic Console für sich stehen.

**Vor dem ersten Einsatz** einmal `database/migrations/20261006_dt_content_pipeline.sql` und `database/migrations/20261008_dt_content_pages_source.sql` im Supabase SQL Editor ausführen. Solange die Tabellen oder Spalten fehlen, zeigt die Seite „Die Datenbank ist noch nicht vorbereitet“ bzw. „… noch nicht auf dem neuesten Stand“ mit dem Dateinamen statt einer rohen Fehlermeldung.

**Woher die Seiten kommen.** Die Karte **Seitenquelle** bietet zwei Wege; beide füllen die Tabelle „Seiten“, und erst das Häkchen in der Tabelle entscheidet, welche Seiten Texte bekommen:

- **Excel-Seitenstruktur** – für Kunden ohne (neue) Website. Die Agentur-Vorlage „Seitenstruktur“ (.xlsx, Spalten „Ebene 1 … Ebene 3“ und optional „URL“; alternativ „Seite / Ebene / Pfad“) direkt in Texte hochladen oder unter SEO → Struktur. Es ist dieselbe Ablage (`dt_website_structures`) und derselbe Parser; .csv, .md, .txt, .json, Sitemap-XML und .docx gehen weiterhin. Nach dem Upload erscheinen die Seiten von selbst in der Tabelle, vorhandene Texte bleiben.
- **Crawler – bestehende Website** – für Kunden, die schon eine Website haben und bessere Texte wollen. „Website crawlen“ startet denselben Hintergrund-Crawl wie SEO Modus (Sitemap plus interne Links; braucht die Website-URL unter SEO → Einstellungen). „Seiten übernehmen“ legt für jede gecrawlte Seite eine Zeile an – ohne AGB/Widerruf, ohne Weiterleitungen, höchstens 300. Zeilen, die es schon gibt, behalten ihren Text und bekommen nur die Live-URL. Der bisherige Text der Live-Seite geht als Orientierung in Recherche, Gliederung und Rohtext ein; Fakten gelten trotzdem nur, wenn sie in den Anbieterfakten stehen.

Das frühere Feld „Seiten eintragen“ (Seitenliste tippen) gibt es nicht mehr.

**Branche.** Die Branche beschreibt das Geschäft des Kunden, nicht den Avatar. Der Vorschlag liest alle Anbieterfakten (Gesprächsabschnitte und Fragebogen-Antworten); Kanzlei- und Praxis-Wörter zählen doppelt, allgemeine Handwerks-Wörter einfach. Ist kein Signal da oder stehen zwei Branchen gleichauf, zeigt die Karte „Bitte manuell wählen“ mit der Begründung – Handwerk steht dann nur als Platzhalter im Feld. Die Branche lässt sich vor und nach dem Bestätigen jederzeit ändern („Ändern“).

**Woher die Fakten kommen.** Beides zählt, beides darf fehlen, solange das andere da ist:

- der neueste **abgeschlossene Anbieter-Fragebogen** der Organisation (Fragebögen, Zweck „Anbieter“)
- die **ausgewerteten Gespräche** unter Transkripte (`dt_workshop_corpus.anbieter`)

Anrede, Branche und Tonalität werden daraus vorgefüllt. Was schon in den Gesprächen steht, bleibt; der Fragebogen füllt nur Lücken.

| Name | Was er bedeutet |
|---|---|
| `ANTHROPIC_DT_CONTENT_API_KEY` | Eigener Anthropic-Schlüssel nur für Texte. In der [Anthropic Console](https://console.anthropic.com/settings/keys) einen neuen Schlüssel anlegen und in Vercel unter **Settings → Environment Variables** eintragen (lokal in `.env.local`). Nur der Server kennt ihn; der Browser nie. Nie mit `NEXT_PUBLIC_` beginnen. Texte fällt nicht auf `ANTHROPIC_API_KEY` zurück, sonst liefe die Abrechnung wieder mit dem übrigen Verbrauch zusammen. |
| `ANTHROPIC_DT_CONTENT_MODEL` | Modell für die Schreibschritte 1 Recherche, 2 Gliederung, 3 Rohtext, 5 Tonalität & Avatar, 6 SEO-Feinschliff. Standard: `claude-sonnet-4-6`. |
| `ANTHROPIC_DT_CONTENT_CHECK_MODEL` | Modell für die Prüfschritte 4 Faktencheck, 7 Lektorat, 8 Endabnahme. Leer = wie das Schreibmodell. Hier kann ein günstigeres Modell stehen. |
| `CONTENT_USD_EUR_RATE` | Umrechnungskurs für die Kosten-Spalte (Anthropic rechnet in US-Dollar ab). Standard `0.92`. |

**Was das Werkzeug gekostet hat:** in der Anthropic Console unter Usage den Schlüssel `ANTHROPIC_DT_CONTENT_API_KEY` auswählen. Das ist die Abrechnung von Texte, ohne Chat, Fragebögen und SEO. In der App steht dieselbe Summe geschätzt in der Spalte Kosten und in `dt_content_steps.cost_eur` (USD umgerechnet mit `CONTENT_USD_EUR_RATE`).

**Schlüssel wechseln:** in Vercel den Wert von `ANTHROPIC_DT_CONTENT_API_KEY` ändern und neu deployen (Deployments → ⋯ → Redeploy). Der alte Schlüssel kann danach in der Anthropic Console gelöscht werden. Laufende Seiten machen mit dem nächsten Schritt automatisch mit dem neuen Schlüssel weiter.

**Modell wechseln, Weg 1 (ohne Deploy):** im Supabase SQL Editor einen Wert in `app_settings` setzen. Er gilt ab dem nächsten Schritt, den die Pipeline ausführt — auch für Seiten, die gerade laufen.

```sql
insert into public.app_settings (key, value)
values
  ('content_model', 'claude-sonnet-4-6'),        -- Schreibschritte
  ('content_check_model', 'claude-haiku-4-5')    -- Prüfschritte (Zeile weglassen = wie oben)
on conflict (key) do update set value = excluded.value;

-- zurück zur Umgebungsvariable / zum Standard:
delete from public.app_settings where key in ('content_model', 'content_check_model');
```

**Modell wechseln, Weg 2 (per Deploy):** `ANTHROPIC_DT_CONTENT_MODEL` bzw. `ANTHROPIC_DT_CONTENT_CHECK_MODEL` in Vercel setzen und neu deployen. Reihenfolge, wenn mehrere Stellen gesetzt sind: `app_settings` schlägt die Umgebungsvariable, die Umgebungsvariable schlägt den Standard.

Welches Modell gerade aktiv ist und woher der Wert kommt, zeigt **Texte** unter dem Knopf **Texte erstellen** („Modell: …“). Gibt es den Modellnamen bei Anthropic nicht (Tippfehler, abgekündigt), probiert die Pipeline nacheinander ältere Sonnet-Namen; schlägt auch das fehl, steht der Fehler an der Seite („Fehler in Schritt …“) und kann mit **Weiterlaufen lassen** nach der Korrektur wiederholt werden.

**Was die Statuszeile einer laufenden Seite bedeutet.** Die Tabelle liest nicht nur die Seite, sondern auch ihren Hintergrund-Job:

| Text | Bedeutung |
|---|---|
| „Schritt 3 von 8: Rohtext läuft“ | Ein Worker rechnet gerade an diesem Schritt. |
| „Schritt 4 von 8: Faktencheck startet gleich“ | Der Schritt ist fertig, der nächste wartet auf den nächsten Tick der Jobs-Uhr (alle 30 s). |
| „… erneuter Versuch in ca. 2 Min. (Grund)“ | Anthropic hat abgelehnt (Ratenlimit, überlastet) oder der Worker wurde unterbrochen. Der Job wartet auf seinen nächsten Versuch; drei Versuche je Seite. |
| „Wartet seit 3 Min. auf den Hintergrund-Dienst“ | Der Job ist fällig, aber kein Worker holt ihn ab: `app_settings` (`app_base_url`, `jobs_worker_token`) und `JOBS_WORKER_TOKEN` prüfen. Solange die Seite offen ist, stößt sie den Worker auch selbst an. |
| „Fehler in Schritt 3: …“ (Status In Arbeit) | Der Job ist zu Ende, ohne die Seite abzuschließen: dreimal unterbrochen, Schlüssel abgelehnt, Antwort abgeschnitten. Der Grund steht dabei; **Weiterlaufen lassen** macht an der Stelle weiter. |

**Stoppen und Zurücksetzen.** Jede laufende Seite hat in der Tabelle und im Seitenfenster **Stoppen**: Der Hintergrund-Job wird beendet, die Seite pausiert nach dem letzten fertigen Schritt und läuft mit **Weiterlaufen lassen** dort weiter. **Zurücksetzen** (im Seitenfenster, oder für angehakte Seiten „Auswahl zurücksetzen“ neben dem Startknopf) löscht Text, Schritte, Fragen, Anmerkungen und Kosten der Seite und stellt sie auf „Nicht begonnen“; Name, Pfad und Quelle bleiben. **Löschen** (im Seitenfenster, oder „Auswahl löschen“) entfernt die Zeile ganz – zum Ausmisten einer Tabelle, etwa gecrawlte Seiten, die keine Texte brauchen; Seiten aus der Seitenstruktur kommen beim nächsten Upload wieder, Crawl-Seiten beim nächsten „Übernehmen“. Ein Schritt, der in dem Moment noch bei der KI rechnet, wird zu Ende gerechnet, aber nicht mehr gespeichert.

Eine Seite bleibt also nicht mehr auf „läuft“ stehen, wenn ihr Job gestorben ist: Jedes Laden der Tabelle gleicht Seiten in „läuft“ mit der Tabelle `jobs` ab und pausiert sie mit Grund, wenn der Job fertig, tot oder verschwunden ist. Ein Schritt, der beim Aufwachen noch auf „läuft“ steht, zählt als abgebrochener Versuch (sonst liefe derselbe Schritt alle sechs Minuten neu, endlos). Der Worker hat pro Aufruf 240 Sekunden und `/api/jobs/run` 300 Sekunden (`maxDuration`); braucht ein Rohtext länger, als Vercel erlaubt, steht nach drei Abbrüchen „Vermutlich erreicht der Server sein Zeitlimit“ an der Seite – dann ein schnelleres Modell wählen oder die Function-Dauer des Vercel-Plans prüfen.

Jeder Schritt schreibt Modell, Tokens und Kosten in `dt_content_steps` und einen Eintrag in `dt_llm_usage_events` (`mode = content.<Schritt>`), damit die Kosten pro Firma auswertbar bleiben.

### Nur für Skripte, nicht für den laufenden Betrieb

| Name | Was er bedeutet |
|---|---|
| `SUPABASE_PROJECT_ID` | Kurze Projekt-Kennung von Supabase. Für `npm run types:generate` und das Magic-Link-Limit. |
| `SUPABASE_ACCESS_TOKEN` | Persönlicher Token aus dem Supabase-Konto (Account → Access Tokens). |
| `OLD_SUPABASE_URL` | Altes Supabase-Projekt. Nur für den einmaligen Umzug. |
| `OLD_SUPABASE_SERVICE_ROLE_KEY` | Geheimer Schlüssel des alten Projekts. Nach dem Umzug löschen. |
| `DT_MIGRATION_INVITED_BY_USER_ID` | Nutzer-ID des Admins, der beim Umzug als Einladender gilt. |

Prüfen, ob die beiden öffentlichen Supabase-Werte ankommen:

```bash
npm run env:check:next
```

`npm run env:check` liest `.env.local` nicht. Dafür ist `env:check:next` da.

---

## 7. Die Datenbank einrichten

Die Datenbank ist der Speicher. Tabellen sind Listen (Firmen, Nutzer, Chats, …). Eine **Migration** ist eine einzelne Änderungsdatei. Sie muss in der richtigen Reihenfolge laufen, sonst fehlen Spalten.

### Reihenfolge

1. In Supabase den **SQL Editor** öffnen.
2. Den kompletten Inhalt von `database/schema.sql` einfügen und ausführen.  
   Das legt den Sockel an: Profile, Firmen, Mitglieder, Einladungen, Fragebögen und Antworten.
3. Danach **jede Datei** in `database/migrations/` ausführen, sortiert nach dem Datum am Anfang des Dateinamens, die älteste zuerst. Es sind 81 Dateien. Eine neuere Datei setzt voraus, dass die älteren schon liefen.
4. In Supabase unter **Database → Extensions** prüfen, dass `pg_cron` und `pg_net` an sind. Die Job-Migration schaltet sie ein. `pg_cron` ist die Uhr, `pg_net` ist der Anruf von der Datenbank zur Website.
5. Prüfen, dass bei den Tabellen **RLS** aktiv ist (Row Level Security).

`database/schema.sql` allein reicht nicht. Chat, SEO, Onboarding, Jobs und Leadinfo entstehen erst durch die Migrationen.

Die Datei `database/README.md` beschreibt nur noch den Verweis hierher. Sie ist kein zweites Handbuch.

### Diese zwei Werte muss die Datenbank kennen

Nachdem die App im Internet erreichbar ist, im SQL Editor ausführen und die Platzhalter ersetzen:

```sql
insert into public.app_settings (key, value)
values
  ('app_base_url', 'https://www.digital-twin-sbkm.de'),
  ('jobs_worker_token', 'HIER-DENSELBEN-WERT-WIE-JOBS_WORKER_TOKEN')
on conflict (key) do update
set value = excluded.value;
```

`app_base_url` ist die Adresse ohne Schrägstrich am Ende. `jobs_worker_token` ist **exakt** derselbe Text wie `JOBS_WORKER_TOKEN` in Vercel. Fehlt einer der beiden Werte, tut die Uhr in der Datenbank absichtlich nichts.

Die Uhr heißt `jobs_runner_tick_30s` und läuft alle 30 Sekunden. Sie ruft `POST /api/jobs/run` auf. Dieser Aufruf darf bis zu zwei Minuten dauern, weil Website-Prüfungen länger brauchen.

### Datei-Speicher

Die Migrationen legen private Ablage-Eimer an, **Buckets** genannt:

- `dt-chat-attachments` für Dateien im DigitalTwin-Chat
- `ai-chat-attachments` für Dateien im Fragebogen-Assistenten

Ohne diese Buckets scheitert der Upload.

### TypeScript-Typen neu erzeugen

Nur nötig, wenn sich das Datenbank-Schema geändert hat und der Quelltext die neuen Spalten kennen soll:

```bash
npm run types:generate
```

Dafür müssen `SUPABASE_PROJECT_ID` und `SUPABASE_ACCESS_TOKEN` gesetzt sein. Das Ergebnis landet in `lib/types/supabase.ts`.

---

## 8. Anmeldung

Es gibt kein dauerhaftes Passwort als Hauptweg. Die Person gibt ihre E-Mail-Adresse ein und bekommt einen **Magic Link**. Ein Klick darauf öffnet `/auth/confirm`. Die App tauscht den Link gegen eine Sitzung und schickt die Person weiter, normalerweise ins Dashboard.

### Diese Adressen müssen in Supabase erlaubt sein

In Supabase: **Authentication → URL Configuration**.

- **Site URL:** die echte Website, zum Beispiel `https://www.digital-twin-sbkm.de`
- **Redirect URLs**, jede Umgebung einzeln:
  - `http://localhost:3000/auth/confirm`
  - `https://www.digital-twin-sbkm.de/auth/confirm`
  - die Vercel-Vorschau-Adressen, wenn man dort testet

Fehlt die Adresse, kommt die Mail an, der Klick endet aber in einem Fehler.

Seiten, die ohne Anmeldung erreichbar sind:

- `/` die Startseite
- `/auth/login`, `/auth/sign-up`, `/auth/confirm`, `/auth/error`
- `/s/…` ein öffentlicher Fragebogen
- `/onboarding/upload/…` der Upload-Link für Kunden
- `/api/…` die internen Schnittstellen prüfen sich selbst

Alles andere, vor allem `/dashboard` und `/settings`, leitet auf die Anmeldung um.

### Magic-Link-Limit

Supabase begrenzt, wie oft eine Adresse einen Link anfordern darf. Wenn das Team das Limit anpassen will:

```bash
npm run auth:set-magic-link-rate-limit
```

Auch dafür braucht es `SUPABASE_ACCESS_TOKEN` und die Projekt-ID.

---

## 9. Was man in der Oberfläche sieht

### Öffentliche Seiten

| Adresse | Wer sie sieht | Was dort passiert |
|---|---|---|
| `/` | Gäste | Marketing-Seite. |
| `/` | Eingeloggte mit Firma | Der DigitalTwin-Chat. Der Knopf **Zum Chat** führt hierher. |
| `/auth/login` | Alle | Anmeldung per Magic Link. |
| `/s/[slug]` | Alle mit dem Link | Öffentlicher Fragebogen. `slug` ist der kurze Name in der URL. |
| `/onboarding/upload/[token]` | Alle mit dem geheimen Link | Kunde lädt Dateien hoch, ohne Dashboard-Konto. |

### Menü im Dashboard (`/dashboard`)

Nach dem Login landet man auf `/dashboard/organisations`.

**Für Mitglieder einer Firma**

| Menüpunkt | Wozu |
|---|---|
| Posteingang | Einladung in eine Firma annehmen. |
| Onboarding | Unterlagen und Zugänge einer Firma einsammeln. |
| Ansprechpartner | Kontakte der Firma. |
| Organisation | Firma, Mitglieder, Einladungen. |
| Fragebögen | Fragebögen dieser Firma. Sichtbar, sobald die Person irgendeiner Firma angehört. |

**Für Inhaber und Firmen-Admins zusätzlich**

| Menüpunkt | Wozu |
|---|---|
| Agenten | KI-Figuren der Firma ansehen und Änderungen beantragen. Direkt ändern darf nur ein Plattform-Admin. |

**Nur für Plattform-Admins**

| Menüpunkt | Wozu |
|---|---|
| Leads | Firmen aus Leadinfo. Kunden sehen das nicht. |
| Integrationen | Anbindungen, vor allem Leadinfo. |
| Agent-Kontext | Zeigt den zusammengebauten Auftrag an die KI. Intern, weil dort der ganze Prompt steht. |
| SEO Modus | Crawl, Berichte, Aufgaben, Search Console, Grounding, Seitenstruktur. |
| Texte | Seitentexte in acht Schritten schreiben lassen, prüfen und freigeben. Organisation oben in der Leiste wechseln. |
| Token-Nutzung | Wie viel die KI verbraucht hat. Kunden sehen das nicht. |
| Transkripte | Gesprächsmitschriften auswerten und ins Wissen der Avatare übernehmen. |
| Erstgespräch | Erstgespräche einer Firma. |
| Agent-Anfragen | Änderungwünsche von Firmeninhabern freigeben oder ablehnen. |
| Plattform-Übersicht | Alle Firmen anlegen, archivieren, DigitalTwin ein- oder ausschalten. |
| Plattform-Team | Weitere Plattform-Admins ernennen. |
| Jobs | Hintergrund-Aufgaben und ihre Fehler. |
| E-Mails | Protokoll, welche Mail rausging. |
| Alle Umfragen | Fragebögen über alle Firmen, inklusive offener Rückfragen. |

Inhaber einer Firma dürfen fertige SEO-Berichte lesen. Den SEO-Arbeitsplatz selbst bedienen nur Plattform-Admins.

### Weitere feste Adressen

| Adresse | Wozu |
|---|---|
| `/settings` | Persönliche Einstellungen. |
| `/dashboard/surveys/new` | Neue Umfrage. |
| `/dashboard/surveys/[id]/edit` | Entwurf bearbeiten. |
| `/dashboard/surveys/[id]/responses` | Antworten. |
| `/dashboard/surveys/[id]/responses/[id]` | Eine Antwort, inklusive Weg zum Avatar. |
| `/dashboard/frageboegen` | Dieselbe Welt aus Sicht der Firma. |
| `/dashboard/digital-twin` | Chat- und Agenten-Bereich, zusätzlich zur Startseite. |
| `/dashboard/verwaltung/seo` | SEO-Arbeitsplatz der Agentur. |
| `/dashboard/verwaltung/texte` | Texte: Seitentexte in acht Schritten schreiben lassen, prüfen und freigeben. Nur Plattform-Admins, Organisation über `?org=`. |
| `/dashboard/admin/jobs` | Job-Liste. |

---

## 10. Was im Hintergrund passiert

### Chat

Der normale Chat spricht **direkt mit Claude**. Die Unterhaltung, die Dateien und die gewählte KI-Figur liegen in Supabase.

Nur wenn `DT_CHAT_USE_N8N` genau `1` ist, geht die Antwort über den n8n-Webhook `N8N_DT_CHAT_WEBHOOK`.

Anhänge liegen im Bucket `dt-chat-attachments`.

### Vom Fragebogen zum Avatar

Ein ausgefüllter Fragebogen kann einen Avatar erzeugen. Das läuft über Claude, bei langen Texten als Auftrag im Hintergrund (Anthropic Message Batches), damit das Zeitlimit von Vercel nicht abreißt. Der Assistent, der Fragebögen vorschlägt und ändert, liegt unter `app/api/ai/`.

### SEO

1. Jemand startet im SEO-Modus einen Bericht oder einen Crawl.
2. Die App ruft n8n auf (`N8N_DT_SEO_REPORT_WEBHOOK` oder die Search-Console-Webhooks).
3. n8n ruft die App wieder auf und weist sich mit `DT_INTERNAL_WEBHOOK_SECRET` aus.
4. Lange Website-Prüfungen laufen als Job `seo.crawl`. Die Datenbank-Uhr stößt `/api/jobs/run` an.
5. Fertige Berichte kann der Firmeninhaber lesen. Die Bearbeitung bleibt bei der Agentur.

### Leadinfo

Leadinfo schickt Besucher-Ereignisse an  
`/api/integrations/leadinfo/webhook/[token]`  
Der Token in der URL ist das Geheimnis dieser Firma. Die App speichert das Ereignis und arbeitet es über den Job `leadinfo.normalize` auf. Die Auswertung sehen nur Plattform-Admins unter **Leads**.

### E-Mails

Alle Mails gehen über SMTP (`lib/email/mailer.ts`). Versandversuche stehen in der Tabelle `email_send_logs` und in der Oberfläche unter **E-Mails**.

| Anlass | Wer sie bekommt |
|---|---|
| Fragebogen abgeschlossen | die Liste `SURVEY_NOTIFICATIONS_TO` |
| Jemand stellt eine Rückfrage an einem Feld | dieselbe Liste |
| Einladung in eine Firma | die eingeladene Adresse |
| Willkommen für einen neuen Firmeninhaber | der Inhaber |
| Willkommen im Portal / Magic Link für das Team | die betreffende Person |
| SEO-Hinweis | Firmeninhaber, plus optional `DT_SEO_ALERT_EMAIL` |

### Jobs

Es gibt drei Job-Arten:

| Art | Was sie tut |
|---|---|
| `seo.crawl` | Arbeitet die Warteschlange der Website-Prüfung ab. |
| `leadinfo.normalize` | Macht aus einem rohen Leadinfo-Ereignis einen lesbaren Eintrag. |
| `content.page` | Schreibt den Text einer Seite unter **Verwaltung → Texte**: so viele Schritte, wie in einen Aufruf passen (1 Recherche, 2 Gliederung, 3 Rohtext, 4 Faktencheck, 5 Tonalität & Avatar, 6 SEO-Feinschliff, 7 Lektorat, 8 Endabnahme), dann stellt er sich für den Rest wieder an. Er hält an, wenn der Faktencheck Fragen an den Kunden hat („Braucht Sie“) und nach der Endabnahme bis zur Freigabe. Jeder Fehler – auch ein unterbrochener Worker – zählt als Versuch; nach drei Versuchen pausiert die Seite mit Grund. Ergebnisse liegen in `dt_content_pages` und `dt_content_steps`. Fakten kommen aus dem Anbieter-Fragebogen und aus den ausgewerteten Gesprächen. |

Ein Job, der zu oft scheitert, bleibt als fehlgeschlagen liegen und ist unter **Jobs** sichtbar.

---

## 11. Ins Internet stellen

### Einmalig in Vercel

1. Mit `mail@sichtbarkeitsmeister.de` bei Vercel anmelden.
2. Das Repository `sichtbarkeitsmeister/digital-twin` importieren.
3. Framework **Next.js** lassen, wie Vercel es erkennt.
4. Install: `npm install` (oder `npm ci`, das nimmt exakt die Versionen aus `package-lock.json`).
5. Build: `npm run build`
6. Alle Variablen aus Abschnitt 6 eintragen, die der Betrieb braucht. Preview und Production dürfen unterschiedliche Supabase-Projekte haben. `APP_BASE_URL` muss immer die Adresse **dieser** Umgebung sein.
7. Die Produktions-Domain eintragen und `APP_BASE_URL` auf genau diese Domain setzen.
8. In Supabase die Redirect-URL dieser Domain erlauben (Abschnitt 8).
9. In Supabase `app_settings` setzen (Abschnitt 7).
10. In n8n dieselben Geheimnisse eintragen: `APP_BASE_URL` und `DT_INTERNAL_WEBHOOK_SECRET`.

### Danach bei jeder Änderung

- Push auf einen Branch erzeugt eine Vorschau-Website.
- Merge nach `main` erzeugt die Produktions-Website, sofern Vercel so eingestellt ist.

Die Vorschau-Adresse ist öffentlich erreichbar, aber n8n kennt sie nur, wenn `APP_BASE_URL` der Preview auf diese Adresse zeigt. Die Produktions-Automationen sollen auf die Produktions-Domain zeigen.

### n8n-Workflows aus dem Repository aktualisieren

Diese Befehle legen oder ändern die Automationen in n8n. Dafür müssen `N8N_BASE_URL`, `N8N_API_KEY`, `APP_BASE_URL` und `DT_INTERNAL_WEBHOOK_SECRET` gesetzt sein.

| Befehl | Was er aktualisiert |
|---|---|
| `npm run dt:n8n:chat` | Chat-Workflow |
| `npm run dt:n8n:seo-report` | SEO-Bericht aus der Vorlage kopieren |
| `npm run dt:n8n:seo-report-patch` | SEO-Bericht nachpatchen |
| `npm run dt:n8n:seo-report-scheduler` | Zeitplan für SEO-Berichte |
| `npm run dt:n8n:monthly-collect` | Monatliche Zahlen einsammeln |
| `npm run dt:n8n:monthly-scheduler` | Zeitplan dafür |
| `npm run dt:n8n:gsc-pages` | Seiten aus der Search Console |
| `npm run dt:n8n:gsc-url-inspection` | Index-Prüfung einer URL |

### Einmaliger Umzug aus dem alten Supabase

Nur solange die alten Schlüssel noch gesetzt sind:

```bash
npm run dt:migrate:dry-run
npm run dt:migrate:apply
```

Zuerst immer den Probelauf. Danach `OLD_SUPABASE_SERVICE_ROLE_KEY` entfernen.

---

## 12. Wenn etwas nicht geht

| Was man sieht | Was man zuerst prüft |
|---|---|
| Startseite bleibt Marketing, obwohl man eingeloggt ist | Die beiden `NEXT_PUBLIC_SUPABASE_…` Werte. Danach Dev-Server neu starten. Außerdem muss die Person Mitglied einer Firma sein. |
| Magic Link kommt an, Login scheitert | In Supabase die Redirect-URL `/auth/confirm` für genau diese Adresse (localhost oder echte Domain). |
| „Zu viele Anmeldeversuche“ | Magic-Link-Limit in Supabase, siehe Abschnitt 8. |
| Seite lädt, KI antwortet nicht | `ANTHROPIC_API_KEY`. In Vercel die Function-Logs öffnen. |
| Einladung oder Hinweis-Mail kommt nicht | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. Bei Fragebogen-Hinweisen auch `SURVEY_NOTIFICATIONS_TO`. Danach das Protokoll unter **E-Mails**. |
| SEO-Bericht startet nicht | `N8N_DT_SEO_REPORT_WEBHOOK`, `APP_BASE_URL` (muss aus dem Internet erreichbar sein), `DT_INTERNAL_WEBHOOK_SECRET` ist in Vercel und in n8n gleich. |
| Crawl bleibt stehen | In Supabase `app_settings`: `app_base_url` und `jobs_worker_token`. Der Token muss `JOBS_WORKER_TOKEN` gleichen. Extensions `pg_cron` und `pg_net` müssen an sein. Danach die Seite **Jobs**. |
| Texte-Seite steht auf „Wartet … auf den Hintergrund-Dienst“ | Gleiche Ursache wie beim Crawl: `app_settings` und `JOBS_WORKER_TOKEN`. Steht dort „erneuter Versuch“ oder „Fehler in Schritt“, steht der Grund daneben (`ANTHROPIC_DT_CONTENT_API_KEY`, Ratenlimit, Zeitlimit). |
| Jemand sieht eine Firma oder einen Bericht nicht | Plattform-Rolle und Firmen-Rolle (Abschnitt 3). SEO-Modus ist nur für Plattform-Admins. Berichte auch für den Inhaber. |
| Upload scheitert | Die Buckets `dt-chat-attachments` und `ai-chat-attachments` existieren nur, wenn die Migrationen liefen. |
| Änderung an der Datenbank ist im Code unbekannt | `npm run types:generate` und die neue Datei mit committen. |
| Build auf Vercel scheitert | Logs unter Project → Deployments. Meist fehlt eine Umgebungsvariable oder `npm run build` schlägt schon lokal fehl. |

Logs im Betrieb: Vercel → Project → Deployments → die betroffene Auslieferung → Logs.

---

## 13. Wo im Projekt liegt was?

Für Leute, die etwas ändern. Die Ordner sind die Zimmer der App.

### Der Einstieg

| Datei oder Ordner | Einfach gesagt |
|---|---|
| `package.json` | Liste der Bausteine und der Befehle (`npm run …`). |
| `package-lock.json` | Feste Versionen, damit jede Person dieselben Bausteine bekommt. |
| `tsconfig.json` | TypeScript-Einstellungen. `@/…` bedeutet „ab dem Projektordner“. |
| `next.config.ts` | Einstellungen von Next.js, zum Beispiel Bilder. |
| `tailwind.config.ts`, `postcss.config.mjs` | Aussehen, Abstände, Farben. |
| `proxy.ts` | Türsteher für jede Anfrage. Schickt Unangemeldete zum Login und frischt die Sitzung auf. Die eigentliche Logik liegt in `lib/supabase/proxy.ts`. |
| `.env.example` | Vorlage ohne echte Geheimnisse. SMTP fehlt dort und muss ergänzt werden. |
| `.env.local` | Die echten lokalen Geheimnisse. Nicht committen. |
| `start.js` | Alternativer Produktionsstart. Vercel benutzt `npm run build` und den normalen Next-Start. |

### Seiten, die man im Browser sieht (`app/`)

| Ort | Einfach gesagt |
|---|---|
| `app/(marketing)/page.tsx` | Die Startseite. Je nach Login Marketing oder Chat. Eine Datei `app/page.tsx` gibt es nicht. |
| `app/layout.tsx` | Der Rahmen um alle Seiten: Schriften, Kopf, Fuß. |
| `app/auth/` | Login, Registrierung, Fehlerseite, Magic-Link-Bestätigung. |
| `app/settings/page.tsx` | Einstellungen der angemeldeten Person. |
| `app/dashboard/` | Alles hinter dem Login. Das Menü steht in `app/dashboard/_components/dashboard-sidebar.tsx`. |
| `app/s/[slug]/` | Öffentlicher Fragebogen. |
| `app/onboarding/upload/[token]/` | Öffentlicher Upload-Link. |
| `app/api/` | Adressen, die kein Mensch als Seite sieht. Die App und n8n rufen sie auf. |

### Die wichtigen inneren Adressen (`app/api/`)

Man muss sie nicht auswendig lernen. Sie sind nach Thema sortiert.

| Ordner | Thema |
|---|---|
| `app/api/dt/chats/` | DigitalTwin-Chat: lesen, schreiben, teilen, löschen. |
| `app/api/dt/agents/` | KI-Figuren anlegen, ändern, prüfen. |
| `app/api/dt/seo/` | SEO-Arbeitsplatz. |
| `app/api/dt/internal/` | Nur für n8n. Verlangt `DT_INTERNAL_WEBHOOK_SECRET`. |
| `app/api/dt/onboarding/` | Onboarding-Dateien. |
| `app/api/dt/transcripts/` und `app/api/dt/workshop/` | Mitschriften und Workshop. |
| `app/api/ai/` | Fragebogen-Assistent. |
| `app/api/surveys/` | Aus einer Antwort einen Avatar machen, nachschärfen, auf SEO anwenden. |
| `app/api/notifications/` | Die zwei Fragebogen-Mails. |
| `app/api/jobs/run` | Nimmt den Anruf der Datenbank-Uhr entgegen. |
| `app/api/integrations/leadinfo/` | Empfängt Leadinfo. |

### Die Logik dahinter (`lib/`)

| Ordner | Einfach gesagt |
|---|---|
| `lib/supabase/` | Verbindung zur Datenbank: Browser, Server, Service-Role, Türsteher. |
| `lib/dt/` | DigitalTwin: Chat, Avatare, Prompts, Onboarding, SEO, Transkripte. |
| `lib/dt/seo/` | SEO-Berichte, Crawl, Search Console, Aufgaben. |
| `lib/dt/onboarding/` | Onboarding inklusive Verschlüsselung der Zugangsdaten. |
| `lib/ai/` | Fragebogen-Assistent und Claude-Helfer. |
| `lib/surveys/` | Fragebogen-Regeln, Typen, Speichern. |
| `lib/email/` | SMTP, Vorlagen, Einladung, Willkommen, Versand-Protokoll. |
| `lib/jobs/` | Die zwei Hintergrund-Jobs und die Warteschlange. |
| `lib/dashboard/` | Firmen-Übersicht und Plattform-Admin. |
| `lib/types/supabase.ts` | Aus der Datenbank erzeugte Typen. Nicht von Hand pflegen. |
| `lib/app-url.ts` | Baut aus `APP_BASE_URL` die Links in Mails. |

### Das Aussehen (`components/`)

| Ordner | Einfach gesagt |
|---|---|
| `components/dt/` | DigitalTwin-Oberfläche: Chat, SEO, Agenten, Kopfzeile. |
| `components/surveys/` | Fragebogen-Oberfläche und Assistent. |
| `components/ui/` | Kleine Bausteine: Knopf, Feld, Karte, Dialog. |
| `components/login-form.tsx`, `sign-up-form.tsx` | Die Formulare für die Anmeldung. |

Einen Ordner `app/_components/` an der Wurzel von `app/` gibt es nicht. Dashboard-Bausteine liegen in `app/dashboard/_components/`.

### Datenbank und Skripte

| Ort | Einfach gesagt |
|---|---|
| `database/schema.sql` | Der Sockel. Zuerst ausführen. |
| `database/migrations/` | Alle späteren Änderungen, nach Datum sortiert. |
| `scripts/generate-types.ts` | Erzeugt `lib/types/supabase.ts`. |
| `scripts/dt-migrate-from-old-supabase.mjs` | Der einmalige Umzug. |
| `scripts/deploy-dt-*.mjs` | Die n8n-Befehle aus Abschnitt 11. |
| `scripts/test-*.ts` | Automatische Prüfungen für Entwickler. Zum Starten der App nicht nötig. |

### Typische Aufgabe und der erste Ort

| Aufgabe | Zuerst hier schauen |
|---|---|
| Login geht nicht | `proxy.ts`, `lib/supabase/proxy.ts`, `app/auth/` |
| Menüpunkt fehlt | `app/dashboard/_components/dashboard-sidebar.tsx` und `lib/dt/org-access.ts` |
| Chat-Antwort ist falsch | `lib/dt/prompts/`, `lib/dt/anthropic-chat.ts` |
| Avatar aus Fragebogen | `lib/dt/survey-to-agent-prompt.ts`, `app/api/surveys/…/create-agent` |
| Mail-Text ändern | `lib/email/templates.ts` und `lib/email/templates/` |
| Mail geht nicht raus | `lib/email/mailer.ts` |
| Recht fehlt oder ist zu weit | `database/migrations/` (die neueste passende Datei) und die RPCs |
| SEO-Bericht | `lib/dt/seo/`, `app/api/dt/seo/`, `app/api/dt/internal/` |
| Job hängt | `lib/jobs/`, `app/api/jobs/run/route.ts`, `app_settings` in Supabase |
| Neue innere Adresse | neuer Ordner `app/api/…/route.ts` |

---

## 14. Befehle, die man wirklich braucht

| Befehl | Wann |
|---|---|
| `npm install` | Einmal nach dem Klonen, und wenn sich Bausteine geändert haben. |
| `npm run dev` | App lokal starten. Adresse: `http://localhost:3000`. |
| `npm run build` | So bauen, wie Vercel es tut. Vor einem Release lokal ausführen, wenn man sicher sein will. |
| `npm run start` | Die gebaute Version lokal starten. Vorher `npm run build`. |
| `npm run lint` | Prüft den Stil und offensichtliche Fehler. |
| `npm run env:check:next` | Zeigt, ob die Supabase-URL und der Anfang des öffentlichen Schlüssels ankommen. |
| `npm run types:generate` | Datenbank-Typen neu schreiben. |
| `npm run auth:set-magic-link-rate-limit` | Anmelde-Limit in Supabase setzen. |
| `npm run dt:migrate:dry-run` | Umzug nur anzeigen. |
| `npm run dt:migrate:apply` | Umzug wirklich schreiben. |
| `npm run dt:n8n:…` | n8n-Workflows aktualisieren. Siehe Abschnitt 11. |
| `npm run test:…` | Einzelne Entwickler-Prüfungen. Stehen alle in `package.json` unter `scripts`. |

---

## 15. Vorschlag für Confluence

Eine Seite wird zu lang. Besser so aufteilen:

1. **Was ist DigitalTwin?** Abschnitte 1 bis 3.
2. **Zugänge.** Abschnitt 4.
3. **Lokal starten und Einstellungen.** Abschnitte 5 und 6.
4. **Datenbank und Anmeldung.** Abschnitte 7 und 8.
5. **Oberfläche.** Abschnitt 9.
6. **Hintergrund: KI, n8n, Jobs, Mails.** Abschnitt 10.
7. **Veröffentlichen.** Abschnitt 11.
8. **Wenn etwas nicht geht.** Abschnitt 12.
9. **Wo liegt der Code?** Abschnitte 13 und 14.

Geheimnisse (Schlüssel, Passwörter, Tokens) gehören nicht in Confluence im Klartext. Dort nur die Namen der Variablen und wer den Wert herausgeben darf.
