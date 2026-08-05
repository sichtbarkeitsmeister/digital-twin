# Indexierung & Indexierbarkeit

## Was der SEO-Berater heute kann

| Werkzeug | Antwortet auf |
|----------|---------------|
| `read_sitemap` | Welche URLs stehen in der Sitemap? Abgleich mit dem Crawl-Index |
| `inspect_website_url` | Eine URL live: HTTP-Status, Meta-Robots, Canonical |
| `audit_site_indexability` | Viele URLs auf einmal: HTTP-Fehler, `noindex`, fremdes Canonical, Weiterleitungen |
| `read_index_status` | Gespeicherte Google-URL-Inspection-Stichproben (GSC) |
| `request_gsc_index_check` | Startet eine asynchrone GSC-URL-Inspection-Stichprobe über n8n |

`audit_site_indexability` nimmt die URLs aus der Sitemap, ersatzweise aus dem Crawl-Index, und prüft standardmäßig 15 (max. 30) davon parallel. Es gibt ein Zeitbudget von 20 Sekunden, damit der Aufruf innerhalb der Chat-Route bleibt; wird es erreicht, meldet das Ergebnis offen, wie viele URLs ungeprüft blieben.

Damit lässt sich die Frage „warum ist Seite X nicht bei Google?" zum technischen Teil beantworten: Ist die Seite erreichbar, erlaubt sie Indexierung, zeigt das Canonical auf sich selbst.

## Warum es keinen GSC-Coverage-Sync gibt

Die Search-Console-API stellt den Coverage-/Indexierungsbericht **nicht** bereit. Verfügbar sind nur:

- `searchanalytics.query` — Klicks, Impressionen, CTR, Position (nutzen wir bereits im Report und in der Monatsstatistik)
- `urlInspection.index.inspect` — Indexstatus **einer** URL pro Aufruf, 2.000 Aufrufe pro Tag und Property, rund 2–3 Sekunden pro Aufruf
- `sitemaps.*` — eingereichte Sitemaps und ihr Verarbeitungsstatus
- `sites.*` — Properties

Es gibt keinen Endpunkt, der „alle nicht indexierten Seiten" liefert. Ein „Coverage-Sync" ist deshalb technisch nicht möglich.

## Google-Indexstatus per URL-Inspection (Stichprobe)

Umgesetzt als erste Slice:

1. **Tabelle** `dt_seo_url_index_status` — pro Organisation/URL der letzte Inspection-Stand.
2. **Ingest** `POST /api/dt/internal/seo-url-index-status` — n8n schreibt Ergebnisse.
3. **n8n-Workflow** `DT v2 - GSC URL Inspection` — Webhook `dt-gsc-url-inspection`, nutzt bestehende GSC-OAuth-Konten (`ads@` / `ads2@`).
4. **Chat-Tools** `read_index_status` / `request_gsc_index_check`.

### Deploy

```bash
node scripts/deploy-dt-v2-gsc-url-inspection.mjs
# oder: npm run dt:n8n:gsc-url-inspection
```

Danach in Vercel setzen:

```bash
N8N_DT_GSC_URL_INSPECTION_WEBHOOK=https://sichtbarkeitsmeister.app.n8n.cloud/webhook/dt-gsc-url-inspection
```

Chat-Tools über den n8n-Pfad brauchen zusätzlich den üblichen Chat-Deploy (`npm run dt:n8n:chat`).

### Grenzen

- Kein vollständiger Coverage-Bericht
- Tageslimit ~2.000 Inspections pro Property
- Stichproben standardmäßig max. 10–20 URLs pro Lauf
