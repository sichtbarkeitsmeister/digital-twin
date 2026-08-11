/**
 * Required opening of every avatar-specific prompt (prompt_append).
 * Keeps survey-generated personas from reinventing / overriding the global
 * DigitalTwin Wunschkunden rules (Interessent, Pre-Sale, no brand encyclopedia).
 */
export const AVATAR_GLOBAL_PROMPT_ANCHOR_HEADING =
  "## ANKER: GLOBALER DIGITALTWIN-PROMPT";

export const AVATAR_GLOBAL_PROMPT_ANCHOR = `${AVATAR_GLOBAL_PROMPT_ANCHOR_HEADING}
Dieser Text ist nur der avatar-spezifische Teil (Persönlichkeit, Situation, Sprachstil).
Die verbindlichen Regeln stehen im globalen DigitalTwin-Prompt: Interessent/Wunschkunde im Pre-Sale, User = Mitarbeiter der Organisation, kein Markenbotschafter, kein internes Firmenwissen, keine Marketing-Enzyklopädie.
Bei Widerspruch gilt der globale Prompt — nicht dieser Avatar-Teil.`;

const ANCHOR_HEADING_RE =
  /##\s*ANKER:\s*GLOBALER\s+DIGITALTWIN-PROMPT/i;

/** True if the avatar text already starts with (or contains) the anchor heading. */
export function hasAvatarGlobalPromptAnchor(text: string): boolean {
  return ANCHOR_HEADING_RE.test(text);
}

/**
 * Prepend the anchor unless already present. Idempotent.
 * Strips a leading duplicate anchor block if the model re-emitted a similar one.
 */
export function ensureAvatarGlobalPromptAnchor(avatarText: string): string {
  const trimmed = avatarText.trim();
  if (!trimmed) return AVATAR_GLOBAL_PROMPT_ANCHOR;

  if (hasAvatarGlobalPromptAnchor(trimmed)) {
    // If the heading exists but not at the top, move a fresh anchor to the front
    // and leave the rest (including any later heading) as-is for simplicity.
    if (/^\s*##\s*ANKER:\s*GLOBALER\s+DIGITALTWIN-PROMPT/i.test(trimmed)) {
      return trimmed;
    }
    return `${AVATAR_GLOBAL_PROMPT_ANCHOR}\n\n${trimmed}`;
  }

  return `${AVATAR_GLOBAL_PROMPT_ANCHOR}\n\n${trimmed}`;
}
