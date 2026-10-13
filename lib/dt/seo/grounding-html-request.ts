/**
 * Detects a chat turn that asks for the finished Grounding HTML file.
 * That file is built by the background agent; generating it inside the chat
 * request drops the connection.
 */

export function isGroundingHtmlBuildRequest(text: string): boolean {
  const t = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!t.includes("html")) return false;
  const asksToBuild = /erstell|bauen|baue|datei jetzt|direkt im chat|option a|html-datei/.test(t);
  if (!asksToBuild) return false;
  const onlyStatus =
    /stand|status|fortschritt|prüf|pruef/.test(t) && !/erstell|bauen|baue|direkt/.test(t);
  return !onlyStatus;
}
