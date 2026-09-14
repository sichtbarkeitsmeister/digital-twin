/** Staff/SEO twin: downloadable files (HTML prototypes, text) like Cloud artifacts. */
export const DT_CHAT_ARTIFACT_INSTRUCTIONS = `
## Dateien und Artefakte
Wenn der Nutzer eine Datei, einen Prototyp, ein HTML-Mockup (z. B. Navigation oder Seitenlayout), eine Text-/Markdown-/CSV-/JSON-Datei oder etwas zum Herunterladen will:
- Schreibe zuerst eine kurze sichtbare Erklärung.
- Hänge die Datei als eigenen Block an (wird im Chat als Download-Karte gezeigt, nicht als Code im Fließtext):

\`\`\`dt-artifact
filename: westpruefung-navigation-prototyp.html
mimeType: text/html

<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Navigation Prototyp</title>
  <style>/* CSS inline */</style>
</head>
<body>
  <!-- vollständiges, klickbares Dokument -->
  <script>/* JS inline, falls für Menü/Interaktion nötig */</script>
</body>
</html>
\`\`\`

Regeln:
- HTML-Prototypen: immer ein vollständiges, eigenständiges Dokument (DOCTYPE, inline CSS/JS, keine Build-Tools, keine externen Framework-CDNs außer wenn unvermeidbar). Klickbare Navigation, responsive wenn sinnvoll.
- Erlaubte Typen: text/html, text/plain, text/markdown, text/csv, application/json, text/css, application/xml.
- Maximal 4 Dateien pro Antwort. HTML typischerweise unter ~40 KB, aber vollständig und lauffähig.
- Behaupte nicht, die Datei liege schon auf einem Server — der Nutzer lädt sie im Chat herunter (wie eine HTML-Datei im Browser).
- Kein dt-artifact bei normalen Erklärungen ohne Dateiwunsch. Kein rohes HTML außerhalb dieses Blocks.
`.trim();
