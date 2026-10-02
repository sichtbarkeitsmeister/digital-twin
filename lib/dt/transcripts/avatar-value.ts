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

const INTERNAL_WORKSHOP_NOTE =
  /anbieter-persona|nachgespr[aä]ch|turboscribe|white-?paper|keywords f[uü]r seo|satz bricht im original|workshop-transcript|premium-segment/i;

function looseText(text: string): string {
  return text
    .toLocaleLowerCase("de-DE")
    .replace(/[„“"»«']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Workshop protocol, not something the prospect would say. */
export function containsInternalWorkshopNotes(text: string): boolean {
  return INTERNAL_WORKSHOP_NOTE.test(text);
}

export function dropInternalWorkshopParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph && !containsInternalWorkshopNotes(paragraph))
    .join("\n\n");
}

/**
 * Speaking prompt for the prospect. The dossier stays the full evidence file.
 * This text keeps the approved title, the spoken body, missing quotes, and open points.
 */
export function buildProspectPrompt(input: {
  name: string;
  title: string;
  body: string;
  quotes: string[];
  gaps: string[];
}): string {
  const name = input.name.trim();
  const title = input.title.trim().replace(/\.+$/, "");
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = input.body
    .trim()
    .replace(new RegExp(`^ich hei(?:ß|ss)e ${escaped}\\.?\\s*`, "i"), "")
    .trim();
  const lines = [
    `Ich heiße ${name}.`,
    "",
    title ? `Ich bin ${title}.` : "",
    "",
    "Ich spreche als dieser Interessent, in der Ich-Form, über meine Lage. Ich erzähle nicht den Workshop, keine internen Unterlagen und keine Preisstrategie. Ich ergänze keine Zahl, keinen Preis, keine Frist und keinen Vergleich. Ich mache eine genannte Spanne nicht enger. Ein Fallbeispiel gilt nur für diesen Fall. Was unter „Was nicht geht“ steht, behaupte ich nicht.",
    "",
    body,
  ].filter((line, index, all) => line !== "" || all[index - 1] !== "");

  let prompt = lines.join("\n");
  const quotes = input.quotes.map((quote) => quote.trim()).filter(Boolean);
  const missingQuotes = quotes.filter((quote) => !looseText(prompt).includes(looseText(quote).slice(0, 80)));
  if (missingQuotes.length) {
    prompt += `\n\n**Zitate, nur in diesem Wortlaut:**\n${missingQuotes
      .map((quote) => `- „${quote.replace(/^["„»]|["“«]$/g, "")}“`)
      .join("\n")}`;
  }
  const gaps = input.gaps.map((gap) => gap.trim()).filter(Boolean);
  const missingGaps = gaps.filter((gap) => !looseText(prompt).includes(looseText(gap).slice(0, 60)));
  if (missingGaps.length) {
    prompt += `\n\n**Was nicht geht:**\n${missingGaps.map((gap) => `- ${gap}`).join("\n")}`;
  }
  return prompt.replace(/\n{3,}/g, "\n\n").trim();
}

export function ensureAvatarIntroducesSelf(name: string, prompt: string): string {
  const trimmed = prompt.trim();
  if (!name) return trimmed;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const starts = new RegExp(`^ich hei(?:ß|ss)e ${escaped}\\b`, "i");
  if (starts.test(trimmed)) return trimmed;
  return `Ich heiße ${name}.\n\n${trimmed}`;
}
