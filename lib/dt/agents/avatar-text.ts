/**
 * The avatar-specific text of an agent: what the chat lays on the global DigitalTwin prompt,
 * and the part of it that Texte, SEO, GEO and Hormozi read as the avatar's description.
 * Pure and client-safe.
 */

export type AvatarTextSource = {
  name?: string | null;
  role?: string | null;
  prompt_template?: string | null;
  prompt_append?: string | null;
  uses_global_prompt?: boolean | null;
  avatar_data?: unknown;
};

/** The stub left in prompt_template when the avatar's text lives in prompt_append („Avatar: Name“). */
export function isAvatarTextStub(text: string): boolean {
  const t = text.trim();
  return t.length < 120 && (/^Avatar:\s+\S/i.test(t) || t.startsWith("Avatar-spezifischer Teil"));
}

/**
 * The avatar part as the chat uses it: prompt_append on the global DigitalTwin prompt,
 * otherwise the agent's own prompt (same rule as `resolveAvatarSpecificPrompt`).
 */
export function avatarSpecificText(agent: AvatarTextSource): string {
  const append = agent.prompt_append?.trim() ?? "";
  if (agent.uses_global_prompt && append) return append;
  return agent.prompt_template?.trim() || append;
}

/**
 * Blocks that only steer the chat, never the reader of a page: Anrede and channel towards the
 * employee, the date line, rules for the conversation, who talks to the avatar and what it can
 * do in the chat. The anchor to the global prompt is handled on its own (`withoutAnchor`).
 */
const CHAT_ONLY_HEADINGS: readonly RegExp[] = [
  /^ANREDE\b/,
  /^GESPRÄCHSKANAL\b/,
  /^(AKTUELLES )?DATUM\b/,
  /^WICHTIGE VERHALTENSREGELN\b/,
  /^WER MIT DIR SPRICHT\b/,
  /^WAS DU KANNST\b/,
];

const ANCHOR_LINE_RE = /^(dieser text ist nur|die verbindlichen regeln|bei widerspruch gilt)/i;

/**
 * The anchor section without its heading and its three fixed lines. Older avatars go on with
 * their text right below it, without a heading of its own; that text stays.
 */
function withoutAnchor(section: string): string {
  const lines = section.split("\n").slice(1);
  let start = 0;
  while (start < lines.length && (!lines[start]!.trim() || ANCHOR_LINE_RE.test(lines[start]!.trim()))) start += 1;
  return lines.slice(start).join("\n");
}

function headingKey(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleUpperCase("de-DE");
}

/** Older avatars write {{alter}}, {{name_clean}} … into their text; the values sit in avatar_data. */
function placeholderValue(agent: AvatarTextSource, key: string): string | null {
  const data = agent.avatar_data && typeof agent.avatar_data === "object" && !Array.isArray(agent.avatar_data)
    ? (agent.avatar_data as Record<string, unknown>)
    : {};
  const value = data[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  if (key === "name_clean" || key === "name") return agent.name?.trim() || null;
  if (key === "rolle_kurz") return agent.role?.trim() || null;
  return null;
}

/**
 * What Texte, SEO, GEO and Hormozi read as the avatar's description: its avatar part (see
 * `avatarSpecificText`), empty for a stub, without the chat-only blocks, `---` lines and HTML
 * comments, with the placeholders of older avatars filled from avatar_data where it has them.
 */
export function avatarTextForContent(agent: AvatarTextSource): string {
  const text = avatarSpecificText(agent);
  if (isAvatarTextStub(text)) return "";
  // Sections start at a `#` or `##` heading; `###` and bold lines stay inside their section.
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n(?=[ \t]*#{1,2}[ \t])/)
    .map((section) => {
      const heading = section.split("\n", 1)[0]!.match(/^[ \t]*#{1,2}[ \t]+(.+?)[ \t]*$/)?.[1];
      if (!heading) return section;
      const key = headingKey(heading);
      if (/^ANKER\b/.test(key)) return withoutAnchor(section);
      return CHAT_ONLY_HEADINGS.some((re) => re.test(key)) ? "" : section;
    })
    .map((section) => section.replace(/^[ \t]*(?:---|<!--.*?-->)[ \t]*$/gm, "").trim())
    .filter(Boolean)
    .join("\n\n")
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => placeholderValue(agent, key) ?? match);
}
