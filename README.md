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
| `ANTHROPIC_DT_GROUNDING_MODEL` | Modell für Grounding: den Website-Abgleich („Website prüfen“) und den Grounding-Agenten. Leer: Der Website-Abgleich nimmt `ANTHROPIC_DT_SEO_MODEL`, der Grounding-Agent die Modelle von Texte. |
| `ANTHROPIC_DT_GROUNDING_API_KEY` | Eigener Claude-Schlüssel für Grounding, damit die Kosten in der Anthropic Console für sich stehen. Leer: `ANTHROPIC_DT_CONTENT_API_KEY`, sonst `ANTHROPIC_API_KEY`. |
| `ANTHROPIC_SURVEY_CHAT_MODEL` | Modell für die DigitalTwin-Hilfe im Gespräch (früher Fragebogen-Assistent). |
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

**Texte** liegt unter **Verwaltung**, neben SEO Modus (`/dashboard/verwaltung/texte`). Die Organisation wechselt man oben in der Leiste, wie bei SEO Modus und Agenten. Es braucht **keinen eigenen Dienst**. Die zehn Schritte laufen in der App selbst, als Hintergrund-Jobs (siehe Abschnitt 10, „Jobs“). Die KI ist Claude, aber über einen **eigenen Schlüssel**, damit die Ausgaben dieses Werkzeugs in der Anthropic Console für sich stehen.

**Vor dem ersten Einsatz** einmal `database/migrations/20261006_dt_content_pipeline.sql`, `database/migrations/20261008_dt_content_pages_source.sql`, `database/migrations/20261009_dt_content_excel_briefing.sql`, `database/migrations/20261010_dt_content_type_prompts.sql`, `database/migrations/20261011_dt_content_nine_steps.sql`, `database/migrations/20261013_dt_content_branche_text.sql`, `database/migrations/20261015_dt_content_startseite_ueber_uns.sql` , `database/migrations/20261017_dt_content_step_prompts_verbesserung.sql`, `database/migrations/20261027_dt_content_aktualitaet.sql` und `database/migrations/20261028_dt_content_skip_steps.sql` im Supabase SQL Editor ausführen (in dieser Reihenfolge; 20261011 erlaubt Schritt 9, 20261013 macht die Branche zum freien Textfeld, 20261015 ergänzt Startseite und Über-uns-Seite, 20261017 speichert die Schritt-Prompts aus Globale Prompts und das Briefing einer Seitenstruktur für „Verbesserung“, 20261027 fügt die Aktualitätsprüfung als Schritt 5 ein, 20261028 speichert die je Seite abgeschalteten Schritte). **20261027 und 20261028 müssen vor dem Deploy des Codes laufen**, und solange keine Seite „Läuft“ (sonst bricht die Migration mit Hinweis ab): Sie verschiebt gespeicherte Schritte 5 … 9 auf 6 … 10, damit keine Seite zurückgesetzt werden muss. Solange die Tabellen oder Spalten fehlen, zeigt die Seite „Die Datenbank ist noch nicht vorbereitet“ bzw. „… noch nicht auf dem neuesten Stand“ mit dem Dateinamen statt einer rohen Fehlermeldung.

**Die zehn Schritte** (einer je Hintergrund-Job): 1 Analyse (Suchintention, Keywords, Fragen, Hormozi-Bausteine, Faktenlage – schreibt noch nicht), 2 SEO (schreibt die ganze Seite), 3 Faktencheck (stellt Fragen, die nur der Kunde beantworten kann), 4 GEO (für KI-Zitate: Kernantwort vorn, jeder Abschnitt für sich verständlich, „Zuletzt aktualisiert: [DATUM]“), 5 Aktualitätsprüfung (prüft zeitkritische Aussagen mit der Websuche, siehe unten), 6 Hormozi (Hero-Satz, Value Equation, Handlungsaufforderungen – nur mit belegten Beweisen), 7 Vermenschlichung (nur Formulierung: kurze Sätze, keine Floskeln, bewertet sich selbst und versucht es bei schwacher Note einmal erneut), 8 Lektorat, 9 Watermark Entfernung (läuft als einziger Schritt auf Grok von xAI, mit eigenem Schlüssel `XAI_API_KEY`: formuliert jeden Satz neu; Überschriften, Abschnitts-ids, Fakten, Zahlen, Marker und Handlungsaufforderungen bleiben, dafür sorgt die App nach der Antwort. Der Schritt arbeitet in kleinen Gruppen von Abschnitten, je ein kurzer Grok-Aufruf, und speichert nach jeder Gruppe seinen Stand: Geht einem Durchlauf die Zeit aus, macht der nächste Tick dort weiter, die Statuszeile zeigt „… läuft (4 von 11 Abschnitten)“), 10 Endabnahme (hält für die Freigabe an, schreibt nichts). Jeder Schritt bekommt Anbieterfakten, Einstellungen, Avatar, Anmerkungen und das Briefing der Seite mit. Der SEO-Schritt lässt unter der H1 den Platzhalter „[HERO – wird von Hormozi gefuellt]“ stehen; Hormozi füllt ihn. Ältere Seiten tragen noch „[HERO – wird in Schritt 5 gefuellt]“; beide Schreibweisen werden überall erkannt. Interne Links stehen als Marker `[LINK: Seitenname]` im Text, fehlende Zahlen als `[BITTE PRÜFEN: …]`.

**Fehlende Angaben halten die Seite an („Braucht Sie“).** Nach dem Faktencheck, nach jedem Schritt, der Text schreibt (SEO, GEO, Aktualitätsprüfung, Hormozi, Vermenschlichung, Lektorat), und in der Endabnahme prüft der Code den gespeicherten Text (`lib/dt/content/pipeline/gaps.ts`, `step-patch.ts`). Eine Lücke ist ein Platzhalter `[BITTE PRÜFEN: …]`, `[QUELLE BITTE ERGÄNZEN]` oder `[PREIS BITTE PRÜFEN UND ANPASSEN…]`, außerdem jede Frage des Faktenchecks (auch eine, die er als nicht blockierend markiert) und jede Frage der Aktualitätsprüfung an den Kunden. `[LINK: …]`, `[DATUM]` und der Hero-Platzhalter sind keine Lücken. Gibt es eine, bleibt die Seite stehen: Die Tabelle nennt den Abschnitt („Abschnitt „Kosten“ braucht eine Angabe“ bzw. „3 Abschnitte brauchen eine Angabe: Kosten, Ablauf, Garantie +N weitere“), das Seitenfenster zeigt unter „Fragen an den Kunden“ Abschnitt, Frage und Satz und markiert den Abschnitt im Text. Die Endabnahme setzt „Fertig“ erst ohne Lücke. **Abschnitt ändern** füllt die Angabe und erledigt Fragen und offene Punkte dieses Abschnitts; **Freigeben** fragt nach, solange noch Fragen oder offene Punkte da sind, und lässt die Seite dann weiterlaufen (nach der Endabnahme: freigeben). Freigeben füllt nichts aus und entfernt keinen Platzhalter, ein verbliebener Platzhalter hält die Seite nach dem nächsten Schritt wieder an.

**Schritte je Seite abschalten.** Im Seitenfenster steht unter dem Seitentyp der Block **Schritte**: ein Schalter je Schritt, jede Änderung wird sofort gespeichert (nicht, solange die Seite läuft). Ein abgeschalteter Schritt wird „Übersprungen“, wenn der Lauf ihn erreicht: kein KI-Aufruf, 0 €, der Text geht unverändert an den nächsten Schritt. Analyse und Endabnahme laufen immer. **SEO** lässt sich nur bei Seiten von der Website (Crawl mit Live-URL) abschalten: Dann wird der aktuelle Live-Text übernommen (live geladen mit Überschriften, sonst der gespeicherte Crawl-Text), mit leerem Hero unter der H1, wenn Hormozi läuft; ohne brauchbaren Text hält die Seite mit Fehler an. Ist **Hormozi** aus, verschwindet der leere Hero-Platzhalter. Ist **GEO** aus, schickt die Aktualitätsprüfung nicht zurück, veraltete Abschnitte werden gleich offene Punkte, und die Befunde des Faktenchecks bleiben offen. Gespeichert wird die Liste in `dt_content_pages.skip_steps` (Schlüssel wie `seo`, `geo`, nicht Schrittnummern); „Zurücksetzen“ behält sie, Excel-Upload, Struktur-Abgleich und Crawl-Übernahme ändern sie nicht. Änderungen gelten nur für Schritte, die noch nicht gelaufen sind; „Mit Anmerkung wiederholen“ ab einem abgeschalteten Schritt geht erst, wenn er wieder eingeschaltet ist.

**Seiten, die vor dieser Schrittfolge begonnen wurden** (Recherche, Gliederung, Rohtext …, oder die Endabnahme noch als Schritt 8), passen nicht mehr zu den neuen Schritten. Das Seitenfenster zeigt dann einen Hinweis: **Zurücksetzen** und neu starten. Seiten aus der Reihenfolge mit neun Schritten brauchen das nicht: Die Migration 20261027 hat ihre Schritte umnummeriert. Wer dabei schon über GEO hinaus war, bekommt Schritt 5 als „Übersprungen“ und läuft in der alten Reihenfolge zu Ende; „Mit Anmerkung wiederholen“ ab GEO holt die Prüfung nach.

**Aktualitätsprüfung (Schritt 5).** Nach GEO prüft die App jede zeitkritische Aussage des Texts mit der Websuche von Anthropic (Gesetze und Fristen, Förderungen, Normen, Technikstände, Statistiken, Jahreszahlen und Wörter wie „aktuell“ oder „neu“, Vorgaben von Google und KI-Anbietern). Zwei Aufrufe (`lib/dt/content/pipeline/aktualitaet.ts`): erst die Recherche mit `web_search` und `web_fetch` (höchstens 10 Suchen und 5 Abrufe, Standort DE, keine internen Angaben in Suchanfragen), dann das Ergebnis als Tool-Aufruf ohne Websuche. Der Code lässt nur zu, was belegt ist: Eine Änderung zählt nur mit einer URL, die die Websuche in diesem Schritt wirklich geliefert hat; sonst bleibt der Text und es entsteht der offene Punkt „Quelle fehlt“. Nur Abschnitte mit gültiger Änderung dürfen sich ändern, alle anderen kommen wörtlich zurück. H1, Hero, Frage-Überschriften, Keywords und Marker bleiben. Angaben über den Kunden (Preise, Leistungen, Team, Öffnungszeiten, Referenzen, alles aus den Anbieterfakten) ändert der Schritt nie. Zeigt eine Quelle aus der Websuche, dass eine davon nicht mehr stimmt, wird daraus eine Frage an den Kunden mit dieser Quelle („Braucht Sie“); Routinefragen ohne Hinweis („Stimmen die Öffnungszeiten noch?“) stellt der Schritt nicht. Ist ein ganzer Abschnitt veraltet, geht der Text **einmal** mit Problem, Vorschlag und Quellen an GEO zurück (eigener Block „Aktualitätsprüfung – bitte umsetzen“ in GEOs Nachricht, nicht in den Anmerkungen), danach prüft der Schritt erneut; ist er dann noch veraltet, wird er ein offener Punkt mit Vorschlag und Quelle, den die Endabnahme aufführt. Der Stand steht in `dt_content_pages.freshness`; „Zurücksetzen“ und „Mit Anmerkung wiederholen“ ab GEO leeren ihn. Das Seitenfenster zeigt den Abschnitt **Aktualität**: jede Aktualisierung (Abschnitt, alt → neu, Quelle als Link) und ob der Text an GEO zurückging. Die Quellen bleiben in der App, Exporte enthalten keine Quellenliste. **Voraussetzung:** Die Websuche muss in der Anthropic Console für die Organisation des Schlüssels `ANTHROPIC_DT_CONTENT_API_KEY` freigeschaltet sein. Ohne Websuche (oder bei einem 4xx-Fehler) hält der Schritt mit einer deutschen Fehlermeldung an; er lässt einen Text nie ungeprüft als „aktuell“ durch. Kosten: 10 $ je 1.000 Suchen zusätzlich zu den Tokens, in `cost_eur` des Schritts und der Seite und je Aufruf in `dt_llm_usage_events` (`mode = content.5`). Im Test mit zwei echten Seiten (Claude Sonnet 4.6) kostete der Schritt 0,69 € und 1,13 € je Seite, vor allem durch die Suchergebnisse (175.000 bzw. 294.000 Eingabe-Tokens in der Recherche); eine Rückgabe an GEO kommt dazu.

**Woher die Seiten kommen.** Die Karte **Seitenquelle** bietet zwei Wege; beide füllen die Tabelle „Seiten“, und erst das Häkchen in der Tabelle entscheidet, welche Seiten Texte bekommen:

- **Neue Website** – für Kunden, die noch keine Website haben: Seitenstruktur hochladen, jede Zeile wird eine Seite, die neu geschrieben wird. Die Excel ist ein **Briefing**, nicht nur eine Linkliste: Blatt „Webseitenstruktur“ (sonst das erste Blatt) mit den Spalten **URL, Startseite, Ebene 1, Ebene 2, Traffic, Keywords, H1-Optionen, Nutzerfragen** (A–H, wie beim früheren Python-Werkzeug; Kopfzeile oder feste Reihenfolge) und optional **KI-Prompt**. Der Seitenname steht in der Spalte seiner Ebene; eine Ebene-2-Zeile gehört zur letzten Ebene-1-Zeile darüber (ihr „Hauptsilo“). Keywords als „Privatumzug (590), Privatumzüge (260)“ – das erste ist das Hauptkeyword, Suchvolumen nur, wenn es in der Zelle steht. H1-Optionen und Nutzerfragen je eine pro Zeile; die Nutzerfragen sind echte Google-Fragen und haben in der Analyse Vorrang. Die DT-Vorlage „Ebene 1 … n“ (+ URL) geht weiterhin, mit denselben Briefing-Spalten, wenn sie da sind. Impressum, Datenschutz, Karriere, Kontakt, Zertifizierungen, Unsere Partner, Referenzen und AGB werden als Seitentyp „Nicht bearbeiten“ angelegt und bekommen keinen Text (in der Tabelle und im Seitenfenster änderbar). Eine Seite, die genau „Über uns“ heißt, ist der Seitentyp „Über-uns-Seite“. Die Startseite (Rolle in der Excel, die Wurzel eines Crawls oder der Name Startseite/Home/Hauptseite) ist der Seitentyp „Startseite“. Der Upload in Texte schreibt das Briefing auf die Seiten (`dt_content_pages`) und legt dieselben Seiten als Gliederung unter SEO → Struktur ab (`dt_website_structures`, unveränderter SEO-Parser). Ein Upload unter SEO → Struktur kennt keine Briefing-Spalten: dann folgen nur Name, Pfad, Rolle und Seitentyp der Datei, Keywords und Fragen eines früheren Texte-Uploads bleiben. .csv, .md, .txt, .json, Sitemap-XML und .docx gehen weiterhin (ohne Briefing). Vorhandene Texte bleiben bei jedem Upload.
- **Verbesserung** – für Kunden, die schon eine Website haben und bessere Texte wollen: Website crawlen und die Seitenstruktur hochladen. „Website crawlen“ startet denselben Hintergrund-Crawl wie SEO Modus (Sitemap plus interne Links; braucht die Website-URL unter SEO → Einstellungen). „Seiten übernehmen“ legt für jede gecrawlte Seite eine Zeile an – ohne AGB/Widerruf, ohne Weiterleitungen, höchstens 300. Zeilen, die es schon gibt, behalten ihren Text und bekommen nur die Live-URL. Crawl-Seiten haben kein Briefing: Keywords und Fragen erarbeitet die Analyse, der Seitentyp wird aus Name und Tiefe geraten (Wurzel = Startseite, verschachtelt = Unterseite, oben = Hauptsilo, „Ratgeber“ im Namen = Ratgeber, „Über uns“ = Über-uns-Seite). Der bisherige Text der Live-Seite geht als Orientierung in die Schritte ein; Fakten gelten trotzdem nur, wenn sie in den Anbieterfakten stehen. Dazu kommt derselbe Seitenstruktur-Upload wie bei „Neue Website“ (gleiche Dateien, Spalten und „Nicht bearbeiten“-Seiten), aber ohne die Tabelle zu ersetzen: Eine Zeile, die zu einer Seite der Tabelle oder des Crawls passt (zuerst über den Pfad, dann über den Slug), gibt ihr Seitentyp, Hauptsilo, Keywords, H1-Optionen, Nutzerfragen, KI-Prompt und Linkziele; Text, Schritte, Zustand, Kosten, Live-URL und gecrawlter Text bleiben. Den Seitentyp kann man danach in der Tabelle und im Seitenfenster anpassen. Gecrawlte Seiten, die nicht in der Datei stehen, bleiben. Zeilen ohne Gegenstück auf der Website legt der Upload nicht an; die Karte listet sie („Diese Seiten stehen in der Seitenstruktur, gibt es auf der Website aber noch nicht.“, ohne Crawl: alle Seiten, die nicht in der Tabelle sind) und **Diese Seiten anlegen** legt genau diese an, wie „Neue Website“ (ohne Live-URL, Seitentyp aus der Excel). Beide Reihenfolgen gehen: Wird erst die Excel hochgeladen und später übernommen, bekommen die übernommenen Seiten das gespeicherte Briefing (`dt_website_structures.content_briefing`).

**Textvorlagen.** Die Karte **Textvorlagen** (unten auf Texte) hält je Seitentyp eine Vorlage, die dem SEO-Schritt sagt, wie Startseite, Hauptsilo-Seite, Hauptseite, Unterseite, Ratgeberartikel, Standortseite und Über-uns-Seite geschrieben werden. Die allgemeinen Regeln für jeden Seitentyp (Hormozi-Reihenfolge, Platzhalter, Abgrenzung) stehen einmal im **Text-Prompt**: erste Karte unter Globale Prompts (`/dashboard/verwaltung/globale-prompts#texter-prompt`) und dieselbe Karte unten auf Texte, direkt über den Textvorlagen (Migration `database/migrations/20261016_dt_texter_prompt.sql`). Bei Widerspruch gilt die Textvorlage. Ein Satz Vorlagen für die ganze Agentur (`dt_content_type_prompts`, Migration `database/migrations/20261010_dt_content_type_prompts.sql`), nicht je Organisation; solange die Tabelle leer ist oder fehlt, gelten die Standardvorlagen aus dem Code. **Speichern** gilt ab dem nächsten SEO-Schritt, fertige Seiten ändern sich erst, wenn ihr SEO-Schritt neu läuft; **Auf Standard zurücksetzen** stellt die Vorlagen aus dem Code wieder her. Leere Felder werden nie gespeichert, stattdessen gilt der Standard; höchstens 20.000 Zeichen je Vorlage. „[Hauptsilo]“ in einer Vorlage wird durch den Namen der übergeordneten Seite ersetzt. Jede Seite schreibt mit ihrem eigenen Seitentyp; die Vorlage ist keine Typ-Auswahl für den Durchlauf.

**Schritt-Prompts.** Unter Globale Prompts stehen direkt unter dem Text-Prompt die Anweisungen der Schritte **SEO, Faktencheck, GEO, Aktualitätsprüfung, Hormozi, Vermenschlichung und Lektorat** (`/dashboard/verwaltung/globale-prompts#schritt-prompts`, nur Plattform-Admins). Jede Karte speichert für sich, **Auf Standard zurücksetzen** (oder leer speichern) stellt die Anweisung aus dem Code wieder her (`lib/dt/content/step-prompts.ts`); höchstens 20.000 Zeichen je Schritt, plattformweit in `dt_platform_settings.content_step_prompts`. Der Code hängt danach immer die festen Regeln (`BASE_RULES`), die Branchenregel, beim SEO-Schritt den Text-Prompt und die Textvorlage, bei der Aktualitätsprüfung ihre festen Quellen- und Kundenfakten-Regeln und die Websuche-Regeln, die Nutzernachricht (Seite, Vorschritt, Anbieterfakten, Avatar, Anmerkungen) und das Antwortformat an. `{{firmenname}}`, `{{briefing}}`, `{{mindest_fragen}}`, `{{abschluss}}` und `{{cta_regel}}` werden je Seite ersetzt. Jeder Schritt liest die Texte neu, ein Speichern gilt ab dem nächsten Lauf. Die Werkzeuge SEO, GEO und Hormozi unter Verwaltung nutzen dieselbe SEO-, GEO- bzw. Hormozi-Anweisung. Analyse, Watermark Entfernung und Endabnahme sind nicht bearbeitbar. Gespeicherte eigene Texte nennen vielleicht noch die alten Schrittnummern (vor der Aktualitätsprüfung); die Standards nennen die neuen.

**Seitentypen.** Jede Seite hat einen Seitentyp, der den SEO-Text steuert: **Hauptsilo-Seite** (deckt das Thema breit ab, reißt Unterthemen nur an und verlinkt sie), **Hauptseite** (die Hauptseite eines einzelnen Angebots ohne Unterseiten: das ganze Angebot und ein nächster Schritt, Links zur Startseite und zu verwandten Seiten, die es schon gibt; wird nie abgeleitet oder geraten, nur von Hand gewählt – eine Seite mit dem Namen „Hauptseite“ bleibt die Startseite; Migration `database/migrations/20261017_dt_content_hauptseite.sql`), **Unterseite** (ein Unterthema in der Tiefe, verlinkt immer aufs Hauptsilo), **Ratgeberartikel** (informationell, Problem → Lösung → Vertrauen → nächster Schritt, mindestens fünf Frage-Überschriften, kein harter Verkauf, Autor- oder Prüfhinweis nur mit belegtem Namen), **Standortseite** (Leistung an einem Ort; erkannt am Hauptsilo „Regionen“ oder an einem Ort aus den Anbieterfakten im Seitennamen), **Startseite** (die Hauptseite), **Über-uns-Seite** und **Nicht bearbeiten**. Aus der Excel oder aus Name und Tiefe eines Crawls wird er vorgeschlagen. In der Spalte **Seitentyp** der Tabelle und im Seitenfenster (nach **Öffnen**) steht immer eine Auswahl, vor oder nach einem Durchlauf. Während die Seite läuft, ist die Auswahl gesperrt, bis man stoppt. Ein späterer Upload setzt den Seitentyp wieder aus der Datei.

Das frühere Feld „Seiten eintragen“ (Seitenliste tippen) gibt es nicht mehr.

**Branche.** Die Branche beschreibt das Geschäft des Kunden, nicht den Avatar, und ist ein freies Textfeld („Zahnarztpraxis“, „Umzugsunternehmen“), das der SEO-Spezialist ausfüllt. Beantworten die Anbieterfakten die Frage direkt (eine Fragebogen-Antwort oder eine Zeile „Branche: …“ in einem Gesprächsabschnitt), steht die Antwort schon im Feld. Gibt es nur Signalwörter, steht die passende Gruppe als Vorschlag im Feld (Handwerk & Dienstleistung, Rechtsanwalt & Kanzlei, Arzt & Praxis; Kanzlei- und Praxis-Wörter zählen doppelt, allgemeine Handwerks-Wörter einfach). Ohne beides bleibt das Feld leer, die Karte sagt warum, und „Bestätigen“ geht erst mit einer eingetragenen Branche. Aus dem Text leitet die Pipeline die Branchenregel ab (Kanzlei, Praxis/Heilmittelwerbegesetz, sonst Dienstleistung & Handwerk) und den Standard-Ton. Migration `database/migrations/20261013_dt_content_branche_text.sql` (die früheren drei festen Werte werden zu ihren Bezeichnungen). Die Branche lässt sich vor und nach dem Bestätigen jederzeit ändern („Ändern“).

**Verbotene Wörter** kommen aus einer `.txt`-Datei: ein Wort oder eine Wendung je Zeile, hochgeladen in der Karte „Einstellungen für Texte“ (höchstens 200, Doppelte fallen weg; die Datei wird im Browser gelesen, nichts wird abgelegt). Die Karte zeigt die geladene Liste, „Liste leeren“ entfernt sie. Was die Gespräche nahelegen, steht als Vorschlag vorab in der Liste.

**Export.** Im Seitenfenster hat jede Seite mit Text zwei Knöpfe: **HTML exportieren** (vollständige HTML-Datei mit Titel) und **Text exportieren (.txt)** (nur der Text: Überschriften als Zeilen, Absätze, Listen mit Spiegelstrich, Links mit Adresse, ohne Auszeichnung).

### SEO: eigenständiger Seitentext aus Seitenname, Seitentyp und Avatar

**SEO** liegt unter **Verwaltung**, direkt neben Texte (`/dashboard/verwaltung/seo-text`, Organisation oben in der Leiste oder über `?org=`; die Adresse `/dashboard/verwaltung/seo` gehört dem SEO Modus). Es ist ein eigenständiges Werkzeug und hängt an nichts aus Texte: keine Seitenstruktur, keine bestätigten Einstellungen, keine Analyse, kein Hintergrund-Job, nichts wird gespeichert. Eingaben: **Seitenname**, **Seitentyp** (die sieben Seitentypen von Texte), optional eine Datei als **Material** (`.txt`, `.html`, `.pdf`, `.docx`, gelesen von `lib/dt/text-tools/ingest.ts`; nur Orientierung, Fakten daraus zählen nur, wenn sie in den Anbieterfakten stehen) und der **Avatar** aus einer Auswahl der Avatare der Organisation (oder „Ohne Avatar“), dann **Text schreiben**.

Ein einziger Claude-Aufruf (Schreibmodell von Texte, Tool `submit_seo_text`) schreibt die ganze Seite; die Anfrage wartet auf das Ergebnis (meist zwei bis vier Minuten, Route mit `maxDuration` 300 s). Der System-Prompt besteht aus der Anweisung **Globale Prompts → SEO** (immer die dort gespeicherte, sonst ihr Standard; die Variablen wie `{{mindest_fragen}}` werden für den Seitentyp gefüllt), festen Regeln (Fakten nur aus den Anbieterfakten, Platzhalter statt Erfundenem, Anrede wie im Material, sonst „Sie“) und der **Textvorlage** des gewählten Seitentyps. Die Nachricht enthält Seite, Hinweis „keine Analyse – Hauptkeyword und Fragen selbst ableiten“, Material, **Anbieterfakten** und **Avatar**. Der Hero-Platzhalter steht wie in Texte unter der H1. Das Ergebnis erscheint als Vorschau und lässt sich als **HTML** oder **Text (.txt)** herunterladen (im Browser erzeugt, wie der Texte-Export). Verbrauch und Kosten landen in der Token-Nutzung unter dem Modus `text-tool.seo`.

**Eigene Textvorlagen.** Unter dem Werkzeug steht dieselbe Karte **Textvorlagen** wie in Texte, aber mit einem eigenen Satz Vorlagen (zweite Zeile `id = 'seo_tool'` in `dt_content_type_prompts`, Route `/api/dt/text-tools/seo/type-prompts`). Ändert jemand die Textvorlagen unter Texte, ändert sich hier nichts, und umgekehrt. Die Migration `database/migrations/20261019_dt_seo_tool_type_prompts.sql` (einmal im Supabase SQL Editor ausführen) erlaubt die zweite Zeile und legt sie als Kopie der heutigen Texte-Vorlagen an; ohne sie gelten im Werkzeug die Standardvorlagen und **Speichern** meldet, welche Migration fehlt. Test: `npm run test:text-tools-seo` (Prompt aus Globale Prompts und eigener Textvorlage, nur Anbieterfakten und Avatar, ein Aufruf, Hero-Platzhalter, getrennte Textvorlagen).

### GEO: eigenständiges Werkzeug für eine hochgeladene Datei

**GEO** liegt unter **Verwaltung**, direkt neben Texte (`/dashboard/verwaltung/geo`, Organisation oben in der Leiste oder über `?org=`). Es ist **eigenständig**: keine Seitenstruktur, keine Einstellungen aus Texte, keine Analyse, kein Faktencheck, kein Hintergrund-Job, nichts wird gespeichert. Das Formular hat drei Felder: **Datei** (`.txt`, `.html`, `.pdf`, `.docx`; das alte `.doc` bitte als `.docx` speichern; höchstens 10 MB, 60.000 Zeichen, 40 Abschnitte), **Seitenname** (optional, nur Beschriftung und Dateiname des Exports) und **Avatar** (die Avatare der Organisation oder „Ohne Avatar“). **Verarbeiten** schickt alles in einem Claude-Aufruf (Schreibmodell von Texte) los; die Seite wartet auf die Antwort, meist ein bis drei Minuten (Route mit 300 s, Modell mit 270 s Zeitlimit).

Der Prompt besteht aus: der Anweisung aus **Globale Prompts → GEO** (`/dashboard/verwaltung/globale-prompts#schritt-prompts`; gespeichert, sonst Standard, `{{firmenname}}` usw. gefüllt), festen Regeln des Werkzeugs (Fakten nur aus Text und Anbieterfakten, Widersprüche als `[BITTE PRÜFEN: …]` markieren statt streichen, Anrede und Ton wie im hochgeladenen Text), dem hochgeladenen Text in Abschnitten, den **Anbieterfakten** und dem gewählten **Avatar**. Es gibt keine Vorgaben aus Texte, keine Branchenregel, keine Anmerkungen. Fehlen die Anbieterfakten, sagt die Seite das und läuft trotzdem. Das Ergebnis steht als Vorschau da und lässt sich als **HTML** (vollständige Datei) oder **Text (.txt)** herunterladen; beide Dateien entstehen im Browser mit demselben Rendering wie der Texte-Export. Verbrauch und Kosten landen in der Token-Nutzung unter dem Modus `text-tool.geo`. Schlüssel und Modell sind die von Texte (`ANTHROPIC_DT_CONTENT_API_KEY`, `ANTHROPIC_DT_CONTENT_MODEL`), keine Tabelle und keine Migration.

Die Datei wird auf dem Server gelesen (PDF mit `unpdf`, Word mit `mammoth`) und in Abschnitte zerlegt: H1/H2/H3 aus HTML und Word werden Überschriften, bei reinem Text (auch PDF) gelten kurze Zeilen zwischen Leerzeilen, `#`-Zeilen und unterstrichene Zeilen als Überschrift, Zeilen mit `-`, `•` oder `1.` als Liste (die Regeln stehen in `lib/dt/text-tools/ingest.ts`). Die Abschnitte heißen `abschnitt-1`, `abschnitt-2` …; ein HTML-Export aus Texte kommt mit seinen eigenen Abschnitts-ids zurück.

### Hormozi: eigenständige Conversion-Schicht für eine hochgeladene Datei

**Hormozi** liegt unter **Verwaltung**, direkt unter GEO (`/dashboard/verwaltung/hormozi`, Organisation oben in der Leiste oder über `?org=`). Es macht einen fertigen Text überzeugender: Hero-Satz, Value Equation und Handlungsaufforderungen, wie Schritt 5 in Texte. Es ist **eigenständig**: keine Seitenstruktur, keine Einstellungen aus Texte, keine Analyse, kein Faktencheck, kein Hintergrund-Job, nichts wird gespeichert. Das Formular hat vier Felder: **Datei** (dieselben Formate und Grenzen wie bei GEO), **Seitenname** (optional, nur Beschriftung und Dateiname des Exports), **Seitentyp** (die sieben Seitentypen wie im Werkzeug SEO, Standard „Unterseite“) und **Avatar**. Der Avatar ist Pflicht: Auswahl aus allen Avataren der Organisation, der neueste ist vorgewählt, „Ohne Avatar“ gibt es nicht. Hat die Organisation keinen, sagt die Seite das, verlinkt auf Agenten und Transkripte, und **Verarbeiten** bleibt gesperrt. Ein Avatar einer anderen Organisation wird abgelehnt. Fehlen die Anbieterfakten, steht nur ein Hinweis da.

Der Prompt: System = die Anweisung aus **Globale Prompts → Hormozi** (gespeichert, sonst Standard; `{{cta_regel}}` und `{{firmenname}}` für den gewählten Seitentyp gefüllt, beim Ratgeberartikel also weicher nächster Schritt statt Verkauf) plus feste Regeln des Werkzeugs (Fakten nur aus Text und Anbieterfakten, Widersprüche als `[BITTE PRÜFEN: …]` markieren statt streichen, Anrede und Ton wie im hochgeladenen Text, fehlende Kontaktwege, Preise, Garantien oder Beweise als `[BITTE PRÜFEN: …]`, Verknappung, Garantien und Fristen nur aus den Anbieterfakten). Die Nachricht enthält Seite (mit Seitentyp), den Block „Vorschritte“ (keine Analyse: das Modell leitet Traumziel, Hauptschmerz, größte Hürde, Beweis und gewünschte Handlungsaufforderung selbst aus Avatar, Anbieterfakten und Text ab und gibt sie mit zurück), den hochgeladenen Text, die **Anbieterfakten** und den **Avatar**. Keine Vorgaben aus Texte, keine Branchenregel, keine Anmerkungen. Eine eigene Anweisung gibt es nicht: Wer Globale Prompts → Hormozi ändert, ändert Schritt 5 in Texte und dieses Werkzeug zugleich.

**Hero-Satz.** Ein hochgeladener Text hat keinen Hero-Platzhalter, also setzt das Werkzeug ihn vor dem Aufruf direkt hinter den ersten Abschnitt (ist der erste Abschnitt eine Überschrift, ist er die H1; ein Absatz ohne Überschrift bleibt, was er ist, keine Ebene ändert sich). Nach der Antwort wird der Hero wie in Texte als ein Satz in `<p>` ohne Überschrift abgelegt. Fehlt der Satz, fragt das Werkzeug einmal nach („Der Hero-Satz fehlt: genau ein Satz als <p> im Abschnitt hero.“); fehlt er danach noch, meldet die Seite „Das Modell hat keinen Hero-Satz geliefert. Bitte erneut versuchen.“

Ein Claude-Aufruf (Schreibmodell von Texte, Tool `submit_hormozi_tool_text`, höchstens 12.000 Tokens wie Schritt 6 in Texte), zwei nur bei der Nachfrage zum Hero; Route mit 300 s, Modell mit 270 s Zeitlimit. Das Ergebnis zeigt zuerst die Karte **Hormozi-Bausteine** (Traumziel, Hauptschmerz, Größte Hürde, Beweis, Handlungsaufforderung, so wie das Modell sie abgeleitet hat), darunter den Text mit Datei, Seitentyp, Avatar, Abschnitten und Kosten, **HTML herunterladen** und **Text (.txt) herunterladen** (im Browser erzeugt, wie bei GEO). Verbrauch und Kosten landen je Aufruf in der Token-Nutzung unter dem Modus `text-tool.hormozi`, beim Avatar. Keine Tabelle, keine Migration, keine neue Umgebungsvariable. Test: `npm run test:text-tools-hormozi`.

### Quelle für SEO, GEO und Hormozi: Datei oder Website-Crawl

Die Werkzeuge **SEO**, **GEO** und **Hormozi** haben oben zwei Wege für den Text: **Datei hochladen** (wie bisher) oder **Website crawlen**. Der Crawl ist derselbe wie in Texte unter „Seitenquelle“: dieselbe Schaltfläche „Website crawlen“ / „Erneut crawlen“ (`/api/dt/content/crawl`, Hintergrund-Job `seo.crawl`, Sitemap und interne Links, Website-URL aus SEO → Einstellungen), derselbe Fortschritt „X von Y Seiten gelesen“. Darunter steht die Tabelle der gecrawlten Seiten mit Name, Pfad, Seitentyp und Ebene, nach denselben Regeln wie „Seiten übernehmen“ in Texte (`planCrawlContentPages`: ohne AGB/Widerruf, Weiterleitungen, leere Abrufe und www/http-Doppelte, flach vor tief, höchstens 300; Route `/api/dt/text-tools/crawl-pages`). Eine Zeile anklicken wählt die Seite; Seitenname und (bei SEO und Hormozi) Seitentyp werden vorgeschlagen, ein selbst eingetippter Name bleibt. In Texte wird dabei nichts angelegt.

Beim Start liest der Server die gewählte Seite **live** (`lib/dt/text-tools/crawl-source.ts`), damit ihre Überschriften erhalten bleiben (der Crawl speichert nur Fließtext), und zerlegt sie wie eine hochgeladene `.html`-Datei: beschränkt auf `<main>` bzw. das `<article>` mit der H1, Navigation, Kopf und Fuß fallen weg, die H1 steht vorn, und mehr als 40 Abschnitte werden zusammengelegt statt abgelehnt (zuerst H3 in den Abschnitt darüber, dann die kürzesten; kein Text geht verloren; Dateien bleiben bei der festen Grenze). Ist die Seite nicht erreichbar, gilt der gespeicherte Crawl-Text. Abgerufen werden nur Adressen aus dem Crawl der gewählten Organisation, nie private Adressen. Für **SEO** ist die Seite Material wie eine hochgeladene Datei; **GEO** und **Hormozi** überarbeiten ihren Text. Test: `npm run test:text-tools-crawl-source`.

### Watermark Entfernung: Schritt 9 auf eine hochgeladene Datei

**Watermark Entfernung** liegt unter **Verwaltung** (`/dashboard/verwaltung/watermark-entfernung`) und ist ein **eigenständiges** Werkzeug: keine Organisation, keine Einstellungen für Texte, kein Hintergrund-Job, keine Tabelle. Die Seite hat nur zwei Bedienelemente: **Datei hochladen** (`.txt`, `.html`, `.pdf`, `.docx`, dieselben Grenzen wie bei GEO, gelesen von `lib/dt/text-tools/ingest.ts`) startet die Verarbeitung sofort, danach **HTML herunterladen** und **Text (.txt) herunterladen**. Dazwischen zeigt die Seite „4 von 11 Abschnitten neu formuliert …“. Jeder Satz wird auf Grok (xAI) neu formuliert; Überschriften, Abschnitts-ids, Fakten, Zahlen, Marker und Handlungsaufforderungen bleiben. Es ist dieselbe Implementierung wie Schritt 9 in Texte: dieselben Abschnittsgruppen (`planRephraseChunks`), derselbe System-Prompt, derselbe Lauf (`lib/dt/content/pipeline/rephrase-runner.ts`). Nur die Vorgaben unterscheiden sich: ohne Texte-Einstellungen behält der Text seine eigene Anrede und Tonalität. Einen Ausweg über Claude gibt es nicht: ohne `XAI_API_KEY` steht „Der Grok-Zugang für Texte ist nicht eingerichtet (XAI_API_KEY fehlt)“ auf der Seite und der Upload ist gesperrt.

**Ablauf.** Der Browser steuert den Durchlauf, der Server speichert nichts. `POST /api/dt/text-tools/watermark/parse` liest die Datei und gibt die Abschnitte samt Plan der Grok-Aufrufe zurück. Danach schickt der Browser jede Abschnittsgruppe einzeln an `POST /api/dt/text-tools/watermark/chunk` (ein Grok-Aufruf, drei gleichzeitig). Eine ausgelastete oder zu langsame Antwort wird bis zu dreimal wiederholt, ein zu langsames Modell wird für den Rest des Durchlaufs ans Ende gestellt. Am Ende baut der Browser die Dateien wie der Texte-Export (`lib/dt/text-tools/watermark-export.ts`). Die Seite muss bis zum Ende offen bleiben. Beide Routen sind nur für Plattform-Administratoren. Weil der Durchlauf zu keiner Organisation gehört, landet der Verbrauch nicht in der Token-Nutzung (die braucht eine Organisation), sondern als Zeile `[text-tool.watermark] usage` mit Modell, Tokens und Kosten im Server-Log.

**Betrieb.** Ob der Schlüssel gilt, welche Grok-Modelle er sieht und wie schnell sie eine Abschnittsgruppe beantworten, prüft `XAI_API_KEY=… npm run xai:check` (optional `XAI_DT_CONTENT_MODEL=…`); das ist der erste Griff, wenn das Werkzeug oder Schritt 9 mit „Grok … nicht verfügbar“ oder dem Zeitlimit stehen bleibt. Test: `npm run test:text-tools-watermark`.

Die sechs Textwerkzeuge im Überblick:

| Werkzeug | Adresse | Was es tut |
|---|---|---|
| Texte | `/dashboard/verwaltung/texte` | Seitentexte aus Briefing und Anbieterfakten in zehn Schritten schreiben, prüfen, freigeben, exportieren. |
| SEO | `/dashboard/verwaltung/seo-text` | Eigenständig einen Seitentext aus Seitenname, Seitentyp, Avatar und optionalem Material schreiben lassen (Prompt aus Globale Prompts → SEO, eigene Textvorlagen), als HTML oder .txt herunterladen. |
| GEO | `/dashboard/verwaltung/geo` | Einen hochgeladenen Text mit dem GEO-Prompt aus Globale Prompts, den Anbieterfakten und einem Avatar überarbeiten und als HTML oder .txt herunterladen. |
| Hormozi | `/dashboard/verwaltung/hormozi` | Einem hochgeladenen Text mit dem Hormozi-Prompt aus Globale Prompts Hero-Satz, Value Equation und Handlungsaufforderungen geben (Seitentyp und Avatar wählen), als HTML oder .txt herunterladen. |
| Watermark Entfernung | `/dashboard/verwaltung/watermark-entfernung` | Eigenständig: Datei hochladen, jeder Satz wird auf Grok neu formuliert (Schritt 9 aus Texte), als HTML oder .txt herunterladen. |
| Text-Modus im Chat | DigitalTwin-Chat, Schalter „Text-Modus“ | Freie Texte (Flyer, Posts, Mails) im Gespräch mit einem Avatar schreiben lassen. |

**Woher die Fakten kommen.** Beides zählt, beides darf fehlen, solange das andere da ist:

- der neueste **abgeschlossene Anbieter-Fragebogen** der Organisation (Fragebögen, Zweck „Anbieter“)
- die **ausgewerteten Gespräche** unter Transkripte (`dt_workshop_corpus.anbieter`)

Anrede, Branche und Tonalität werden daraus vorgefüllt. Was schon in den Gesprächen steht, bleibt; der Fragebogen füllt nur Lücken.

**Avatar.** Der gewählte Avatar geht mit Name, Rolle und seinem eigenen Text in jeden Schritt von Texte und in die Werkzeuge SEO, GEO und Hormozi. Bei Avataren auf dem globalen DigitalTwin-Prompt (aus Fragebögen, Transkripten, der Mix) ist das `prompt_append`, bei Avataren mit eigenem Prompt `prompt_template`. Blöcke, die nur den Chat steuern (Anker, Anrede, Gesprächskanal, Datum, Verhaltensregeln im Gespräch, „Wer mit dir spricht“, „Was du kannst“), fallen weg; Platzhalter älterer Avatare wie `{{alter}}` werden aus `avatar_data` gefüllt. Höchstens 20.000 Zeichen je Avatar, der Rest wird gekürzt (`lib/dt/agents/avatar-text.ts`).

| Name | Was er bedeutet |
|---|---|
| `ANTHROPIC_DT_CONTENT_API_KEY` | Eigener Anthropic-Schlüssel nur für Texte. In der [Anthropic Console](https://console.anthropic.com/settings/keys) einen neuen Schlüssel anlegen und in Vercel unter **Settings → Environment Variables** eintragen (lokal in `.env.local`). Nur der Server kennt ihn; der Browser nie. Nie mit `NEXT_PUBLIC_` beginnen. Texte fällt nicht auf `ANTHROPIC_API_KEY` zurück, sonst liefe die Abrechnung wieder mit dem übrigen Verbrauch zusammen. Für die Aktualitätsprüfung (Schritt 5) muss die Websuche in der Anthropic Console für die Organisation dieses Schlüssels freigeschaltet sein; sonst hält der Schritt mit Fehlermeldung an. |
| `ANTHROPIC_DT_CONTENT_MODEL` | Modell für die Schreibschritte 1 Analyse, 2 SEO, 4 GEO, 5 Hormozi, 6 Vermenschlichung. Standard: `claude-sonnet-4-6`. |
| `ANTHROPIC_DT_CONTENT_CHECK_MODEL` | Modell für die Prüfschritte 3 Faktencheck, 7 Lektorat, 9 Endabnahme. Leer = wie das Schreibmodell. Hier kann ein günstigeres Modell stehen. |
| `XAI_API_KEY` | Schlüssel für Grok (xAI), nur für Schritt 9 Watermark Entfernung. In der xAI Console anlegen und in Vercel unter **Settings → Environment Variables** eintragen (lokal in `.env.local`); nur der Server kennt ihn. Fehlt er, bleibt die Seite in Schritt 9 mit „Der Grok-Zugang für Texte ist nicht eingerichtet (XAI_API_KEY fehlt)“ stehen – der Schritt wird nicht übersprungen und läuft nie über Claude. |
| `XAI_DT_CONTENT_MODEL` | Grok-Modell für Schritt 9. Standard `grok-4-1-fast-non-reasoning`: es beantwortet eine Abschnittsgruppe in wenigen Sekunden, das Reasoning-Modell `grok-4.7` brauchte dafür über zwei Minuten und lief ins Zeitlimit. Antwortet xAI mit 404 oder braucht das Modell über eine Minute für eine Abschnittsgruppe, geht die Pipeline die Ausweichmodelle durch: `grok-4-fast-non-reasoning`, `grok-3`, `grok-4.7`, `grok-4` (ein zu langsames Modell wird für die Seite gemerkt und beim nächsten Versuch übersprungen). Welche Modelle der Schlüssel sieht und wie schnell sie antworten, zeigt `XAI_API_KEY=… npm run xai:check`. |
| `CONTENT_USD_EUR_RATE` | Umrechnungskurs für die Kosten-Spalte (Anthropic und xAI rechnen in US-Dollar ab). Standard `0.92`. |

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

Welches Modell gerade aktiv ist, folgt aus der Reihenfolge oben (`app_settings`, dann Umgebungsvariable, dann Standard); die Oberfläche zeigt es nicht an. Gibt es den Modellnamen bei Anthropic nicht (Tippfehler, abgekündigt), probiert die Pipeline nacheinander ältere Sonnet-Namen; schlägt auch das fehl, steht der Fehler an der Seite („Fehler in Schritt …“) und kann mit **Weiterlaufen lassen** nach der Korrektur wiederholt werden.

**Was die Statuszeile einer laufenden Seite bedeutet.** Die Tabelle liest nicht nur die Seite, sondern auch ihren Hintergrund-Job:

| Text | Bedeutung |
|---|---|
| „Schritt 2 von 10: SEO läuft“ | Ein Worker rechnet gerade an diesem Schritt. |
| „Schritt 3 von 10: Faktencheck startet gleich“ | Der Schritt ist fertig, der nächste wartet auf den nächsten Tick der Jobs-Uhr (alle 30 s). |
| „… erneuter Versuch in ca. 2 Min. (Grund)“ | Anthropic hat abgelehnt (Ratenlimit, überlastet) oder der Worker wurde unterbrochen. Der Job wartet auf seinen nächsten Versuch; drei Versuche je Seite. |
| „Wartet seit 3 Min. auf den Start“ | Der Job ist fällig, aber kein Worker holt ihn ab: `app_settings` (`app_base_url`, `jobs_worker_token`) und `JOBS_WORKER_TOKEN` prüfen. Solange die Seite offen ist, stößt sie den Worker auch selbst an. |
| „Fehler in Schritt 2: …“ (Status In Arbeit) | Der Job ist zu Ende, ohne die Seite abzuschließen: dreimal unterbrochen, Schlüssel abgelehnt, Antwort abgeschnitten. Der Grund steht dabei, ohne technische Details („Bitte die Technik informieren“ meint: Schlüssel, Modell oder Zeitlimit in Vercel/Supabase prüfen, siehe oben); **Weiterlaufen lassen** macht an der Stelle weiter. |

**Suchen und filtern.** Über der Tabelle steht ein Suchfeld (findet Name, Pfad, Live-URL und Suchbegriff; Umlaute dürfen auch als ae/oe/ue oder ohne Punkte geschrieben werden) und je ein Chip pro Status, mehrere kombinierbar. „Alle auswählen“, „Texte erstellen“ und die Sammelaktionen beziehen sich immer auf die gefilterte Liste.

**Stoppen und Zurücksetzen.** Jede laufende Seite hat in der Tabelle und im Seitenfenster **Stoppen**: Der Hintergrund-Job wird beendet, die Seite pausiert nach dem letzten fertigen Schritt und läuft mit **Weiterlaufen lassen** dort weiter. **Zurücksetzen** (im Seitenfenster, oder für angehakte Seiten „Auswahl zurücksetzen“ in der Kopfzeile der Tabelle, ebenfalls mit Rückfrage) löscht Text, Schritte, Fragen, Anmerkungen und Kosten der Seite und stellt sie auf „Nicht begonnen“; Name, Pfad und Quelle bleiben. **Löschen** (im Seitenfenster, oder „Auswahl löschen“ in der Kopfzeile der Tabelle – mit Rückfrage, die die betroffenen Seiten auflistet) entfernt die Zeile ganz – zum Ausmisten einer Tabelle, etwa gecrawlte Seiten, die keine Texte brauchen; Seiten aus der Seitenstruktur kommen beim nächsten Upload wieder, Crawl-Seiten beim nächsten „Übernehmen“. Ein Schritt, der in dem Moment noch bei der KI rechnet, wird zu Ende gerechnet, aber nicht mehr gespeichert.

**Alles zurücksetzen** (Kopfzeile der Tabelle, mit Rückfrage) leert Texte für die gewählte Organisation komplett: alle Seiten mit Texten, Schritten, Fragen und Kosten, laufende Schritte, die bestätigten Einstellungen und die hochgeladene Seitenstruktur (sonst kämen die Seiten beim nächsten Laden aus ihr zurück). Der Crawl der Website, Avatare und Anbieterfakten bleiben. Danach ist das Werkzeug leer und bereit für einen neuen Start mit der Briefing-Excel.

Eine Seite bleibt also nicht mehr auf „läuft“ stehen, wenn ihr Job gestorben ist: Jedes Laden der Tabelle gleicht Seiten in „läuft“ mit der Tabelle `jobs` ab und pausiert sie mit Grund, wenn der Job fertig, tot oder verschwunden ist. Ein Schritt, der beim Aufwachen noch auf „läuft“ steht, zählt als abgebrochener Versuch (sonst liefe derselbe Schritt alle sechs Minuten neu, endlos). Der Worker hat pro Aufruf 240 Sekunden und `/api/jobs/run` 300 Sekunden (`maxDuration`); braucht ein Schreibschritt länger, als Vercel erlaubt, steht nach drei Abbrüchen „Vermutlich erreicht der Server sein Zeitlimit“ an der Seite – dann ein schnelleres Modell wählen oder die Function-Dauer des Vercel-Plans prüfen.

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
3. Danach **jede Datei** in `database/migrations/` ausführen, sortiert nach dem Datum am Anfang des Dateinamens, die älteste zuerst. Es sind 98 Dateien. Eine neuere Datei setzt voraus, dass die älteren schon liefen.
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
- `ai-chat-attachments` für Dateien in der DigitalTwin-Hilfe (früher Fragebogen-Assistent)

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
| Texte | Seitentexte in zehn Schritten schreiben lassen, prüfen und freigeben. Organisation oben in der Leiste wechseln. |
| SEO | Einen Seitentext aus einem Briefing mit Schritt 2 „SEO“ aus Texte schreiben lassen und als HTML oder .txt herunterladen. |
| GEO | Eine hochgeladene Datei mit dem GEO-Prompt aus Globale Prompts für KI-Zitate überarbeiten und als HTML oder .txt herunterladen. |
| Hormozi | Eine hochgeladene Datei mit dem Hormozi-Prompt aus Globale Prompts überzeugender machen (Hero-Satz, Value Equation, Handlungsaufforderungen) und als HTML oder .txt herunterladen. |
| Watermark Entfernung | Eigenständig: Datei hochladen, jeder Satz neu formuliert (Schritt 9 aus Texte, Grok), als HTML oder .txt herunterladen. |
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
| `/dashboard/verwaltung/texte` | Texte: Seitentexte in zehn Schritten schreiben lassen, prüfen und freigeben. Nur Plattform-Admins, Organisation über `?org=`. |
| `/dashboard/verwaltung/seo-text` | SEO: Seitenname, Seitentyp, Avatar, optional eine Datei; ein Claude-Aufruf mit dem SEO-Prompt aus Globale Prompts und den eigenen Textvorlagen, Ergebnis herunterladen. Nur Plattform-Admins, Organisation über `?org=`. |
| `/dashboard/verwaltung/geo` | GEO: eine Datei hochladen, Avatar wählen, mit dem GEO-Prompt aus Globale Prompts überarbeiten, Ergebnis herunterladen. Nur Plattform-Admins, Organisation über `?org=`. |
| `/dashboard/verwaltung/hormozi` | Hormozi: eine Datei hochladen, Seitentyp und Avatar (Pflicht) wählen, mit dem Hormozi-Prompt aus Globale Prompts die Conversion-Schicht ergänzen, Bausteine ansehen, Ergebnis herunterladen. Nur Plattform-Admins, Organisation über `?org=`. |
| `/dashboard/verwaltung/watermark-entfernung` | Watermark Entfernung: eigenständig, ohne Organisation; Datei hochladen, Ergebnis als HTML oder .txt herunterladen. Nur Plattform-Admins. |
| `/dashboard/admin/jobs` | Job-Liste. |


### SEO Modus → Grounding: „Website prüfen“

Oben im Tab **Grounding** steht die Karte **Website-Abgleich**. Sie prüft für die gewählte Firma, ob es eine Grounding Page gibt und ob sie noch zur Website passt. Sie veröffentlicht nichts auf der Website des Kunden.

1. **Website prüfen** startet die Prüfung im Hintergrund. Das dauert ein paar Minuten. Solange steht dort „Prüfung läuft“ mit dem aktuellen Schritt.
2. Danach zeigt die Karte das Ergebnis: **Aktuell** (nichts zu tun), **Aktualisierung empfohlen** (Website und Grounding Page weichen ab, oder die Seite erfüllt Standard v1.7 nicht), **Keine Grounding Page** oder **Entwurf wartet auf Prüfung**.
3. **Was sich ändert**: Neu, Geändert, Entfällt und Unverändert (zugeklappt). Jeder Eintrag verlinkt die Seite der Website, die ihn belegt. Darunter stehen die Befunde zum Standard v1.7, die **Offenen Punkte** (was die Website nicht sagt oder nur intern bekannt ist; das kommt nicht auf die Seite) und die **Hinweise**: Ist die Grounding Page im Footer neben Impressum und Datenschutz verlinkt? Sperrt die robots.txt KI-Crawler (GPTBot, OAI-SearchBot, ChatGPT-User, PerplexityBot, ClaudeBot, Google-Extended)? Gibt es eine llms.txt?
4. **Entwurf**: eine Vorschau der grounding.html, dazu grounding.html und llms.txt zum Bearbeiten und „Fakten auf der Seite ein- oder ausschalten“. Darüber steht die technische Prüfung: JSON-LD gültig, HTML und JSON-LD gleich, jeder Fakt mit Quelle. Bewertungen der eigenen Firma sind zunächst ausgeschaltet.
5. **Prüfen und freigeben**: die sechs Prüfpunkte des Standards abhaken (Faktische Richtigkeit, Aktualität, Nachprüfbarkeit und Quellenqualität, Identifikation der Entität, Übereinstimmung, Redaktionelle Freigabe), den eigenen Namen eintragen (vorbelegt), dann **Freigeben** oder **Ablehnen**. Erst die Freigabe schreibt den Prüfhinweis „Fakten geprüft von Sichtbarkeitsmeister GmbH · Zuletzt von einem Menschen geprüft: …“ mit dem heutigen Datum in die Seite und dieselben Werte als reviewedBy und lastReviewed ins JSON-LD. Der Name der prüfenden Person bleibt intern am Lauf.
6. Nach der Freigabe: **grounding.html** und **llms.txt** herunterladen und von Hand hochladen (grounding.html unter der Grounding-URL, llms.txt ins Stammverzeichnis der Domain). Dann **Als hochgeladen markieren**. Das trägt beim Hub Upload-Datum, Prüfdatum und Prüfer ein, und der Drei-Monats-Rhythmus beginnt neu.

Ist der Inhalt gleich, aber die Prüfung fällig, heißt das Ergebnis **Nur Daten auffrischen**: Der Entwurf ist die Live-Seite mit neuem dateModified und neuem „Stand“. Auch er braucht die Freigabe.

**Verlauf** listet alle Prüfungen mit Datum, Auslöser (manuell oder automatisch), Ergebnis und Status. Automatische Prüfungen schicken keine Mail; ihr Entwurf erscheint nur hier.

Einmal im Supabase SQL Editor ausführen: `database/migrations/20261023_dt_grounding_runs.sql`. Fehlt sie, nennt die Karte den Dateinamen.

---

## 10. Was im Hintergrund passiert

### Diktieren im Chat

Im DigitalTwin-Chat, im SEO-Chat und in der DigitalTwin-Hilfe gibt es im Eingabefeld ein Mikrofon. Ein Klick startet die **Spracherkennung des Browsers** (Web Speech API, Deutsch), der gesprochene Text erscheint live im Eingabefeld und lässt sich vor dem Senden korrigieren. Ein zweiter Klick beendet das Diktat. Chrome, Edge und Safari können das; in Firefox fehlt der Knopf. In Chrome geht die Tonspur zur Erkennung an Google, das gehört in die Datenschutzerklärung. Es gibt keinen Server-Anteil und keine Kosten; die Logik liegt in `lib/shared/speech-dictation.ts` und `components/dt/chat/use-speech-dictation.ts`.

### DigitalTwin-Hilfe

Unten rechts im Dashboard sitzt für alle eingeloggten Nutzer die **DigitalTwin-Hilfe** (`app/dashboard/_components/dashboard-sticky-survey-ai-assistant.tsx`). Sie beantwortet „Wo finde ich …“, „Was macht diese Seite“ und „Warum geht … nicht“.

- **Wissen**: das Handbuch in `lib/help/handbook.ts`, eine kurze, rollengefilterte Fassung dieses READMEs. Mitglieder sehen Menü, Wege, Fehlerhilfe und Support-Kontakt; Inhaber zusätzlich Agenten; Plattform-Admins den SEO-Modus, Grounding, Texte und die Admin-Fehlerhilfe. Neue Seiten oder geänderte Wege dort nachpflegen.
- **Kontext**: Rolle, aktuelle Seite (Pfad, Firma, SEO-Tab) und die letzten fünf Fehlermeldungen der Browser-Sitzung (Fehler-Toasts und unbehandelte Fehler, nur der Text). Links auf App-Seiten öffnen im selben Tab.
- **Rollen**: Kunden bekommen nur Hilfe im Gespräch, keine Aktionen, keine Werkzeuge, keine Agenten-Prompts und keine Daten anderer Firmen. Für Plattform-Admins bleibt der Assistent zusätzlich der Fragebogen- und Workspace-Assistent mit Aktionen (Fragebögen, Ordner, Agenten-Prompts) und Crawl-Werkzeugen.
- **Einstellungen**: unter `/settings` eigene Regeln für den Assistenten, pro Nutzer.

### Chat

Der normale Chat spricht **direkt mit Claude**. Die Unterhaltung, die Dateien und die gewählte KI-Figur liegen in Supabase.

Nur wenn `DT_CHAT_USE_N8N` genau `1` ist, geht die Antwort über den n8n-Webhook `N8N_DT_CHAT_WEBHOOK`.

Anhänge liegen im Bucket `dt-chat-attachments`.

### Vom Fragebogen zum Avatar

Ein ausgefüllter Fragebogen kann einen Avatar erzeugen. Das läuft über Claude, bei langen Texten als Auftrag im Hintergrund (Anthropic Message Batches), damit das Zeitlimit von Vercel nicht abreißt. Der Assistent, der Fragebögen vorschlägt und ändert, liegt unter `app/api/ai/`.

### Mix-Avatar

Unter **Agenten** legt ein Plattform-Admin mit **Mix-Agent erstellen** (neben „Neuer Agent“) je Organisation einen Mix an: einen neutralen Interessenten, der für mehrere Zielgruppen-Avatare zugleich steht. Im Fenster **Mix-Agent** wählt man mindestens zwei aktive Zielgruppen-Avatare (Persona oder Wunschkunde, nicht SEO-Berater oder Standard-Twin). Claude (dasselbe Modell wie bei „Anbieter-Avatare“) bekommt Name, Rolle und Avatar-Teil jedes gewählten Avatars und schreibt mit dem globalen Prompt **Mix-Avatar** (Globale Prompts, Slug `avatar_mix`; leer oder fehlend gilt der Standard aus `lib/dt/agents/mix-prompt.ts`) den avatar-spezifischen Teil. Vor dem Speichern prüft der Code Anker, alle Mix-Blöcke in ihrer Reihenfolge, Platzhalter in eckigen Klammern, Gedankenstriche und 4 bis 6 Quick Actions aus Sicht des Mitarbeiters. Bei einem Verstoß läuft Claude ein zweites Mal mit den Fehlern; scheitert auch das, kommt eine Fehlermeldung und nichts wird gespeichert.

Der Mix ist ein normaler Agent (Name „Mix“, Slug `mix`, Rolle „Mix aus N Zielgruppen“, `avatar_data.mix` mit Quell-Avataren und Zeitpunkt) und lässt sich bearbeiten, ein- und ausschalten und löschen wie jeder andere. Er steht im Chat und in den Avatar-Auswahlen von Texte, SEO, GEO und Hormozi, dort ganz oben als „Mix (aus N Zielgruppen)“; vorausgewählt bleibt der neueste Zielgruppen-Avatar. **Mix neu erstellen** an seiner Zeile ersetzt den Prompt im selben Agenten, die Chats bleiben. Wurde ein Quell-Avatar seitdem geändert oder gelöscht, zeigt die Zeile „Quell-Avatare haben sich geändert. Mix neu erstellen?“. Das Wunschkunden-Wissen des SEO-Beraters, die Referenzbeispiele für Fragebogen → Agent und der Abgleich der Transkripte lassen den Mix aus. Migration einmal im Supabase SQL Editor ausführen: `database/migrations/20261021_dt_avatar_mix_prompt.sql`. Test: `npm run test:avatar-mix`.

### SEO

1. Jemand startet im SEO-Modus einen Bericht oder einen Crawl.
2. Die App ruft n8n auf (`N8N_DT_SEO_REPORT_WEBHOOK` oder die Search-Console-Webhooks).
3. n8n ruft die App wieder auf und weist sich mit `DT_INTERNAL_WEBHOOK_SECRET` aus.
4. Lange Website-Prüfungen laufen als Job `seo.crawl`. Die Datenbank-Uhr stößt `/api/jobs/run` an.
5. Fertige Berichte kann der Firmeninhaber lesen. Die Bearbeitung bleibt bei der Agentur.

### Grounding Pages

Der Tab **Grounding** im SEO-Modus verwaltet je Firma die Grounding Pages nach dem Grounding Page Standard v1.7: einen **Hub** (Haupt-Grounding-Page) und beliebig viele **Entitätsseiten**, dazu die `llms.txt` der Domain. Je Seite stehen Upload-Datum, `dateModified`, `lastReviewed` (letzte menschliche Faktenprüfung), Prüfer, Standardversion und Status (Entwurf oder freigegeben) in `dt_grounding_pages` (Migration `database/migrations/20261012_dt_grounding_pages.sql`; sie übernimmt den bisherigen Hub aus `dt_org_config`).

- **Fälligkeit**: drei Monate nach `lastReviewed`, Frühwarnung 14 Tage vorher. Ohne dokumentierte Prüfung gilt vorläufig das Upload-Datum.
- **Von Seite lesen** holt die Werte von der Live-Seite in dieser Reihenfolge: JSON-LD `lastReviewed`, JSON-LD `dateModified`, sichtbarer Prüfhinweis („Fakten geprüft von … · Zuletzt von einem Menschen geprüft: …“), Meta-Tags, HTTP `Last-Modified`. Weichen Prüfhinweis und JSON-LD ab, landet das als Befund in der Notiz.
- **Freigabe dokumentieren** setzt Prüfer und Prüfdatum; die Seite gilt dann als freigegeben (v1.7). Ein Prüfdatum in der Zukunft wird abgelehnt. Wird `dateModified` später neuer als `lastReviewed`, zeigt die Karte „nach Prüfung geändert“.
- **Agent**: Im SEO-Chat und beim `geo_advisor` steht der Block „Grounding Pages (Tool-Kontext)“ im System-Prompt (auch im Agent-Kontext sichtbar). Mit dem Werkzeug `update_grounding_page` meldet der Agent je Seite URL, Status, `dateModified`, `lastReviewed`, Prüfer und Version zurück ins Tool.
- **Grounding-Agent (Entwurf in vier Schritten)**: Eine ganze Grounding Page passt nicht in einen Chat-Zug (Vercel bricht nach 300 s ab). Deshalb baut der Tab **Grounding** jede Seite wie Texte als Hintergrund-Job `grounding.page` (`lib/dt/seo/grounding-run/`, `lib/jobs/handlers/grounding-page.ts`): **1 Fakten sammeln** (Anbieter-Fragebogen und Gespräche, Onboarding, gecrawlte Website-Seiten, bestehende Live-Seite, Wunschkunden-Wortwahl → Faktenbasis mit Quelle je Fakt; beim Hub zusätzlich Vorschläge für Entitätsseiten), **2 Faktencheck** (Befunde mit Vorschlag; hält mit „Braucht Sie“ an, wenn nur der Kunde eine Frage beantworten kann – Antworten im Tab eintragen oder „Ohne Antworten weiter“, dann bleiben unbelegte Fakten weg), **3 Seite bauen** (vollständige HTML-Datei: H1 = Entität, Lead, H2 mit Entitätsnamen, `<dl class="data-grid">`, Quellen und Stand, JSON-LD-Spiegelung, Standard-Zeile v1.6, kein Prüfhinweis), **4 Endprüfung** (Checkliste des Standards, korrigiert selbst, nennt, was ein Mensch prüfen muss). Danach steht die Seite auf „Entwurf fertig“: HTML-Datei und `llms.txt` herunterladen (`/api/dt/seo/grounding/pages/[id]/export`), auf der Website einfügen, Fakten prüfen, „Freigabe dokumentieren“. Vorgeschlagene Entitätsseiten legt ein Klick an; „Mit Anmerkung neu bauen“ wiederholt ab Schritt 3, „Neu erstellen“ beginnt von vorn. Zustände wie bei Texte: „Entwurf läuft“, „Pausiert“ (mit Grund, „Weiterlaufen lassen“), „Braucht Sie“, „Entwurf fertig“; ein toter Job wird beim Laden des Tabs repariert. Ergebnisse: `dt_grounding_pages` (Faktenbasis, Fragen, Befunde, HTML, Kosten) und `dt_grounding_steps` — **Migration `database/migrations/20261013_dt_grounding_drafts.sql` einmal ausführen**, sonst meldet der Tab das mit Dateinamen. Schlüssel: `ANTHROPIC_DT_GROUNDING_API_KEY`, sonst `ANTHROPIC_DT_CONTENT_API_KEY`, sonst `ANTHROPIC_API_KEY`; Modell wie Texte (`content_model` / `content_check_model`), Überschreibung mit `ANTHROPIC_DT_GROUNDING_MODEL`. Jeder Schritt schreibt Tokens und Kosten in `dt_grounding_steps` und `dt_llm_usage_events` (`mode = grounding.<Schritt>`).
- **Website-Abgleich („Website prüfen“)**: Job `seo.grounding_check` (`lib/dt/seo/grounding-check/`, `lib/jobs/handlers/seo-grounding-check.ts`), ein Lauf je Zeile in `dt_grounding_runs`, höchstens einer gleichzeitig je Firma. Vier Schritte, jeder an der Zeile gespeichert; was nicht mehr in den Worker-Aufruf passt, läuft beim nächsten weiter. **1 Website lesen**: Grounding Page über den Hub, sonst Footer-Link und übliche Pfade; llms.txt; höchstens 35 Seiten derselben Domain (Startseite, Impressum, Kontakt, Über uns, Team, Leistungen mit direkten Unterseiten, Standorte, FAQ, Referenzen; Links aus dem Hauptmenü zählen als Leistungen). Zeilen aus `dt_site_pages`, die jünger als 7 Tage sind, werden genommen, der Rest live geladen; das Impressum immer, obwohl die SEO-Analyse es auslässt. Jede Anfrage und jede Weiterleitung läuft durch `checkSafePublicUrl`. **2 Fakten erfassen** (Claude): Entitäten mit Klasse der Ontologie V2 und Schema.org-Typ, jeder Fakt mit Quell-URL und wörtlichem Zitat; die App prüft, dass das Zitat auf der Seite steht, sonst wird daraus ein offener Punkt. Fragebogen, Onboarding und Wunschkunden-Wissen dienen nur als Gegenprobe. **3 Vergleichen**: die bestehende Seite (JSON-LD, `<dl>`-Listen, FAQ) und ihre llms.txt werden ins selbe Faktenmodell gelesen; Telefon, E-Mail, URLs, Adressen, Daten, Personen und Leistungen vergleicht der Code, Claude nur die Bedeutung von Beschreibungen und FAQ. Dazu die Befunde zum Standard v1.7 (fehlende Prüfangaben, alte Einleitungsbox, „Konfidenz“, fehlende Abgrenzung oder FAQ, JSON-LD ohne Gegenstück auf der Seite). Ergebnis: `create`, `update_required`, `refresh_only` oder `up_to_date`. **4 Entwurf**: grounding.html aus einer Vorlage (statisch, ohne JavaScript, JSON-LD mit Organization `<origin>/#organization`, LocalBusiness, Person, Service, FAQPage, BreadcrumbList, WebPage) und llms.txt im Hausstil von sichtbarkeitsmeister.de/llms.txt; Claude schreibt nur Titel, Meta-Description und Einleitung. Danach prüft der Code die Dateien. Die Regeln des Standards stehen an einer Stelle: `lib/dt/prompts/grounding-page-standard.ts`. Modell `ANTHROPIC_DT_GROUNDING_MODEL`, sonst `ANTHROPIC_DT_SEO_MODEL`; Schlüssel wie beim Grounding-Agenten; Tokens in `dt_llm_usage_events` (`mode = grounding_check.<Schritt>`). Automatisch: pg_cron `dt_grounding_schedule_daily` stellt täglich den Job `seo.grounding_schedule` an. Er startet eine Prüfung, wenn der Hub bald fällig, überfällig oder ohne Datum ist oder es keine Grounding Page gibt, und kein Lauf offen ist (läuft, Entwurf, freigegeben). Je Fälligkeitsfenster gibt es einen Lauf, eine überfällige Seite wird monatlich erneut geprüft, eine Firma ohne Seite alle drei Monate; höchstens 10 je Tag.
- **Schalter „Grounding Page“ im SEO-Chat** (Kopfzeile, `lib/dt/prompts/grounding-mode.ts`): für Bestand, Faktenlage, Planung der Entitätsseiten und Fragen zur Freigabe. Die Seite selbst baut der Chat nicht; er verweist auf „Entwurf erstellen“ im Tab. Der Schalter wird per `groundingMode` an `/api/dt/chats/[chatId]/messages`, `/api/dt/ghost/chat`, n8n und den Agent-Kontext (`groundingMode=1`) übergeben; „Text“ und „Grounding Page“ schließen sich aus. Der Tab öffnet den Chat mit `?tab=chat&grounding=1`.
- **Tab Grounding**: Status, Hub, Entitätsseiten, llms.txt, je Seite der Entwurf des Agenten. Menschliche Schritte: „Von Seite lesen“, Fragen beantworten, „Freigabe dokumentieren“ (Prüfer + Prüfdatum) und „Entfernen“.
- **Soft-404**: Leitet eine Website unbekannte Pfade (z. B. `/grounding/`) mit Status 200 auf die Startseite um, gilt das nicht als Fund. Die Startseite kann nicht als Grounding Page erfasst werden, und „Von Seite lesen“ übernimmt kein Datum von einer Weiterleitung auf die Startseite.

### Websuche im SEO-Chat

Der SEO-Chat hat Anthropics serverseitige **Websuche** und **Web-Abruf** (`lib/dt/seo/web-research.ts`). Sie laufen bei Anthropic, es gibt keinen eigenen Such-Loop. Gedacht für Nachfrage außerhalb der Avatare, Mitbewerber, die aktuelle Version des Grounding Page Standards und Branchenrecht; für die eigene Website bleiben die Crawl-Werkzeuge zuständig.

- **Limit**: höchstens 10 Websuchen und 5 Web-Abrufe pro KI-Antwort. Ist das Limit erreicht, hängt der Chat einen festen Hinweis an die Antwort, dass weitere Suchen in dieser Antwort nicht möglich waren und eine neue Nachricht das Limit zurücksetzt. Der Hinweis kommt aus dem Code, nicht vom Modell.
- **Quellen**: Zitierte Treffer erscheinen als Liste „Quellen (Websuche)“ unter der Antwort.
- **Kosten**: 10 $ je 1.000 Suchen zusätzlich zu den Tokens, also höchstens 0,10 $ Suchgebühr pro Antwort; Web-Abruf kostet nur Tokens. Die Anzahl steht je KI-Antwort in `dt_llm_usage_events` (Migration `database/migrations/20261013_dt_llm_usage_web_search.sql`) und unter Token-Nutzung als eigene Kachel, in der Kostenschätzung und im Tages-Tooltip.

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

Diese Job-Arten gibt es:

| Art | Was sie tut |
|---|---|
| `seo.crawl` | Arbeitet die Warteschlange der Website-Prüfung ab. |
| `leadinfo.normalize` | Macht aus einem rohen Leadinfo-Ereignis einen lesbaren Eintrag. |
| `grounding.page` | Erstellt eine Grounding Page unter **SEO Modus → Grounding** in vier Schritten (1 Fakten sammeln, 2 Faktencheck, 3 Seite bauen, 4 Endprüfung); hält an, wenn der Faktencheck Fragen an den Kunden hat, und endet mit der HTML-Datei zur menschlichen Prüfung. Ergebnisse in `dt_grounding_pages` und `dt_grounding_steps`. |
| `seo.grounding_check` | Website-Abgleich unter **SEO Modus → Grounding** („Website prüfen“): Website lesen, Fakten erfassen, mit der Grounding Page vergleichen, bei Bedarf Entwurf (grounding.html und llms.txt) zur menschlichen Prüfung. Ergebnisse in `dt_grounding_runs`. Veröffentlicht nichts. |
| `seo.grounding_schedule` | Täglicher Durchlauf (pg_cron `dt_grounding_schedule_daily`): stellt für fällige Firmen ohne offenen Lauf eine automatische `seo.grounding_check` an. |
| `content.page` | Schreibt den Text einer Seite unter **Verwaltung → Texte**: so viele Schritte, wie in einen Aufruf passen (1 Analyse, 2 SEO, 3 Faktencheck, 4 GEO, 5 Hormozi, 6 Vermenschlichung, 7 Lektorat, 8 Watermark Entfernung, 9 Endabnahme), dann stellt er sich für den Rest wieder an. Er hält an, sobald eine Angabe fehlt (Fragen des Faktenchecks oder ein Platzhalter im Text, „Braucht Sie“), und nach der Endabnahme bis zur Freigabe. Jeder Fehler – auch ein unterbrochener Worker – zählt als Versuch; nach drei Versuchen pausiert die Seite mit Grund. Ergebnisse liegen in `dt_content_pages` und `dt_content_steps`. Fakten kommen aus dem Anbieter-Fragebogen und aus den ausgewerteten Gesprächen. |

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
| Texte-Seite steht auf „Wartet … auf den Start“ | Gleiche Ursache wie beim Crawl: `app_settings` und `JOBS_WORKER_TOKEN`. Steht dort „erneuter Versuch“ oder „Fehler in Schritt“, steht der Grund daneben (`ANTHROPIC_DT_CONTENT_API_KEY`, Ratenlimit, Zeitlimit). |
| „Website prüfen“ bleibt auf „Prüfung läuft“ | Gleiche Ursache wie beim Crawl: `app_settings` und `JOBS_WORKER_TOKEN`. Ein abgebrochener Job wird beim nächsten Laden als „Fehlgeschlagen“ mit Grund angezeigt; danach neu starten. |
| Freigabe im Website-Abgleich geht nicht | Die technische Prüfung meldet einen Fehler (z. B. Fakt im HTML, der im JSON-LD fehlt). Die Meldung steht über der Vorschau; im HTML korrigieren oder die Fakten neu erzeugen. |
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
| `app/api/ai/` | DigitalTwin-Hilfe (Chat-Routen, früher Fragebogen-Assistent). |
| `app/api/surveys/` | Aus einer Antwort einen Avatar machen, nachschärfen, auf SEO anwenden. |
| `app/api/notifications/` | Die zwei Fragebogen-Mails. |
| `app/api/jobs/run` | Nimmt den Anruf der Datenbank-Uhr entgegen. |
| `app/api/integrations/leadinfo/` | Empfängt Leadinfo. |

### Die Logik dahinter (`lib/`)

| Ordner | Einfach gesagt |
|---|---|
| `lib/supabase/` | Verbindung zur Datenbank: Browser, Server, Service-Role, Türsteher. |
| `lib/dt/` | DigitalTwin: Chat, Avatare, Prompts, Onboarding, SEO, Transkripte. |
| `lib/dt/seo/` | SEO-Berichte, Crawl, Search Console, Aufgaben, Grounding (`grounding-check/` ist der Website-Abgleich). |
| `lib/dt/onboarding/` | Onboarding inklusive Verschlüsselung der Zugangsdaten. |
| `lib/ai/` | DigitalTwin-Hilfe, Fragebogen-Aktionen und Claude-Helfer. `lib/help/` hält das Handbuch des Assistenten. |
| `lib/surveys/` | Fragebogen-Regeln, Typen, Speichern. |
| `lib/email/` | SMTP, Vorlagen, Einladung, Willkommen, Versand-Protokoll. |
| `lib/jobs/` | Die Hintergrund-Jobs und die Warteschlange. |
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
