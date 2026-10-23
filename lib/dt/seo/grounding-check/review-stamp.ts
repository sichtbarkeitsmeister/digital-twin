/**
 * Date handling of a draft, at string level so an existing page keeps its markup:
 * - applyReview*: at approval, the visible review notice, reviewedBy/lastReviewed in the
 *   WebPage JSON-LD and „Grounding Page Standard v1.7“ (spec: the review date changes only
 *   after a documented review — never at build time);
 * - refreshDates*: for refresh_only drafts, dateModified, „Zuletzt aktualisiert“ and the
 *   „Stand“ of volatile values.
 * Pure.
 */

import {
  GROUNDING_REVIEW_NOTICE_DATE_LABEL,
  GROUNDING_REVIEW_NOTICE_PREFIX,
  GROUNDING_REVIEWER,
  GROUNDING_STANDARD_VERSION,
} from "@/lib/dt/prompts/grounding-page-standard";
import { dayLabel, monthLabel } from "@/lib/dt/seo/grounding-check/fact-model";
import { REVIEW_NOTICE_MARKER, escapeHtml, scriptJson } from "@/lib/dt/seo/grounding-check/render-html";

const JSON_LD_SCRIPT = /(<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>)([\s\S]*?)(<\/script>)/gi;
const WEB_PAGE_TYPES = ["WebPage", "AboutPage", "ProfilePage", "ItemPage", "CollectionPage"];
const MONTH_NAMES = "Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember";
const VISIBLE_DATE = `<time\\b[^>]*>[^<]*<\\/time>|\\d{1,2}\\.\\s*(?:${MONTH_NAMES})\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\.\\d{1,2}\\.\\d{4}`;

type Json = Record<string, unknown>;

function isWebPage(node: unknown): node is Json {
  if (!node || typeof node !== "object" || Array.isArray(node)) return false;
  const t = (node as Json)["@type"];
  const types = Array.isArray(t) ? t : [t];
  return types.some((x) => typeof x === "string" && WEB_PAGE_TYPES.includes(x));
}

function findWebPage(doc: unknown): Json | null {
  if (Array.isArray(doc)) {
    for (const item of doc) {
      const hit = findWebPage(item);
      if (hit) return hit;
    }
    return null;
  }
  if (!doc || typeof doc !== "object") return null;
  if (isWebPage(doc)) return doc as Json;
  const graph = (doc as Json)["@graph"];
  return graph ? findWebPage(graph) : null;
}

/** Change the WebPage object in the first JSON-LD block that has one. Returns null when none has. */
function editWebPage(html: string, edit: (page: Json) => void): string | null {
  let done = false;
  const out = html.replace(JSON_LD_SCRIPT, (whole, open: string, body: string, close: string) => {
    if (done) return whole;
    let doc: unknown;
    try {
      doc = JSON.parse(body);
    } catch {
      return whole;
    }
    const page = findWebPage(doc);
    if (!page) return whole;
    edit(page);
    done = true;
    return `${open}\n${scriptJson(doc)}\n${close}`;
  });
  return done ? out : null;
}

function canonicalOf(html: string): string | null {
  return html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1] ?? null;
}

function insertBefore(html: string, closingTags: string[], snippet: string): string {
  for (const tag of closingTags) {
    const index = html.toLowerCase().lastIndexOf(tag);
    if (index >= 0) return `${html.slice(0, index)}${snippet}\n${html.slice(index)}`;
  }
  return `${html}\n${snippet}`;
}

export function reviewNoticeHtml(day: string, reviewer: string = GROUNDING_REVIEWER.name): string {
  return `<p class="review-notice">${GROUNDING_REVIEW_NOTICE_PREFIX} ${escapeHtml(reviewer)} · ${GROUNDING_REVIEW_NOTICE_DATE_LABEL} <time datetime="${day}">${dayLabel(day)}</time></p>`;
}

/** „Grounding Page Standard v1.6“ → v1.7 everywhere, keeping the „v“ style of the page. */
function setStandardVersion(text: string, version: string): { text: string; count: number } {
  let count = 0;
  const out = text.replace(/(Grounding[\s-]*Page[\s-]*(?:Project\s+)?Standard\s*)(v\.?\s*)?\d+\.\d+/gi, (_m, prefix: string, v: string | undefined) => {
    count += 1;
    return `${prefix}${v ? "v" : ""}${version}`;
  });
  return { text: out, count };
}

/**
 * Stamp the documented human review into grounding.html: visible notice, reviewedBy
 * (always the reviewing organisation) and lastReviewed in the WebPage object, standard v1.7.
 */
export function applyReviewToHtml(html: string, review: { day: string; reviewer?: string }): string {
  const reviewer = review.reviewer ?? GROUNDING_REVIEWER.name;
  const reviewedBy = { "@type": GROUNDING_REVIEWER.type, name: reviewer };
  let out =
    editWebPage(html, (page) => {
      page.lastReviewed = review.day;
      page.reviewedBy = reviewedBy;
    }) ??
    insertBefore(
      html,
      ["</body>"],
      `<script type="application/ld+json">\n${scriptJson({
        "@context": "https://schema.org",
        "@type": "WebPage",
        ...(canonicalOf(html) ? { "@id": canonicalOf(html) } : {}),
        lastReviewed: review.day,
        reviewedBy,
      })}\n</script>`,
    );

  const notice = reviewNoticeHtml(review.day, reviewer);
  if (out.includes(REVIEW_NOTICE_MARKER)) {
    out = out.replace(REVIEW_NOTICE_MARKER, notice);
  } else if (/class=["'][^"']*\breview-notice\b/i.test(out)) {
    out = out.replace(/<(p|div|span)\b[^>]*class=["'][^"']*\breview-notice\b[^"']*["'][^>]*>[\s\S]*?<\/\1>/i, notice);
  } else if (new RegExp(GROUNDING_REVIEW_NOTICE_DATE_LABEL.replace(":", ":?"), "i").test(out)) {
    out = out
      .replace(new RegExp(`(${GROUNDING_REVIEW_NOTICE_PREFIX}\\s*)([^·<]+?)(\\s*·)`, "i"), `$1${escapeHtml(reviewer)}$3`)
      .replace(
        new RegExp(`(Zuletzt von einem Menschen geprüft:?\\s*)(${VISIBLE_DATE})`, "i"),
        `$1<time datetime="${review.day}">${dayLabel(review.day)}</time>`,
      );
  } else {
    out = insertBefore(out, ["</footer>", "</main>", "</body>"], notice);
  }

  const versioned = setStandardVersion(out, GROUNDING_STANDARD_VERSION);
  out = versioned.text;
  if (versioned.count === 0) {
    out = out.replace(notice, `${notice}\n<p class="standard-notice">Grounding Page Standard v${GROUNDING_STANDARD_VERSION}</p>`);
  }
  return out;
}

/** The same review in llms.txt: standard v1.7, „Geprüft“ in the header, last_reviewed/reviewed_by. */
export function applyReviewToLlmsTxt(text: string, review: { day: string; reviewer?: string }): string {
  const reviewer = review.reviewer ?? GROUNDING_REVIEWER.name;
  let out = setStandardVersion(text, GROUNDING_STANDARD_VERSION).text;

  const header = /^(#\s*Erstellt:[^\n]*)$/m;
  if (header.test(out)) {
    out = out.replace(header, (line) =>
      /(Geprüft|Verifiziert):/i.test(line)
        ? line.replace(/(Geprüft|Verifiziert):\s*\S+/i, `Geprüft: ${review.day}`)
        : `${line} | Geprüft: ${review.day}`,
    );
  } else {
    out = out.replace(/^(#[^\n]*\n)/, `$1# Geprüft: ${review.day}\n`);
  }

  out = out.replace(/^verified:[^\n]*\n?/gim, "");
  /** Replace the line, else insert it after the first anchor that exists, else end METADATEN. */
  const setMeta = (key: string, value: string, anchors: string[]) => {
    const line = new RegExp(`^${key}:[^\\n]*$`, "m");
    if (line.test(out)) {
      out = out.replace(line, `${key}: ${value}`);
      return;
    }
    const anchor = anchors.find((a) => new RegExp(`^${a}:[^\\n]*$`, "m").test(out));
    if (anchor) out = out.replace(new RegExp(`^(${anchor}:[^\\n]*)$`, "m"), `$1\n${key}: ${value}`);
    else if (/^##\s+METADATEN\s*$/m.test(out)) out = `${out.replace(/\s*$/, "")}\n${key}: ${value}\n`;
    else out = `${out.replace(/\s*$/, "")}\n\n## METADATEN\n\n${key}: ${value}\n`;
  };
  setMeta("last_reviewed", review.day, ["updated"]);
  setMeta("reviewed_by", reviewer, ["last_reviewed", "updated"]);
  return out.endsWith("\n") ? out : `${out}\n`;
}

export type RefreshResult = { text: string; changes: string[] };

function refreshStand(text: string, month: string, changes: string[]): string {
  let count = 0;
  const out = text.replace(new RegExp(`(Stand:?\\s*)(?:${MONTH_NAMES})\\s+\\d{4}`, "g"), (_m, prefix: string) => {
    count += 1;
    return `${prefix}${monthLabel(month)}`;
  });
  if (count > 0) changes.push(`${count} × „Stand“ → ${monthLabel(month)}`);
  return out;
}

/** refresh_only: new dateModified, „Zuletzt aktualisiert“ and „Stand“; content untouched. */
export function refreshDatesInHtml(html: string, input: { day: string; month: string }): RefreshResult {
  const changes: string[] = [];
  let out =
    editWebPage(html, (page) => {
      const old = typeof page.dateModified === "string" ? page.dateModified.slice(0, 10) : null;
      page.dateModified = input.day;
      changes.push(`dateModified: ${old ?? "—"} → ${input.day}`);
    }) ?? html;

  const updated = new RegExp(`(Zuletzt aktualisiert:?\\s*)(${VISIBLE_DATE})`, "gi");
  let visible = 0;
  out = out.replace(updated, (_m, prefix: string) => {
    visible += 1;
    return `${prefix}<time datetime="${input.day}">${dayLabel(input.day)}</time>`;
  });
  if (visible > 0) changes.push(`„Zuletzt aktualisiert“ → ${dayLabel(input.day)}`);

  out = out.replace(/(<meta\b[^>]*property=["'](?:article:modified_time|og:updated_time)["'][^>]*content=["'])[^"']*(["'])/gi, `$1${input.day}$2`);
  out = refreshStand(out, input.month, changes);
  return { text: out, changes };
}

export function refreshDatesInLlmsTxt(text: string, input: { day: string; month: string }): RefreshResult {
  const changes: string[] = [];
  let out = text.replace(/^(#\s*Stand:\s*)[^\n]*$/m, (_m, prefix: string) => {
    changes.push(`llms.txt: Stand → ${monthLabel(input.month)}`);
    return `${prefix}${monthLabel(input.month)}`;
  });
  out = out.replace(/(Aktualisiert:\s*)\d{4}-\d{2}-\d{2}/i, `$1${input.day}`);
  out = out.replace(/^(updated:\s*)[^\n]*$/m, `$1${input.day}`);
  out = refreshStand(out, input.month, changes);
  return { text: out, changes };
}
