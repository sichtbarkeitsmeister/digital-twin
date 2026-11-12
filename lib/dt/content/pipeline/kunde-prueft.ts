/**
 * „KUNDE PRÜFT“: an answer or a note of the editors that says the customer is still checking a
 * point. It is no fact: its wording never goes into the text. At the point the question is about
 * the text gets the placeholder [BITTE PRÜFEN: <the open question in one sentence>], the later
 * steps leave it as it is, and nobody asks the question again. Pure; safe for client code and tests.
 */
import type { ContentTextBlock } from "@/lib/dt/content/render";

/** Words an answer meaning „the customer is checking“ may consist of, besides the customer and the verb. */
const FILLER = new Set([
  "der", "die", "das", "dies", "es", "den", "dem", "des", "ein", "eine", "vom", "von", "wird", "werden", "ist", "noch", "gerade",
  "erst", "selbst", "intern", "muss", "soll", "bitte", "offen", "auf", "rueckmeldung", "warten", "wir", "abwarten", "aktuell",
  "momentan", "derzeit", "nach", "zurzeit", "klaerung", "pruefung", "in", "zu", "zur", "und", "ob", "dazu", "hierzu", "frage",
]);
const CUSTOMER = /^kund(e|in|en|innen)$/;
const CHECK = /^(prueft|prueft's|pruefen|geprueft|pruefung|klaert|klaeren|geklaert|klaerung|checkt|checken|gecheckt)$/;

function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

/**
 * „KUNDE PRÜFT“, also in other words („Kunde prüft noch“, „wird vom Kunden geprüft“, „Kundin
 * klärt das intern“). Only an answer that says nothing else: „Der Kunde prüft jedes Stück selbst“
 * is a fact about the business and stays one.
 */
export function isKundePrueft(text: string | null | undefined): boolean {
  const value = (text ?? "").trim();
  if (!value || value.length > 80 || /\d/.test(value)) return false;
  const words = fold(value).split(/[^a-z']+/).filter(Boolean);
  if (!words.some((w) => CUSTOMER.test(w)) || !words.some((w) => CHECK.test(w))) return false;
  return words.every((w) => CUSTOMER.test(w) || CHECK.test(w) || FILLER.has(w));
}

/** The placeholder for a question the customer is checking: the question in one sentence. */
export function kundePrueftPlaceholder(question: string): string {
  const one = question.replace(/\s+/g, " ").trim().replace(/[\[\]]/g, "");
  const first = one.match(/^.*?[?!.](?=\s|$)/)?.[0] ?? one;
  return `[BITTE PRÜFEN: ${first.slice(0, 240).trim()}]`;
}

/** A question the customer is checking, with the placeholder that stands for it. */
export type ContentPendingCheck = { question: string; placeholder: string };

export function pendingCheck(question: string): ContentPendingCheck {
  return { question: question.replace(/\s+/g, " ").trim(), placeholder: kundePrueftPlaceholder(question) };
}

/**
 * The block for the prompts: which questions are with the customer and which placeholder stands
 * for each. Empty when there are none.
 */
export function pendingChecksBlock(pending: readonly ContentPendingCheck[] | null | undefined): string {
  const list = pending ?? [];
  if (list.length === 0) return "";
  return [
    "### Offen – der Kunde prüft noch (KUNDE PRÜFT)",
    "Zu diesen Fragen gibt es noch keine Antwort; der Kunde prüft sie. An der passenden Stelle steht genau dieser Platzhalter, der Wortlaut „KUNDE PRÜFT“ kommt nie in den Text. Steht der Platzhalter schon im Text, bleibt er unverändert stehen.",
    ...list.map((p) => `- ${p.question} → ${p.placeholder}`),
  ].join("\n");
}

function plainOf(block: Pick<ContentTextBlock, "heading" | "html">): string {
  return `${block.heading ?? ""} ${block.html}`.replace(/&amp;/g, "&");
}

/**
 * After a step rewrote the text: a „KUNDE PRÜFT“ placeholder that was in an Abschnitt before and
 * is gone now comes back, as its own paragraph at the end of that Abschnitt (or of the text, when
 * the Abschnitt is gone). The steps must leave it as it is; this keeps it when one did not.
 */
export function keepPendingPlaceholders(
  after: readonly ContentTextBlock[],
  before: readonly ContentTextBlock[],
  pending: readonly ContentPendingCheck[] | null | undefined,
): { blocks: ContentTextBlock[]; restored: string[] } {
  const placeholders = (pending ?? []).map((p) => p.placeholder);
  if (placeholders.length === 0 || after.length === 0) return { blocks: [...after], restored: [] };
  const blocks = after.map((b) => ({ ...b }));
  const restored: string[] = [];
  const text = () => blocks.map(plainOf).join("\n");
  for (const placeholder of placeholders) {
    const was = before.find((b) => plainOf(b).includes(placeholder));
    if (!was || text().includes(placeholder)) continue;
    const target = blocks.find((b) => b.id === was.id) ?? blocks[blocks.length - 1]!;
    target.html = `${target.html}${target.html ? "\n" : ""}<p>${placeholder.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`;
    restored.push(placeholder);
  }
  return { blocks, restored };
}

/** The note line that marks a question as „KUNDE PRÜFT“ (`answeredInNotes` reads it back). */
export function kundePrueftNoteLine(question: string): string {
  return `Zu „${question.replace(/\s+/g, " ").trim().slice(0, 600)}“: KUNDE PRÜFT – Platzhalter bleibt.`;
}

/** The questions the page's notes mark as „KUNDE PRÜFT“, each once. */
export function kundePrueftQuestionsInNotes(notes: readonly string[]): string[] {
  const out = new Set<string>();
  for (const note of notes) {
    for (const line of note.split("\n")) {
      const m = line.match(/^Zu „(.{4,600}?)“: KUNDE PRÜFT – Platzhalter bleibt\.$/);
      if (m) out.add(m[1]!);
    }
  }
  return [...out];
}

const CHECK_PLACEHOLDER_RE = /\[\s*BITTE\s+PR(?:Ü|UE)FEN\s*:?\s*([^\]]*)\]/giu;
const fold1 = (text: string) => text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

/** Every [BITTE PRÜFEN: …] placeholder in a text, with the question inside it. */
export function checkPlaceholdersIn(text: string): Array<{ placeholder: string; question: string }> {
  return [...text.matchAll(CHECK_PLACEHOLDER_RE)].map((m) => ({ placeholder: fold1(m[0]), question: fold1(m[1] ?? "") }));
}

/** Whether the placeholder (its question) is one the customer is checking. */
function isPendingQuestion(question: string, pendingQuestions: readonly string[]): boolean {
  const q = fold1(question);
  return pendingQuestions.some((p) => fold1(p) === q || kundePrueftPlaceholder(p) === kundePrueftPlaceholder(q));
}

/**
 * For the page window and the exports: every [BITTE PRÜFEN: …] placeholder the customer is checking
 * becomes a bold „[KUNDE PRÜFT: …]“, so the customer cannot overlook it. The stored text keeps the
 * placeholder as it is (the steps rely on it). `className` only for the page window.
 */
export function markKundePrueftHtml(html: string, pendingQuestions: readonly string[], options: { className?: string } = {}): string {
  if (pendingQuestions.length === 0) return html;
  const open = options.className ? `<strong class="${options.className}">` : "<strong>";
  return html.replace(CHECK_PLACEHOLDER_RE, (match: string, inner: string) =>
    isPendingQuestion(inner ?? "", pendingQuestions) ? `${open}[KUNDE PRÜFT: ${(inner ?? "").trim()}]</strong>` : match,
  );
}

/**
 * „KUNDE PRÜFT“ on an open point: the placeholders in the text the point is about. Those it quotes
 * come first; a point that talks about a placeholder without quoting it takes the ones in its own
 * Abschnitte. Empty when the text has no placeholder for it yet (then the Abschnitt is revised).
 */
export function findingCheckPlaceholders(
  finding: { title: string; problem: string; proposal?: string | null },
  blocks: readonly Pick<ContentTextBlock, "id" | "heading" | "html">[],
  targetIds: readonly string[],
): string[] {
  const said = fold1(`${finding.title}\n${finding.problem}\n${finding.proposal ?? ""}`);
  const perBlock = blocks.map((b) => ({ id: b.id, found: checkPlaceholdersIn(plainOf(b).replace(/<[^>]+>/g, " ")) }));
  const quoted = perBlock.flatMap((b) => b.found).filter((p) => p.question.length >= 4 && said.includes(p.question));
  const picked =
    quoted.length > 0
      ? quoted
      : /BITTE\s+PR(?:Ü|UE)FEN|Platzhalter/iu.test(said)
        ? perBlock.filter((b) => targetIds.includes(b.id)).flatMap((b) => b.found)
        : [];
  return [...new Set(picked.map((p) => p.question).filter((q) => q.length >= 4))];
}
