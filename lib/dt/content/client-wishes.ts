/**
 * „Kundenwünsche“: the client's standing wishes for the texts, one per line. The organisation's
 * live in `dt_content_settings.client_wishes`, a page's own in `dt_content_pages.client_wishes`
 * (migration 20261103). Pure, so the cards in the browser and the prompts read them alike.
 */

/** The organisation's and the page's wishes, one per entry (`parseClientWishes`). */
export type ContentClientWishes = { organisation: string[]; page: string[] };

export const CLIENT_WISHES_MAX = 30;
export const CLIENT_WISH_MAX_CHARS = 400;
/** What the textareas accept in all (organisation card, page window). */
export const CLIENT_WISHES_TEXT_MAX = 6_000;

/** One wish per line; bullets and numbering dropped, empty lines and repeats out. */
export function parseClientWishes(text: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of (text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const wish = line.replace(/^\s*(?:[-–•*·]|\d{1,2}[.)])\s*/, "").replace(/\s+/g, " ").trim().slice(0, CLIENT_WISH_MAX_CHARS);
    const key = wish.toLowerCase();
    if (!wish || seen.has(key)) continue;
    seen.add(key);
    out.push(wish);
    if (out.length >= CLIENT_WISHES_MAX) break;
  }
  return out;
}

export function hasClientWishes(wishes: ContentClientWishes | null | undefined): boolean {
  return Boolean(wishes && (wishes.organisation.length > 0 || wishes.page.length > 0));
}

