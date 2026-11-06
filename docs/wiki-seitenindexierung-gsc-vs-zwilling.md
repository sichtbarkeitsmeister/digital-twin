# Seitenindexierung: Google Search Console vs. Digital Twin

Wiki-Text zum Kopieren nach Confluence. Zielgruppe: Beratung, SEO, Support.

---

## Kurz gesagt

Die Ansicht **Seitenindexierung** im Digital Twin **sieht aus wie** die Search Console, **misst aber etwas anderes**.

- **Search Console** = aktueller Google-Index inkl. aller URLs, die Google je gefunden hat, mit echten Ausschlussgründen.
- **Digital Twin** = unser Website-Crawl plus die **Leistungsdaten der letzten 90 Tage** (Impressionen, Klicks, Position).

Die Zahlen dürfen und werden voneinander abweichen. Das ist kein Fehler im Crawl, sondern eine API-Grenze von Google.

---

## Was die Search Console zeigt

Pfad in GSC: **Indexierung → Seiten** („Seitenindexierung“).

Filter typischerweise: **Alle bekannten Seiten**.

| Block | Bedeutung |
| --- | --- |
| **Indexiert** | Diese URL steht **jetzt** im Google-Index. |
| **Nicht indexiert** | Google kennt die URL, nimmt sie aber **aktuell nicht** in den Index. |
| **Warum Seiten nicht indexiert werden** | Googles Ausschlussgrund, z. B. „Seite mit Weiterleitung“, „Serverfehler (5xx)“, Duplicate, Soft-404, noindex. |

Die Grundgesamtheit sind **alle URLs, die Google historisch entdeckt hat** — auch tote Pfade, alte http-Varianten, Weiterleitungsquellen und Fehler-URLs, die in unserem aktuellen Crawl gar nicht mehr vorkommen.

---

## Was der Digital Twin zeigt

Pfad: SEO → Crawl / **Seitenindexierung**.

Beim Crawlen ziehen wir drei Quellen zusammen:

1. Sitemap (bei WordPress/Rank Math oft `sitemap_index.xml`, nicht das HTML-`sitemap.xml`)
2. interne Links der Website
3. Search-Console-**Leistungsdaten**, Dimension `page`, **letzte 90 Tage** (Workflow *DT v2 - GSC Pages*)

| Badge im Twin | Bedeutung bei uns |
| --- | --- |
| **Indexiert** | Genau diese URL kommt in den GSC-Leistungsdaten vor (Google hat sie in den letzten 90 Tagen gezeigt) **oder** eine gespeicherte URL-Inspection sagt PASS / indexed. |
| **Nicht indexiert** | URL ist bei uns bekannt (Crawl), aber **ohne Impressionen** in den 90 Tagen. |
| **Seite mit Weiterleitung** | Unser Crawler ist der Weiterleitung gefolgt (`final_url` weicht ab) oder http/www-Variante. |
| **Gecrawlt – derzeit nicht indexiert** | Wir haben die Seite gelesen, Google hat sie in 90 Tagen nicht in den Suchergebnissen gezeigt. Das ist **nicht** Googles Coverage-Grund. |

Impressionen und Klicks hängen nur an der **indexierten Ziel-URL**, nicht an Redirect-Varianten.

---

## Warum die Zahlen auseinanderlaufen

### 1. Andere Grundgesamtheit

GSC zählt **bekannte URLs bei Google**. Der Twin zählt **URLs aus unserem letzten Crawl** (plus GSC-Leistungs-URLs, die wir mitgeladen haben).

Alte Weiterleitungen, gelöschte Pfade und Fehler-URLs stehen oft nur in GSC. Deshalb ist „Nicht indexiert“ in GSC fast immer **größer**.

### 2. Andere Definition von „Indexiert“

| | Search Console | Digital Twin |
| --- | --- | --- |
| Frage | Steht die URL **heute** im Index? | Hatte die URL in **90 Tagen** Impressionen? |
| Folge | Eine URL kann Impressionen haben und trotzdem schon nicht mehr indexiert sein. | Eine URL ohne Impressionen kann trotzdem indexiert sein (neu, kaum Nachfrage, noch keine Daten). |

Deshalb kann der Twin **mehr Indexierte** zeigen als GSC (Restimpressionen) oder **weniger** (indexiert, aber ohne Traffic).

### Warum nur 90 Tage — und nicht 16 Monate?

Die Search-Analytics-API speichert Daten etwa **16 Monate**. 90 Tage sind keine Google-Grenze, sondern unsere Wahl, analog zum SEO-Report („Letzte 90 Tage“) und zur GSC-Leistungsansicht.

Ein **breiterer** Zeitraum würde die Lücke zur Search Console **nicht schließen**, sondern oft **vergrößern**:

- URLs, die vor 8 Monaten Impressionen hatten und inzwischen **nicht mehr indexiert** sind, würden bei uns weiter als „Indexiert“ zählen. Genau das sehen wir schon bei 90 Tagen (Existenzstand: 170 vs. 150).
- Die API liefert max. **25.000 Zeilen** pro Abfrage (`dimension=page`). Auf großen Properties füllt ein 16-Monats-Fenster dieses Limit mit alten URLs und verdrängt aktuelle.
- Saisonale Seiten (nur im Dezember sichtbar) fehlen in 90 Tagen — das ist der einzige klare Vorteil eines längeren Fensters. Dann wären sie trotzdem nur „irgendwann gezeigt“, nicht „heute im Index“.

Sinnvoller als „einfach länger ziehen“:

| Ziel | Besserer Weg |
| --- | --- |
| Aktueller Indexstand | URL-Inspection (Stichprobe), nicht mehr Performance-Monate |
| Alte URLs im Crawl finden | Längeres Fenster nur als **Seed**, ohne sie automatisch „Indexiert“ zu nennen |
| Kundengespräch | 90 Tage belassen und den Unterschied zu GSC erklären |

### 3. Google liefert den Coverage-Bericht nicht per API

Verfügbar in der Search-Console-API:

- Leistungsdaten (`searchanalytics.query`) — das nutzen wir
- URL-Inspection **einer** URL pro Aufruf (Quota, langsam) — nur Stichproben
- Sitemaps / Properties

**Nicht** verfügbar: die Tabelle „Warum Seiten nicht indexiert werden“ mit allen URLs und Gründen.

Ohne diesen Bericht können wir 5xx, Soft-404, Duplicate, „von Google entfernt“ usw. nicht 1:1 nachbauen. Was wir nicht erkennen, landet bei uns unter **Gecrawlt – derzeit nicht indexiert**.

---

## Beispiel: Existenzstand (Oktober 2026)

| | Google Search Console | Digital Twin |
| --- | --- | --- |
| Indexiert | 150 | 170 |
| Nicht indexiert | 291 | 66 |
| Seiten gesamt | 441 bekannte URLs | 236 gecrawlte URLs |
| Weiterleitung | 84 | 5 (nur die, denen unser Crawler gefolgt ist) |
| Serverfehler (5xx) | 3 | — (kein Coverage-Feed) |
| Übrige GSC-Gründe | 4 weitere Gründe | bei uns: 61 × „Gecrawlt – derzeit nicht indexiert“ |

Lesen: Google kennt ~200 URLs mehr als unser Crawl (vor allem alte/weitergeleitete). Die 170 „Indexiert“ im Twin sind 90-Tage-Impressionen, nicht die 150 aktuell indexierten URLs.

---

## Formulierung für Kundengespräche

> Die Ansicht im Twin nutzt dasselbe Layout wie die Search Console, damit man sich zurechtfindet. Die **Kennzahlen sind aber nicht der Coverage-Bericht**.  
> GSC zeigt den **aktuellen Google-Index**. Der Twin zeigt: Welche Seiten haben wir gecrawlt, und welche davon hat Google in den letzten 90 Tagen in den Suchergebnissen ausgespielt?  
> Für den verbindlichen Indexstand und die Ausschlussgründe bleibt die Search Console die Quelle. Den Twin nutzen wir für Inhalt, Weiterleitungen, die wir live sehen, und Performance pro URL.

Nicht sagen: „Bei uns sind 170 indexiert, GSC irrt.“  
Nicht sagen: „Der Crawl ist falsch, weil die Zahlen nicht passen.“

---

## Was wir tun können — und was nicht

**Können**

- Website crawlen (Titel, H1, Meta, Volltext, Redirect-Ziel)
- Leistungsdaten je URL (90 Tage) danebenlegen
- einzelne URLs per URL-Inspection stichprobenartig prüfen (Quota ~2.000/Tag/Property)
- live prüfen: HTTP-Status, noindex, Canonical (`inspect_website_url` / Indexierbarkeits-Audit)

**Können nicht**

- den GSC-Bericht „Seitenindexierung“ 1:1 per API spiegeln
- alle 441 bekannten Google-URLs mit denselben sechs Ausschlussgründen liefern, ohne jede URL einzeln zu inspizieren

Technische Details für Entwickler: `docs/seo-indexierung.md`.
