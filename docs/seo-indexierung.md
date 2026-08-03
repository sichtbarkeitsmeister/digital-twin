# Indexierung & Indexierbarkeit

## Was der SEO-Berater heute kann

| Werkzeug | Antwortet auf |
|----------|---------------|
| `read_sitemap` | Welche URLs stehen in der Sitemap? Abgleich mit dem Crawl-Index |
| `inspect_website_url` | Eine URL live: HTTP-Status, Meta-Robots, Canonical |
| `audit_site_indexability` | Viele URLs auf einmal: HTTP-Fehler, `noindex`, fremdes Canonical, Weiterleitungen |

`audit_site_indexability` nimmt die URLs aus der Sitemap, ersatzweise aus dem Crawl-Index, und prüft standardmäßig 15 (max. 30) davon parallel. Es gibt ein Zeitbudget von 20 Sekunden, damit der Aufruf innerhalb der Chat-Route bleibt; wird es erreicht, meldet das Ergebnis offen, wie viele URLs ungeprüft blieben.

Damit lässt sich die Frage „warum ist Seite X nicht bei Google?" zum technischen Teil beantworten: Ist die Seite erreichbar, erlaubt sie Indexierung, zeigt das Canonical auf sich selbst.

## Warum es keinen GSC-Coverage-Sync gibt

Die Search-Console-API stellt den Coverage-/Indexierungsbericht **nicht** bereit. Verfügbar sind nur:

- `searchanalytics.query` — Klicks, Impressionen, CTR, Position (nutzen wir bereits im Report und in der Monatsstatistik)
- `urlInspection.index.inspect` — Indexstatus **einer** URL pro Aufruf, 2.000 Aufrufe pro Tag und Property, rund 2–3 Sekunden pro Aufruf
- `sitemaps.*` — eingereichte Sitemaps und ihr Verarbeitungsstatus
- `sites.*` — Properties

Es gibt keinen Endpunkt, der „alle nicht indexierten Seiten" liefert. Ein „Coverage-Sync" ist deshalb technisch nicht möglich.

## Realistischer Weg für echten Google-Indexstatus

Wenn der tatsächliche Indexstatus gebraucht wird, führt der Weg über `urlInspection` als Stichprobe:

1. n8n-Workflow mit der bestehenden GSC-OAuth-Credential, der eine priorisierte URL-Liste (Sitemap oder Crawl-Index) durchläuft — wegen des Tageslimits in Etappen.
2. Ergebnisse per interner Route an die App zurück, analog zu `POST /api/dt/internal/seo-monthly-stats`.
3. Speicherung pro URL mit Zeitstempel, dazu ein Werkzeug `read_index_status`, das gespeicherte Daten liest und ehrlich „keine Daten" meldet, solange nichts vorliegt.

Aufwand liegt überwiegend im n8n-Workflow und in der Tageslimit-Logik, nicht in der App.
