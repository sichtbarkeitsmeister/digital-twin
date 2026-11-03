/**
 * „Antworten einarbeiten & weiter“: the short pass at the page's one stop. Not a step (no step
 * number, no row in `dt_content_steps`): it runs between Lektorat and Watermark Entfernung, its
 * cost goes into the page's `cost_eur` and `question_stop.pass`, its usage is recorded as
 * `content.answers`. Pure; `run-step.ts` calls the model.
 *
 *   - „Ohne Angabe weiter“ (and a known „Keine Angabe“): the sentence with the placeholder is
 *     removed in code (`removeSentenceWith`); no model call for that.
 *   - An answer: only the Abschnitte that hold the answered placeholder (or the question's
 *     sentence) go to the model, with the answers, and only those may come back changed.
 *   - Checked in code like the Aktualitätsprüfung (`normalizeAnswersOutput`): every other
 *     Abschnitt is restored exactly; H1, hero, headings, levels and ids stay; every marker that
 *     was not answered stays; the answered placeholder is gone; no number that is neither in the
 *     Abschnitt before nor in an answer. A version that breaks a rule is replaced by the stored
 *     Abschnitt with the placeholder swapped for the answer (`fillPlaceholder`).
 */

import type Anthropic from "@anthropic-ai/sdk";

import type { ContentHandledQuestion } from "@/lib/dt/content/pipeline/question-stop";
import { isTextPlaceholder } from "@/lib/dt/content/pipeline/questions";
import {
  BLOCKS_SCHEMA,
  CONTENT_HERO_BLOCK_ID,
  clientWishesBlock,
  clientWishesRules,
  joinPromptParts,
  settingsBlock,
  type ContentPipelineContext,
} from "@/lib/dt/content/pipeline/prompts";
import { blocksToPromptText, escapeHtml, htmlToPlainText, normalizeBlocks, type ContentTextBlock } from "@/lib/dt/content/render";

export const ANSWERS_USAGE_MODE = "content.answers";
export const ANSWERS_MAX_TOKENS = 6_000;

const MARKER_RE = /\[\s*(?:BITTE\s+PR(?:Ü|UE)FEN|QUELLE\s+BITTE|PREIS\s+BITTE|LINK\s*:|DATUM|FOTO\s*:|HERO)[^\]]*\]/giu;

function plain(block: Pick<ContentTextBlock, "heading" | "html">): string {
  return `${block.heading ?? ""} ${htmlToPlainText(block.html)}`.replace(/\s+/g, " ").trim();
}

function markers(textValue: string): string[] {
  return [...textValue.matchAll(MARKER_RE)].map((m) => m[0].replace(/\s+/g, " ")).sort();
}

/** The Abschnitte a decision is about: those that hold its placeholder, else its own Abschnitt. */
export function answerTargets(blocks: readonly ContentTextBlock[], handled: readonly ContentHandledQuestion[]): Map<string, ContentHandledQuestion[]> {
  const out = new Map<string, ContentHandledQuestion[]>();
  const add = (id: string, h: ContentHandledQuestion) => out.set(id, [...(out.get(id) ?? []), h]);
  for (const h of handled) {
    if (isTextPlaceholder(h.placeholder)) {
      const holders = blocks.filter((b) => `${b.heading ?? ""}\n${b.html}`.includes(h.placeholder!) || plain(b).includes(h.placeholder!));
      for (const b of holders) add(b.id, h);
      if (holders.length > 0) continue;
    }
    if (h.block_id && blocks.some((b) => b.id === h.block_id)) add(h.block_id, h);
  }
  return out;
}

/**
 * The block without the sentence that holds `needle` (a placeholder): from the previous
 * sentence end to the next one, inside its paragraph or list item. An element left empty goes
 * too. Null when the needle is not there verbatim (e.g. split by emphasis).
 */
export function removeSentenceWith(block: ContentTextBlock, needle: string): ContentTextBlock | null {
  const html = block.html;
  for (const candidate of [needle, escapeHtml(needle)]) {
    const at = html.indexOf(candidate);
    if (at < 0) continue;
    // Bounds of the enclosing text run: never across a tag that opens or closes a paragraph or item.
    const open = Math.max(html.lastIndexOf("<p", at), html.lastIndexOf("<li", at));
    const openEnd = open >= 0 ? html.indexOf(">", open) + 1 : 0;
    const closeP = html.indexOf("</p>", at);
    const closeLi = html.indexOf("</li>", at);
    const close = [closeP, closeLi].filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? html.length;
    let from = at;
    while (from > openEnd) {
      const prev = html.slice(openEnd, from);
      const m = prev.match(/[.!?](?:<\/(?:strong|em|b|i)>)?\s+(?=[^.!?]*$)/);
      if (m && m.index != null) {
        from = openEnd + m.index + m[0].length;
        break;
      }
      from = openEnd;
    }
    let to = at + candidate.length;
    const rest = html.slice(to, close);
    const end = rest.match(/[.!?](?:<\/(?:strong|em|b|i)>)?(?:\s+|$)/);
    to = end && end.index != null ? to + end.index + end[0].length : close;
    let next = `${html.slice(0, from)}${html.slice(to)}`.replace(/\s+(<\/(?:p|li)>)/g, "$1");
    // An element without text left is dropped.
    next = next.replace(/<(p|li)\b[^>]*>(?:\s|<br\s*\/?>|&nbsp;)*<\/\1>/gi, "").replace(/<(ul|ol)\b[^>]*>\s*<\/\1>/gi, "").trim();
    return { ...block, html: next };
  }
  if ((block.heading ?? "").includes(needle)) {
    return { ...block, heading: (block.heading ?? "").replace(needle, "").replace(/\s+/g, " ").trim() || null };
  }
  return null;
}

/** The stored block with the placeholder swapped for the answer: the safe fallback for an answer. */
export function fillPlaceholder(block: ContentTextBlock, placeholder: string, answer: string): ContentTextBlock {
  const safe = escapeHtml(answer.trim());
  return {
    ...block,
    heading: block.heading?.includes(placeholder) ? block.heading.replace(placeholder, answer.trim()) : block.heading,
    html: block.html.split(placeholder).join(safe).split(escapeHtml(placeholder)).join(safe),
  };
}

/**
 * Whether an answer can stand in the text in place of its placeholder as it is: a value („120 €“,
 * „Mo–Fr 9–17 Uhr“), not a confirmation („Ja, das stimmt so.“) or several sentences. Only such an
 * answer is swapped in by code; any other needs the model's sentence, or the placeholder stays.
 */
export function isLiteralAnswer(answer: string): boolean {
  const a = answer.trim();
  if (!a || a.length > 160) return false;
  if (/^(?:ja|nein|jein|stimmt|korrekt|richtig|genau|passt|so ist es|trifft zu|trifft nicht zu)\b/iu.test(a)) return false;
  return !/[.!?]\s+\p{Lu}/u.test(a);
}

/** Every number in `after` is in `before` or in an answer: the pass adds no facts of its own. */
export function noNewNumbers(before: string, after: string, answers: readonly string[]): boolean {
  const allowed = new Set([before, ...answers].flatMap((t) => t.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]/g, "")));
  return (after.match(/\d+(?:[.,]\d+)*/g) ?? []).every((n) => allowed.has(n.replace(/[.,]/g, "")));
}

export type AnswersPassResult = {
  blocks: ContentTextBlock[];
  changed: string[];
  fallback: string[];
  rejected: Array<{ block_id: string; reason: string }>;
};

/** The drops in code, before any model call: the sentences with a dropped placeholder go. */
export function applyDrops(blocks: readonly ContentTextBlock[], handled: readonly ContentHandledQuestion[]): { blocks: ContentTextBlock[]; changed: string[]; unresolved: ContentHandledQuestion[] } {
  const drops = handled.filter((h) => h.action === "drop");
  const targets = answerTargets(blocks, drops);
  const changed: string[] = [];
  const unresolved: ContentHandledQuestion[] = [];
  const next = blocks.map((block) => {
    let current = block;
    for (const h of targets.get(block.id) ?? []) {
      const needle = isTextPlaceholder(h.placeholder) ? h.placeholder! : (h.excerpt ?? "");
      const removed = needle ? removeSentenceWith(current, needle) : null;
      if (removed) current = removed;
      else unresolved.push(h);
    }
    if (current !== block) changed.push(block.id);
    return current;
  });
  return { blocks: next, changed, unresolved };
}

function why(before: ContentTextBlock, after: ContentTextBlock, items: readonly ContentHandledQuestion[], isFirst: boolean): string | null {
  if ((after.heading ?? "") !== (before.heading ?? "") && (isFirst || before.id === CONTENT_HERO_BLOCK_ID || !items.some((h) => (before.heading ?? "").includes(h.placeholder ?? "\u0000")))) {
    return "Überschrift geändert";
  }
  if (after.level !== before.level) return "Ebene geändert";
  const answered = new Set(items.filter((h) => isTextPlaceholder(h.placeholder)).map((h) => h.placeholder!.replace(/\s+/g, " ")));
  const kept = markers(plain(before)).filter((m) => !answered.has(m));
  if (markers(plain(after)).join("|") !== kept.join("|")) return "Platzhalter oder Marker verändert";
  if (!noNewNumbers(plain(before), plain(after), items.map((h) => h.answer ?? ""))) return "Zahl, die weder im Abschnitt noch in einer Antwort steht";
  if (/https?:\/\/|www\./i.test(plain(after)) && !/https?:\/\/|www\./i.test(`${plain(before)} ${items.map((h) => h.answer ?? "").join(" ")}`)) return "neuer Link";
  return null;
}

/**
 * The model's answer, restricted in code: only target Abschnitte may differ, and each only
 * when it keeps every rule; otherwise the stored Abschnitt with the answers swapped in.
 */
export function normalizeAnswersOutput(
  json: unknown,
  input: { blocks: readonly ContentTextBlock[]; targets: ReadonlyMap<string, readonly ContentHandledQuestion[]> },
): AnswersPassResult {
  const r = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const fromModel = new Map(normalizeBlocks(r.blocks).map((b) => [b.id, b]));
  const changed: string[] = [];
  const fallback: string[] = [];
  const rejected: AnswersPassResult["rejected"] = [];
  const blocks = input.blocks.map((block, index) => {
    const items = (input.targets.get(block.id) ?? []).filter((h) => h.action === "drop" || h.answer);
    if (items.length === 0) return block;
    const proposed = fromModel.get(block.id);
    const filledInCode = () => {
      fallback.push(block.id);
      return items.reduce((b, h) => {
        if (!isTextPlaceholder(h.placeholder)) return b;
        if (h.action === "drop") return removeSentenceWith(b, h.placeholder!) ?? b;
        if (!isLiteralAnswer(h.answer!)) {
          // „Ja, das stimmt so.“ in place of the placeholder would be nonsense: it stays an open placeholder.
          rejected.push({ block_id: block.id, reason: `Antwort nicht als Wert einsetzbar, Platzhalter bleibt: ${h.placeholder}` });
          return b;
        }
        return fillPlaceholder(b, h.placeholder!, h.answer!);
      }, block);
    };
    if (!proposed) {
      rejected.push({ block_id: block.id, reason: "fehlt in der Antwort" });
      return filledInCode();
    }
    // Heading and level are no part of an answer: a model that changed them anyway is repaired,
    // not thrown away (seen in a real run: the level changed, and the answer went in by code).
    const headingMayChange = index > 0 && block.id !== CONTENT_HERO_BLOCK_ID && items.some((h) => (block.heading ?? "").includes(h.placeholder ?? "\u0000"));
    const candidate = { ...proposed, id: block.id, level: block.level, heading: headingMayChange ? proposed.heading : block.heading };
    const problem = why(block, candidate, items, index === 0);
    if (problem) {
      rejected.push({ block_id: block.id, reason: problem });
      return filledInCode();
    }
    changed.push(block.id);
    return { ...block, heading: candidate.heading, html: candidate.html };
  });
  return { blocks, changed, fallback, rejected };
}

export const ANSWERS_TOOL: Anthropic.Tool = {
  name: "submit_antworten",
  description: "Die betroffenen Abschnitte mit den eingearbeiteten Antworten des Kunden.",
  input_schema: {
    type: "object",
    properties: {
      blocks: { ...BLOCKS_SCHEMA, description: "Nur die gelieferten Abschnitte, mit derselben id, Überschrift und Ebene." },
    },
    required: ["blocks"],
  },
};

/** The fixed rules of the pass (it has no editable prompt). */
export const ANSWERS_RULES = `Du arbeitest Antworten des Kunden in einen fertigen Webseitentext ein. Sprache: Deutsch.
- Ändere nur die Sätze, in denen der genannte Platzhalter oder die genannte Aussage steht. Jeder andere Satz bleibt wörtlich.
- Setze die Antwort so ein, wie der Kunde sie gegeben hat; formuliere den Satz nur so weit um, dass er grammatisch stimmt. Keine weiteren Fakten, Zahlen, Namen oder Versprechen.
- Überschriften, Ebenen, ids und alle anderen Platzhalter und Marker ([LINK: …], [DATUM], [BITTE PRÜFEN: …] anderer Stellen) bleiben unverändert.
- Anrede, Tonalität und verbotene Wörter aus den Vorgaben gelten weiter.`;

export function answersPassPrompt(
  context: Pick<ContentPipelineContext, "settings" | "wishes">,
  blocks: readonly ContentTextBlock[],
  handled: readonly ContentHandledQuestion[],
): { system: string; user: string } {
  const answers = handled
    .filter((h) => h.action === "drop" || h.answer)
    .map((h, i) =>
      [
        `${i + 1}. Frage: ${h.question}`,
        isTextPlaceholder(h.placeholder) ? `   Platzhalter im Text: ${h.placeholder}` : h.excerpt ? `   Aussage im Text: „${h.excerpt}“` : "",
        h.action === "drop" ? "   Keine Angabe: den Satz mit dieser Stelle streichen, sonst nichts ändern." : `   Antwort des Kunden: ${h.answer}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  return {
    system: joinPromptParts([ANSWERS_RULES, ...clientWishesRules(context)]),
    user: joinPromptParts([
      `## Abschnitte, in die Antworten gehören (nur diese zurückgeben)\n${blocksToPromptText(blocks)}`,
      `## Antworten des Kunden\n${answers.join("\n")}`,
      settingsBlock(context.settings),
      clientWishesBlock(context),
    ]),
  };
}
