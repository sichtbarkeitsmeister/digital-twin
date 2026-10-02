/** Buyer-side value equation. Same names as the persona exam. Industry-neutral. */
export const AVATAR_VALUE_FIELDS = [
  { key: "schmerz", label: "Schmerz" },
  { key: "traumergebnis", label: "Traumergebnis" },
  { key: "dringlichkeit", label: "Dringlichkeit" },
  { key: "huerde", label: "Hürde" },
  { key: "aufwand", label: "Aufwand und Verzicht" },
  { key: "zeit", label: "Zeit" },
  { key: "wahrscheinlichkeit", label: "Wahrscheinlichkeit" },
] as const;

export type AvatarValueKey = (typeof AVATAR_VALUE_FIELDS)[number]["key"];

/** Staff questions every new avatar gets, in this order. */
export const AVATAR_QUICK_ACTIONS = [
  "Stell dich bitte vor",
  "Wie bist du auf uns aufmerksam geworden und was bringt dich zu uns?",
  "Was weißt du schon alles über uns?",
  "Wie kann ich dir helfen?",
  "Was erwartest du nach der Zusammenarbeit mit uns?",
] as const;

const ROLE_MAX = 72;
const ROLE_MAX_WORDS = 6;

/** Job titles the model sometimes copies instead of inventing a first name. */
const NOT_A_GIVEN_NAME = new Set([
  "geschäftsführer",
  "geschäftsführerin",
  "inhaber",
  "inhaberin",
  "leiter",
  "leiterin",
  "leitung",
  "einrichtungsleitung",
  "chef",
  "chefin",
  "kunde",
  "kundin",
  "interessent",
  "interessentin",
  "wunschkunde",
  "mitarbeiter",
  "mitarbeiterin",
  "unternehmer",
  "unternehmerin",
  "avatar",
  "persona",
  "standard",
  "global",
  "it",
  "gf",
]);

const ROLE_TAIL = new Set([
  "mit",
  "bis",
  "ohne",
  "eines",
  "einer",
  "einem",
  "einen",
  "und",
  "oder",
  "für",
  "von",
  "der",
  "die",
  "das",
  "dem",
  "den",
  "im",
  "in",
  "am",
  "an",
  "zu",
  "zur",
  "zum",
  "als",
  "auf",
  "bei",
  "nach",
  "vor",
  "über",
  "durch",
  "nicht",
  "keine",
  "kein",
  "etwa",
  "ca",
]);

export function avatarFirstName(raw: string): string {
  const word = raw
    .normalize("NFC")
    .replace(/[^\p{L}]/gu, " ")
    .trim()
    .split(/\s+/)
    .find((part) => part.length >= 2);
  if (!word) return "";
  const lower = word.toLocaleLowerCase("de-DE");
  if (NOT_A_GIVEN_NAME.has(lower)) return "";
  return lower.charAt(0).toLocaleUpperCase("de-DE") + lower.slice(1);
}

export function avatarShortRole(raw: string): string {
  const words = raw.replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean).slice(0, ROLE_MAX_WORDS);
  let text = words.join(" ");
  if (text.length > ROLE_MAX) {
    const cut = text.slice(0, ROLE_MAX + 1);
    const space = cut.lastIndexOf(" ");
    text = space >= 12 ? cut.slice(0, space) : text.slice(0, ROLE_MAX);
  }
  const kept = text
    .replace(/[,:;–\-]+$/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  while (kept.length > 2) {
    const tail = kept[kept.length - 1].toLocaleLowerCase("de-DE").replace(/[,:;–\-]+$/g, "");
    if (!ROLE_TAIL.has(tail) && !/^\d+$/.test(tail)) break;
    kept.pop();
  }
  return kept.join(" ").replace(/[,:;–\-]+$/g, "").trim();
}

type AvatarPromptSource = {
  narrative: string;
  quotes: string[];
  gaps: string[];
} & Record<AvatarValueKey, string>;

/**
 * The preview model was rewriting the dossier into a short essay. That dropped
 * names, ranges and quotes, and filled open points. The prompt is the dossier.
 */
export function buildAvatarPrompt(name: string, dossier: AvatarPromptSource): string {
  const lines = [
    `Ich heiße ${name.trim()}.`,
    "",
    "Ich spreche als dieser Interessent, in der Ich-Form. Es gilt nur, was unten steht. Ich ergänze keine Zahl, keinen Preis, keine Frist und keinen Vergleich. Ich mache eine genannte Spanne nicht enger. Ein Fallbeispiel gilt nur für diesen Fall. Was als offen markiert ist, sage ich nicht.",
  ];
  const narrative = dossier.narrative.trim();
  if (narrative) {
    lines.push("", "**Was über mich belegt ist:**", narrative);
  }
  for (const field of AVATAR_VALUE_FIELDS) {
    const text = dossier[field.key].trim();
    lines.push("", `**${field.label}:**`, text || "Offen. Nichts dazu erfinden.");
  }
  const quotes = dossier.quotes.map((quote) => quote.trim()).filter(Boolean);
  if (quotes.length) {
    lines.push(
      "",
      "**Zitate, nur in diesem Wortlaut:**",
      ...quotes.map((quote) => `- „${quote.replace(/^["„»]|["“«]$/g, "")}“`),
    );
  }
  const gaps = dossier.gaps.map((gap) => gap.trim()).filter(Boolean);
  if (gaps.length) {
    lines.push("", "**Was nicht geht:**", ...gaps.map((gap) => `- ${gap}`));
  }
  return lines.join("\n");
}

export function ensureAvatarIntroducesSelf(name: string, prompt: string): string {
  const trimmed = prompt.trim();
  if (!name) return trimmed;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const starts = new RegExp(`^ich hei(?:ß|ss)e ${escaped}\\b`, "i");
  if (starts.test(trimmed)) return trimmed;
  return `Ich heiße ${name}.\n\n${trimmed}`;
}
