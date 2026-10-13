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

/**
 * A turn that only asks for the current Grounding status.
 * Answered from the saved pages, without a model round-trip.
 */
export function isGroundingStatusRequest(text: string): boolean {
  const t = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!t || isGroundingHtmlBuildRequest(text)) return false;
  if (
    /welche fakten|fakten fehlen|welche entit[aä]t|entit[aä]tsseiten sollten|erkl[aä]r|freigabe nach|schritt für schritt|schritt fuer schritt/.test(
      t,
    )
  ) {
    return false;
  }
  if (/agent-stand|stand des entwurfs|entwurf.*\bstand\b|\bstand\b.*entwurf/.test(t)) return true;
  if (/\bstatus\b/.test(t) && /grounding|seite|entwurf|html|agent/.test(t)) return true;
  if (/(prüf|pruef)/.test(t) && /grounding/.test(t) && /(status|stand|seite|website)/.test(t)) {
    return true;
  }
  if (/(prüf|pruef)/.test(t) && /html/.test(t) && /(fertig|stand|status)/.test(t)) return true;
  return false;
}
