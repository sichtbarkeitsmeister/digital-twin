/**
 * State of the Aktualitätsprüfung that outlives one step: `dt_content_pages.freshness` (the
 * updates with their sources, the one send-back to GEO) and the progress the step keeps in its
 * own row between the web research and the result call. Pure, safe for tests and the drawer.
 */

import type {
  ContentFinding,
  ContentFreshness,
  ContentFreshnessSection,
  ContentFreshnessSource,
  ContentFreshnessUpdate,
  ContentQuestion,
  ContentReviewFreshness,
} from "@/lib/dt/content/types";

export const EMPTY_CONTENT_FRESHNESS: ContentFreshness = {
  sendbacks: 0,
  updates: [],
  pending_sections: [],
  sent_back_sections: [],
  converted_sections: [],
  carried_questions: [],
};

const MAX_UPDATES = 60;
const MAX_SECTIONS = 20;

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, max = 2_000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Only http(s) links are kept: they end up as `href` in the drawer. */
export function isWebUrl(url: string): boolean {
  return /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(url.trim());
}

function readSource(raw: unknown): ContentFreshnessSource | null {
  const r = rec(raw);
  const url = text(r.url, 2_000);
  if (!isWebUrl(url)) return null;
  return { url, title: text(r.title, 300) || null };
}

function readSection(raw: unknown): ContentFreshnessSection | null {
  const r = rec(raw);
  const problem = text(r.problem);
  const suggestion = text(r.suggestion);
  if (!problem && !suggestion) return null;
  return {
    block_id: text(r.block_id, 80) || null,
    section: text(r.section, 200) || text(r.block_id, 80),
    problem,
    suggestion,
    sources: list(r.sources).map(readSource).filter((s): s is ContentFreshnessSource => Boolean(s)).slice(0, 8),
  };
}

function readUpdate(raw: unknown): ContentFreshnessUpdate | null {
  const r = rec(raw);
  const source_url = text(r.source_url, 2_000);
  const old_text = text(r.old_text);
  const new_text = text(r.new_text);
  if (!old_text || !new_text || !isWebUrl(source_url)) return null;
  return {
    block_id: text(r.block_id, 80),
    section: text(r.section, 200) || text(r.block_id, 80),
    old_text,
    new_text,
    reason: text(r.reason, 1_000),
    source_url,
    source_title: text(r.source_title, 300) || null,
    at: text(r.at, 40),
  };
}

function readQuestion(raw: unknown): ContentQuestion | null {
  const r = rec(raw);
  const question = text(r.question, 800);
  if (!question) return null;
  return {
    kind: text(r.kind, 40) || "outdated",
    question,
    field: text(r.field, 80) || null,
    placeholder: text(r.placeholder, 400) || null,
    block_id: text(r.block_id, 80) || null,
    section: text(r.section, 200) || null,
    excerpt: text(r.excerpt, 500) || null,
    blocking: true,
  };
}

/** The stored column as the code uses it; anything odd (NULL, an old shape) counts as nothing done. */
export function readContentFreshness(raw: unknown): ContentFreshness {
  const r = rec(raw);
  const sections = (value: unknown) =>
    list(value).map(readSection).filter((s): s is ContentFreshnessSection => Boolean(s)).slice(0, MAX_SECTIONS);
  const sendbacks = Number(r.sendbacks);
  return {
    sendbacks: Number.isFinite(sendbacks) && sendbacks > 0 ? 1 : 0,
    updates: list(r.updates).map(readUpdate).filter((u): u is ContentFreshnessUpdate => Boolean(u)).slice(-MAX_UPDATES),
    pending_sections: sections(r.pending_sections),
    sent_back_sections: sections(r.sent_back_sections),
    converted_sections: sections(r.converted_sections),
    carried_questions: list(r.carried_questions).map(readQuestion).filter((q): q is ContentQuestion => Boolean(q)).slice(0, 20),
  };
}

export function reviewFreshness(freshness: ContentFreshness): ContentReviewFreshness {
  return {
    sendbacks: freshness.sendbacks,
    updates: freshness.updates,
    pending_sections: freshness.pending_sections,
    sent_back_sections: freshness.sent_back_sections,
    converted_sections: freshness.converted_sections,
  };
}

/** New updates after the stored ones; the same change twice (old → new in one Abschnitt) is kept once. */
export function mergeFreshnessUpdates(
  stored: readonly ContentFreshnessUpdate[],
  added: readonly ContentFreshnessUpdate[],
): ContentFreshnessUpdate[] {
  const key = (u: ContentFreshnessUpdate) => `${u.block_id}|${u.old_text}|${u.new_text}`;
  const seen = new Set(stored.map(key));
  const out = [...stored];
  for (const update of added) {
    if (seen.has(key(update))) continue;
    seen.add(key(update));
    out.push(update);
  }
  return out.slice(-MAX_UPDATES);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** „Titel (host)“ or the host: how the drawer and the findings name a source. */
export function freshnessSourceLabel(source: { url: string; title?: string | null }): string {
  const title = source.title?.trim();
  return title ? `${title} (${hostOf(source.url)})` : hostOf(source.url);
}

/**
 * Outdated Abschnitte after the one send-back: open points with the proposal and the source,
 * so a person decides. Listed under „Offene Punkte“ and by the Endabnahme.
 */
export function freshnessSectionFindings(sections: readonly ContentFreshnessSection[]): ContentFinding[] {
  return sections.map((s) => {
    const sources = s.sources.map((src) => `${freshnessSourceLabel(src)}: ${src.url}`).join("; ");
    return {
      title: `Abschnitt veraltet: ${s.section}`.slice(0, 120),
      problem: s.problem || "Der Abschnitt ist laut Websuche nicht mehr aktuell.",
      proposal: [s.suggestion, sources ? `Quelle: ${sources}` : ""].filter(Boolean).join(" "),
      severity: "high",
      severity_label: "Wichtig",
      block_id: s.block_id,
    };
  });
}

/** One line for the drawer: did the text go back to GEO, is it waiting, what is left open. */
export function freshnessSendBackLine(freshness: ContentReviewFreshness): string {
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  if (freshness.pending_sections.length > 0) {
    return `An GEO zurückgegeben: ${n(freshness.pending_sections.length, "Abschnitt wird", "Abschnitte werden")} überarbeitet, danach wird erneut geprüft.`;
  }
  if (freshness.sendbacks > 0) {
    const sent = freshness.sent_back_sections.length;
    const open = freshness.converted_sections.length;
    const base = `Einmal an GEO zurückgegeben${sent > 0 ? ` (${n(sent, "veralteter Abschnitt", "veraltete Abschnitte")})` : ""} und danach erneut geprüft.`;
    return open > 0 ? `${base} ${n(open, "Abschnitt ist", "Abschnitte sind")} weiter veraltet und ${open === 1 ? "steht" : "stehen"} unter „Offene Punkte“.` : base;
  }
  // GEO switched off for the page: nothing goes back, outdated Abschnitte are open points at once.
  const open = freshness.converted_sections.length;
  if (open > 0) {
    return `Nicht an GEO zurückgegeben (GEO ist abgeschaltet): ${n(open, "veralteter Abschnitt steht", "veraltete Abschnitte stehen")} unter „Offene Punkte“.`;
  }
  return "Nicht an GEO zurückgegeben.";
}

// --- progress of the step between its two calls ---------------------------------------------------

/** What the research call found; handed to the result call, kept in the step row meanwhile. */
export type AktualitaetResearch = {
  /** The research protocol (one line per time-sensitive statement). */
  text: string;
  /** Every URL the web search or fetch returned: the only sources an update may cite. */
  sources: ContentFreshnessSource[];
  /** Server tool calls billed (`usage.server_tool_use`). */
  searches: number;
  fetches: number;
  /** The web search said `max_uses_exceeded`: not every statement may be checked. */
  search_limit_hit: boolean;
  /** „Zeitkritische Aussagen: N“ from the protocol; null when the line is missing. */
  claims: number | null;
};

/**
 * The step row's output while the Aktualitätsprüfung is between its two calls. The web
 * research is paid for, so a job budget that runs out after it (or a retry of the result
 * call) does not search again. Tokens and cost add up across both calls and land on the page
 * when the step finishes.
 */
export type AktualitaetProgress = {
  version: 1;
  phase: "research";
  /** Fingerprint of the text the research looked at; another text means a new research. */
  text_key: string;
  research: AktualitaetResearch | null;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  web_search_requests: number;
  web_fetch_requests: number;
  cost_eur: number;
  models: string[];
};

export function emptyAktualitaetProgress(textKey: string): AktualitaetProgress {
  return {
    version: 1,
    phase: "research",
    text_key: textKey,
    research: null,
    calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    web_search_requests: 0,
    web_fetch_requests: 0,
    cost_eur: 0,
    models: [],
  };
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function readResearch(raw: unknown): AktualitaetResearch | null {
  const r = rec(raw);
  const protocol = text(r.text, 40_000);
  if (!protocol && list(r.sources).length === 0) return null;
  const claims = Number(r.claims);
  return {
    text: protocol,
    sources: list(r.sources).map(readSource).filter((s): s is ContentFreshnessSource => Boolean(s)).slice(0, 80),
    searches: num(r.searches),
    fetches: num(r.fetches),
    search_limit_hit: r.search_limit_hit === true,
    claims: r.claims == null || !Number.isFinite(claims) ? null : Math.max(0, Math.floor(claims)),
  };
}

/**
 * The progress stored in the step row. Cost and tokens always carry over (they were paid);
 * the research only while the text is still the one it looked at.
 */
export function readAktualitaetProgress(raw: unknown, textKey: string): AktualitaetProgress {
  const r = rec(raw);
  if (r.version !== 1 || r.phase !== "research") return emptyAktualitaetProgress(textKey);
  return {
    version: 1,
    phase: "research",
    text_key: textKey,
    research: r.text_key === textKey ? readResearch(r.research) : null,
    calls: num(r.calls),
    input_tokens: num(r.input_tokens),
    output_tokens: num(r.output_tokens),
    web_search_requests: num(r.web_search_requests),
    web_fetch_requests: num(r.web_fetch_requests),
    cost_eur: num(r.cost_eur),
    models: list(r.models).filter((m): m is string => typeof m === "string").slice(-10),
  };
}

/** Status line suffix while the step waits for its result call; null for any other output. */
export function aktualitaetProgressLabel(raw: unknown): string | null {
  const r = rec(raw);
  if (r.version !== 1 || r.phase !== "research" || !r.research) return null;
  const sources = list(rec(r.research).sources).length;
  return `Websuche fertig, ${sources} ${sources === 1 ? "Quelle" : "Quellen"} – Ergebnis folgt`;
}

/** FNV-1a over the text a step reads: equal text, equal key. */
export function contentTextKey(parts: readonly (string | null | undefined)[]): string {
  let hash = 0x811c9dc5;
  const input = parts.map((p) => p ?? "").join("\u0000");
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${input.length.toString(36)}-${hash.toString(36)}`;
}
