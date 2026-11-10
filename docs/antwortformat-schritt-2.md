# Antwortformat von Schritt 2 (SEO)

Stand: 10.11.2026, Commit `7f788f4`. Quelle: `lib/dt/content/pipeline/prompts.ts` (`seo()`, `TEXT_TOOL_SCHEMA`, `TEXT_PROPERTIES`, `BLOCKS_SCHEMA`) und `lib/dt/content/pipeline/llm.ts` (`callContentTool`).

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
        "description": "Der komplette Text als geordnete Abschnitte. Der erste Abschnitt trägt die H1 (level 1), danach H2 (level 2), bei Bedarf H3 (level 3). Bestehende ids beibehalten.",
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
              "enum": [1, 2, 3]
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

## Was der Code mit der Antwort macht

1. Die Antwort wird gestreamt und aus den JSON-Teilstücken zusammengesetzt (`readAnthropicMessageStream` in `lib/ai/anthropic-helpers.ts`). Ein unvollständiges JSON wird dabei geschlossen (`closeTruncatedJsonObject`): offener String zu, fehlende Klammern ergänzt.
2. `reviveStringifiedToolInput` liest `blocks` zurück, falls das Modell die Liste als JSON-Zeichenkette geschickt hat.
3. `normalizeTextOutput` übernimmt `blocks`, `title` (höchstens 200 Zeichen) und `meta_description` (höchstens 400 Zeichen). Eine leere Abschnittsliste lässt den bisherigen Text stehen.
4. `ensureHeroPlaceholder` setzt den ersten Abschnitt auf H1 und fügt direkt danach den Hero-Platzhalter ein.

## Größe des Formats

Das Schema selbst kostet nur wenige hundert Eingabe-Tokens. In der Ausgabe kommt zum reinen Text der JSON-Rahmen dazu: je Abschnitt `id`, `heading`, `level`, die HTML-Tags und die JSON-Maskierung von Anführungszeichen. Als Faustwert rechnet der Code mit etwa drei Zeichen je Ausgabe-Token (`scripts/test-content-step-budgets.ts`).
