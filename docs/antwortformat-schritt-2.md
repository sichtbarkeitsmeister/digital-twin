# Antwortformat von Schritt 2 (SEO)

Stand: 10.11.2026, Branch `claude/texte-abbruch-analyse` (nach Abbruch-Fix und H4). Quelle: `lib/dt/content/pipeline/prompts.ts` (`seo()`, `TEXT_TOOL_SCHEMA`, `TEXT_PROPERTIES`, `BLOCKS_SCHEMA`) und `lib/dt/content/pipeline/llm.ts` (`callContentTool`).

## Wie das Format an den Aufruf kommt

Das Antwortformat steht nicht als Text im Prompt. Es wird als Werkzeug (Tool) mitgeschickt, und das Modell muss genau dieses Werkzeug aufrufen:

- `tools: [submit_seo_text]`
- `tool_choice: { "type": "tool", "name": "submit_seo_text" }`

Die Antwort ist damit ein JSON-Objekt (`tool_use.input`), kein Fließtext. Der ganze Seitentext steckt als HTML in den Feldern `blocks[].html`.

Lehnt ein Modell die erzwungene Werkzeugwahl ab (HTTP 400), wiederholt der Code den Aufruf mit `tool_choice: { "type": "auto" }` und hängt diesen einen Satz an den System-Prompt an:

> Antworte ausschließlich, indem du das Werkzeug „submit_seo_text“ genau einmal aufrufst.

## Das Werkzeug, vollständig

```json
{
  "name": "submit_seo_text",
  "description": "Der vollständige Seitentext in Abschnitten, mit Title und Meta-Description.",
  "input_schema": {
    "type": "object",
    "properties": {
      "title": {
        "type": "string",
        "description": "Title-Tag, max. 60 Zeichen. Leer lassen, wenn unverändert."
      },
      "meta_description": {
        "type": "string",
        "description": "Meta-Description, max. 155 Zeichen. Leer lassen, wenn unverändert."
      },
      "blocks": {
        "type": "array",
        "description": "Der komplette Text als geordnete Abschnitte. Der erste Block (id hero) trägt die kurze SEO-H1 (level 1, html darf leer sein), der zweite (id zusammenfassung) die Hero-Überschrift als H2. Danach H2 (level 2), bei Bedarf H3 (level 3) und H4 (level 4). Bestehende ids beibehalten.",
        "items": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "description": "Kurze, stabile Kennung in Kleinbuchstaben, z. B. hero, zusammenfassung, einleitung, ablauf. Bestehende ids beibehalten."
            },
            "heading": {
              "type": "string",
              "description": "Überschrift ohne HTML. Leer, wenn der Abschnitt keine hat."
            },
            "level": {
              "type": "integer",
              "enum": [1, 2, 3, 4]
            },
            "html": {
              "type": "string",
              "description": "Fließtext als HTML mit <p>, <ul>/<ol>/<li>, <strong>, <em>. Keine Überschrift hier, kein <section>, kein <div>, keine <a>-Tags (interne Links als [LINK: Seitenname])."
            }
          },
          "required": ["id", "heading", "level", "html"]
        }
      }
    },
    "required": ["title", "meta_description", "blocks"]
  }
}
```

## Dieselbe Abschnittsliste in den anderen Werkzeugen

`blocks` hat überall dieselben Felder (`BLOCKS_SCHEMA`), also auch `level` 1 bis 4. Nur die Beschreibung von `blocks` ist bei `submit_seo_text` eigen (Reihenfolge hero, zusammenfassung). Dieselben Felder haben: `submit_geo_text`, `submit_hormozi_text`, `submit_vermenschlichung_text` (zusätzlich `self_score`), `submit_lektorat` (zusätzlich `final_findings`), das Ergebnis der Aktualitätsprüfung, „Antworten einarbeiten“ und die Werkzeuge SEO, GEO und Hormozi unter Verwaltung.

## Was der Code mit der Antwort macht

1. Die Antwort wird gestreamt und aus den JSON-Teilstücken zusammengesetzt (`readAnthropicMessageStream` in `lib/ai/anthropic-helpers.ts`).
2. **Erst wird geprüft, ob die Antwort fertig ist** (`callContentTool`). `stop_reason: max_tokens` → der Schritt schlägt fehl mit „Ausgabe abgeschnitten (Token-Limit)“. Kein `stop_reason`, weil das Zeitlimit den Stream gekappt hat → „Ausgabe unvollständig (Zeitlimit erreicht)“, eine Wiederholung, danach hält die Seite an. Eine abgeschnittene Antwort wird nie als Text übernommen, auch wenn sich ihr JSON schließen lässt.
3. `reviveStringifiedToolInput` liest `blocks` zurück, falls das Modell die Liste als JSON-Zeichenkette geschickt hat.
4. `normalizeTextOutput` übernimmt `blocks`, `title` (höchstens 200 Zeichen) und `meta_description` (höchstens 400 Zeichen). Höchstens 120 Abschnitte; mehr lässt den Schritt fehlschlagen („Zu viele Abschnitte (Grenze erreicht)“), es wird nie still gekürzt. Je Abschnitt höchstens 30.000 Zeichen HTML; ein längerer lässt den Schritt fehlschlagen („Abschnitt zu lang (Grenze erreicht)“), auch hier wird nie gekürzt. Eine leere Abschnittsliste lässt den bisherigen Text stehen.
5. `level`: Der erste Abschnitt behält seine Ebene (ohne Angabe wird er 1). Danach bleiben 2, 3 und 4; ein weiteres `level` 1 wird 2, damit es nur eine H1 gibt.
6. `ensureHeroPlaceholder` ändert keine Ebene. Ist `hero` die H1 (aktuelle Textvorlagen), bleibt der Text, wie er ist. Nach der älteren Vorlage (hero als Platzhalter unter der H1) setzt es den Platzhalter direkt nach den ersten Abschnitt.
7. Hat der Text keinen Abschnitt mit `level` 1, meldet der Schritt den offenen Punkt „H1 fehlt“; keine andere Überschrift wird hochgestuft.
8. Ein Abschnitt mit Überschrift und leerem `html` (die SEO-H1) bleibt in Anzeige, Speicher und allen Exporten erhalten.

## Abschnitt ohne Überschrift

Ein Abschnitt mit leerer `heading` wird ohne Überschrift gespeichert: `<section data-block-id="…">` mit dem Text, ohne `<h…>`-Tag. Im Seitenfenster, im HTML-, Markdown- und Text-Export steht dann nur der Text; die nächsten Schritte lesen ihn als `[Abschnitt id]` mit dem Text. Seine Ebene spielt keine Rolle und wird beim Zurücklesen 2.

## H4 in Anzeige und Export

Ein Abschnitt mit `level` 4 wird als `<h4>` gespeichert und so wieder gelesen. Seitenfenster: eigene Größe unter H3. HTML-Export: `<h4>`. Markdown: `####`. Text-Export: eigene Zeile wie jede Überschrift. Watermark Entfernung: der Abschnitt geht mit `<h4>` an Grok, zurück kommt nur der Text, Überschrift und Ebene bleiben. Test: `npm run test:content-format-limits`.

## Größe des Formats

Das Schema selbst kostet nur wenige hundert Eingabe-Tokens. In der Ausgabe kommt zum reinen Text der JSON-Rahmen dazu: je Abschnitt `id`, `heading`, `level`, die HTML-Tags und die JSON-Maskierung von Anführungszeichen. Als Faustwert rechnet der Code mit etwa drei Zeichen je Ausgabe-Token (`scripts/test-content-step-budgets.ts`). Schritt 2 hat 16.000 Ausgabe-Tokens (`TEXT_STEP_MAX_TOKENS`).
