# SERP Pixel-Checker

Misst Title- und Meta-Description-Breiten für Google-SERP-Snippets.

## Defaults (ohne stabile Google-HTML-Referenz)

| Feld | Schrift (Schätzung) | Limit |
|------|---------------------|-------|
| Title Desktop | Arial 20px | ~600 px |
| Title Mobile | Arial 16px | ~440 px |
| Meta-Description | Arial 14px | ~920 px |

Zeichenzahl ist nur Zusatzinfo — entscheidend sind die Pixel.

## Umsetzung

- Server/n8n: `lib/dt/seo/serp-pixel.ts` (gewichtete Arial-Zeichenbreiten)
- Browser-UI: `canvas.measureText("Arial")` in `DtSeoSerpPixelMeter`, Fallback auf dieselbe Schätzung
- SEO-Chat-Tool: `check_serp_snippet` (direct Anthropic + n8n-Handler)
- UI: Chat-Aufgaben-Vorschläge und Aufgaben-Detail (bei Title-/Description-ähnlichen Texten)

## Follow-up (nicht in diesem Batch)

GSC Coverage / Indexierungsbericht syncen — separat, sobald n8n + Speicherung stehen.
