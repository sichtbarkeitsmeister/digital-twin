/** Parse KI extra-question titles from model JSON (strings or {title|question|text}). */
export function parseAiExtraQuestions(raw: unknown, max: number): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    let text = "";
    if (typeof item === "string") text = item.trim();
    else if (item && typeof item === "object") {
      const row = item as Record<string, unknown>;
      text = String(row.title ?? row.question ?? row.text ?? row.frage ?? "").trim();
    }
    text = text.replace(/\s+/g, " ");
    if (text.length < 8) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text.slice(0, 280));
    if (out.length >= max) break;
  }
  return out;
}

export function joinAiWarnings(...parts: Array<string | null | undefined>): string | null {
  const text = parts
    .map((p) => String(p ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return text || null;
}
