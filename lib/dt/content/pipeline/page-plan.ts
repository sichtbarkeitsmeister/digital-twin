/**
 * Seitenkonzept und Themenplan: what the Analyse decides about ONE page before anything is
 * written. Every page of a customer gets the same Anbieterfakten and the same Avatar; without a
 * plan of its own each page opens with the same situation of the Avatar and the same promises.
 * The Seitenkonzept answers who searches exactly this page and why; the Themenplan names the 4–6
 * topics the page covers. Both are made by the Analyse (no extra step), shown and editable in the
 * page window, and handed to every later step. Pure; safe for client code and tests.
 */

/** The questions of the Seitenkonzept, in the order the page window shows them. */
export const SEITENKONZEPT_FIELDS = [
  { key: "wer_sucht", label: "Wer sucht genau diese Leistung und warum?" },
  { key: "ziel", label: "Was will die Person erreichen oder wissen?" },
  { key: "unklar_und_sorgen", label: "Was ist ihr unklar, was befürchtet sie?" },
  { key: "entscheidungswissen", label: "Was muss sie verstehen, um zu entscheiden?" },
  { key: "fakten", label: "Welche Fakten gehören auf diese Seite?" },
  { key: "abgrenzung", label: "Was unterscheidet die Seite von den anderen Seiten des Anbieters?" },
] as const;

export type SeitenkonzeptKey = (typeof SEITENKONZEPT_FIELDS)[number]["key"];
export type ContentSeitenkonzept = Record<SeitenkonzeptKey, string>;

export const THEMENPLAN_SOURCES = ["Excel", "Analyse", "Redaktion"] as const;
export type ContentThema = {
  thema: string;
  /** What the page says about it, in one sentence. */
  inhalt: string;
  /** „Excel“: named in the Seitenstruktur (they come first); „Analyse“: added by the Analyse; „Redaktion“: entered in the page window. */
  quelle: (typeof THEMENPLAN_SOURCES)[number];
};

export const THEMENPLAN_MIN = 4;
export const THEMENPLAN_MAX = 6;
const FIELD_MAX_CHARS = 600;
const THEMA_MAX_CHARS = 120;
const INHALT_MAX_CHARS = 400;

export type ContentPagePlan = {
  seitenkonzept: ContentSeitenkonzept | null;
  themenplan: ContentThema[];
  /** The editors changed the plan in the page window. */
  edited?: boolean;
};

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** The Seitenkonzept as the model or the page window sent it; null when no question is answered. */
export function normalizeSeitenkonzept(raw: unknown): ContentSeitenkonzept | null {
  const r = rec(raw);
  const out = {} as ContentSeitenkonzept;
  for (const field of SEITENKONZEPT_FIELDS) {
    const value = r[field.key];
    // „fakten“ may come as a list: one fact per entry.
    out[field.key] = Array.isArray(value) ? value.map((v) => text(v, 200)).filter(Boolean).join("; ").slice(0, FIELD_MAX_CHARS) : text(value, FIELD_MAX_CHARS);
  }
  return SEITENKONZEPT_FIELDS.some((f) => out[f.key]) ? out : null;
}

/** The Themenplan: each topic once, the ones from the Excel first, at most six. */
export function normalizeThemenplan(raw: unknown, fallbackSource: ContentThema["quelle"] = "Analyse"): ContentThema[] {
  const seen = new Set<string>();
  const out: ContentThema[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const r = typeof item === "string" ? { thema: item } : rec(item);
    const thema = text(r.thema, THEMA_MAX_CHARS).replace(/^\d+[.)]\s*/, "");
    const key = thema.toLowerCase();
    if (!thema || seen.has(key)) continue;
    seen.add(key);
    const quelle = (THEMENPLAN_SOURCES as readonly string[]).includes(String(r.quelle)) ? (r.quelle as ContentThema["quelle"]) : fallbackSource;
    out.push({ thema, inhalt: text(r.inhalt, INHALT_MAX_CHARS), quelle });
  }
  // Stable: topics from the Seitenstruktur keep their place in front, the rest keeps its order.
  return [...out.filter((t) => t.quelle === "Excel"), ...out.filter((t) => t.quelle !== "Excel")].slice(0, THEMENPLAN_MAX);
}

/** The plan inside an Analyse output (older outputs have none). */
export function readPagePlan(analyseOutput: unknown): ContentPagePlan {
  const r = rec(analyseOutput);
  return {
    seitenkonzept: normalizeSeitenkonzept(r.seitenkonzept),
    themenplan: normalizeThemenplan(r.themenplan),
    ...(r.plan_edited === true ? { edited: true } : {}),
  };
}

export function hasPagePlan(plan: ContentPagePlan | null | undefined): boolean {
  return Boolean(plan && (plan.seitenkonzept || plan.themenplan.length > 0));
}

/**
 * The Analyse output with the editors' plan in place of the model's. Topics entered in the page
 * window count as „Redaktion“ unless they already carried a source. The rest of the output stays.
 */
export function withEditedPagePlan(analyseOutput: unknown, edit: { seitenkonzept?: unknown; themenplan?: unknown }): Record<string, unknown> {
  const current = rec(analyseOutput);
  const next: Record<string, unknown> = { ...current, plan_edited: true };
  if (edit.seitenkonzept !== undefined) next.seitenkonzept = normalizeSeitenkonzept(edit.seitenkonzept);
  if (edit.themenplan !== undefined) next.themenplan = normalizeThemenplan(edit.themenplan, "Redaktion");
  return next;
}

/** The tool schema of the two fields (the Analyse's `submit_analyse`). */
export const SEITENKONZEPT_SCHEMA = {
  type: "object",
  description: "Das Konzept GENAU dieser Seite, je Antwort 1–2 Sätze. Nicht der Anbieter allgemein, nicht die allgemeine Lage des Avatars.",
  properties: Object.fromEntries(SEITENKONZEPT_FIELDS.map((f) => [f.key, { type: "string", description: f.label }])),
  required: SEITENKONZEPT_FIELDS.map((f) => f.key),
} as const;

export const THEMENPLAN_SCHEMA = {
  type: "array",
  description: `${THEMENPLAN_MIN}–${THEMENPLAN_MAX} Themen der Seite in der Reihenfolge, in der der Text sie behandelt. Themen aus der Seitenstruktur zuerst.`,
  items: {
    type: "object",
    properties: {
      thema: { type: "string", description: "Das Thema in 2–6 Wörtern." },
      inhalt: { type: "string", description: "Was die Seite dazu sagt, in einem Satz." },
      quelle: { type: "string", enum: ["Excel", "Analyse"], description: "Excel: in „Themen und Hinweise für den Texter“ bzw. im KI-Prompt der Seite genannt. Analyse: von dir ergänzt." },
    },
    required: ["thema", "inhalt", "quelle"],
  },
} as const;

/** The Analyse's instruction for the two fields and for the page's own Hormozi parts. */
export const ANALYSE_PLAN_INSTRUCTION = `seitenkonzept: das Konzept GENAU dieser Seite, je Antwort 1–2 Sätze: wer_sucht (wer sucht genau diese Leistung und warum, in welcher Lage), ziel (was will die Person erreichen oder wissen), unklar_und_sorgen (was ist ihr unklar, was befürchtet sie bei dieser Leistung), entscheidungswissen (was muss sie verstehen, um zu entscheiden), fakten (welche belegten Fakten gehören auf diese Seite und nicht auf eine andere), abgrenzung (was unterscheidet diese Seite von den anderen Seiten des Anbieters; nutze dafür die Liste „Weitere Seiten der Website“). Zwei Seiten desselben Anbieters dürfen hier nicht dasselbe stehen haben: Beschreibe nicht den Anbieter und nicht die allgemeine Lage des Avatars, sondern den Menschen, der mit der Hauptfrage dieser Seite sucht.
themenplan: ${THEMENPLAN_MIN}–${THEMENPLAN_MAX} Themen, die die Seite behandelt, in der Reihenfolge des Textes; je thema (2–6 Wörter), inhalt (ein Satz) und quelle. Nennt der KI-Prompt der Redaktion für diese Seite („Themen und Hinweise für den Texter“ aus der Seitenstruktur) Themen, haben diese Vorrang: Übernimm sie zuerst, in ihrer Reihenfolge und ihrem Wortlaut, mit quelle „Excel“, und ergänze nur, bis es höchstens ${THEMENPLAN_MAX} sind (quelle „Analyse“). Ohne Themen aus der Seitenstruktur leitest du alle aus Hauptfrage, Leistung und Seitenkonzept ab. Kein Thema, das laut deferred_questions auf eine andere Seite gehört.`;

export const ANALYSE_HORMOZI_PAGE_RULE =
  "Diese vier Angaben gelten für GENAU diese Seite: Leite sie aus der Leistung der Seite, dem Seitenkonzept, dem Themenplan und dem Avatar zusammen ab, nicht aus dem Avatar allein. Auf zwei Seiten desselben Anbieters stehen hier verschiedene Aussagen: traumziel ist, was die Person mit genau dieser Leistung erreichen will; hauptschmerz ist, was sie bei genau diesem Thema belastet; groesste_huerde und einwaende sind die Bedenken gegen genau diese Leistung (Sprache und Reihenfolge der Einwände kommen aus dem Avatar).";

type AnalyseHormozi = { traumziel?: unknown; hauptschmerz?: unknown; groesste_huerde?: unknown; einwaende?: unknown };

/**
 * The plan as a prompt block for the steps after the Analyse. Empty for an Analyse without a plan
 * (pages analysed before this existed), so their prompts stay as they were.
 */
export function pagePlanBlock(analyseOutput: unknown): string {
  const plan = readPagePlan(analyseOutput);
  if (!hasPagePlan(plan)) return "";
  const h = rec(rec(analyseOutput).hormozi) as AnalyseHormozi;
  const einwaende = (Array.isArray(h.einwaende) ? h.einwaende : []).map((e) => text(e, 400)).filter(Boolean);
  const own = [
    text(h.traumziel, 400) ? `Traumziel: ${text(h.traumziel, 400)}` : "",
    text(h.hauptschmerz, 400) ? `Hauptschmerz: ${text(h.hauptschmerz, 400)}` : "",
    text(h.groesste_huerde, 400) ? `Größte Hürde: ${text(h.groesste_huerde, 400)}` : "",
    einwaende.length > 0 ? `Einwände: ${einwaende.join(" · ")}` : "",
  ].filter(Boolean);
  return [
    `## Seitenkonzept und Themenplan (aus der Analyse${plan.edited ? ", von der Redaktion bearbeitet" : ""}; verbindlich für diese Seite)`,
    ...(plan.seitenkonzept ? SEITENKONZEPT_FIELDS.filter((f) => plan.seitenkonzept![f.key]).map((f) => `${f.label} ${plan.seitenkonzept![f.key]}`) : []),
    ...(plan.themenplan.length > 0
      ? ["Themenplan (in dieser Reihenfolge):", ...plan.themenplan.map((t, i) => `${i + 1}. ${t.thema}${t.inhalt ? ` – ${t.inhalt}` : ""}${t.quelle !== "Analyse" ? ` (${t.quelle})` : ""}`)]
      : []),
    ...(own.length > 0 ? ["Für genau diese Seite (nicht die allgemeine Lage des Avatars):", ...own] : []),
  ].join("\n");
}

/** Fixed rule of the SEO step when the Analyse made a plan. */
export const PAGE_PLAN_RULES_SEO = `Seitenkonzept und Themenplan (feste Regel): Die Analyse enthält seitenkonzept und themenplan für genau diese Seite. Die Hauptabschnitte behandeln die Themen des Themenplans in seiner Reihenfolge, jedes Thema einmal; die Pflichtabschnitte der Seitentyp-Vorlage (H1, Hero, Kurzzusammenfassung, Fragen-Abschnitt, Abschluss) bleiben. Kurzzusammenfassung, Einleitung und Überschriften gehen vom Seitenkonzept aus: von dem Menschen, der genau diese Leistung sucht, und von dem, was er erreichen oder wissen will. Sie beginnen nicht mit der allgemeinen Lage des Avatars, die auf jeder Seite des Anbieters gleich wäre. traumziel, hauptschmerz, groesste_huerde und einwaende der Analyse gelten für diese Seite und werden so verwendet. Diese Regel geht dem Text-Prompt und der Schrittanweisung vor, nicht den Regeln zu Tatsachen.`;

/** Fixed rule of every later step that rewrites the text. */
export const PAGE_PLAN_RULES_REWRITE = `Seitenkonzept und Themenplan (feste Regel): Der Block „Seitenkonzept und Themenplan“ legt Ausrichtung und Themen dieser Seite fest. Dieser Schritt ändert beides nicht: Er streicht kein Thema des Themenplans, ergänzt kein neues Hauptthema und stellt Einstieg, Hero oder Kurzzusammenfassung nicht auf die allgemeine Lage des Avatars um, die auf jeder Seite des Anbieters gleich wäre. Wo dieser Schritt Schmerz, Ziel oder Einwände braucht, nimmt er die Angaben „Für genau diese Seite“ aus dem Block.`;

/** Fixed rule of the checking steps (Faktencheck, Endabnahme). */
export const PAGE_PLAN_RULES_CHECK = `Seitenkonzept und Themenplan (feste Regel): Der Block „Seitenkonzept und Themenplan“ legt fest, wovon diese Seite handelt. Fehlt ein Thema des Themenplans im Text ganz, oder beginnt die Seite mit einer allgemeinen Lage des Avatars statt mit dem Anliegen dieser Seite, ist das ein Befund (severity low) mit dem Abschnitt, den es betrifft.`;
