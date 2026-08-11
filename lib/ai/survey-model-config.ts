/** Default models — overridable via env (see resolve*Models). */
export const DEFAULT_SURVEY_CHAT_MODEL = "claude-haiku-4-5-20251001";
export const DEFAULT_SURVEY_ACTION_MODEL = "claude-sonnet-4-6";

const CHAT_MODEL_FALLBACKS = [
  DEFAULT_SURVEY_CHAT_MODEL,
  "claude-3-5-haiku-latest",
] as const;

const ACTION_MODEL_FALLBACKS = [
  DEFAULT_SURVEY_ACTION_MODEL,
  "claude-sonnet-4-20250514",
  "claude-3-5-sonnet-latest",
] as const;

function uniqueModels(candidates: string[]): string[] {
  return Array.from(new Set(candidates.map((m) => m.trim()).filter(Boolean)));
}

/** Conversational turns (prose, brainstorming, explanations). */
export function resolveSurveyChatModels(): string[] {
  const preferred = process.env.ANTHROPIC_SURVEY_CHAT_MODEL?.trim() || DEFAULT_SURVEY_CHAT_MODEL;
  return uniqueModels([preferred, ...CHAT_MODEL_FALLBACKS]);
}

/** Structured survey actions (create/edit/publish/folder ops). */
export function resolveSurveyActionModels(): string[] {
  const preferred =
    process.env.ANTHROPIC_SURVEY_ACTION_MODEL?.trim() ||
    process.env.ANTHROPIC_SURVEY_MODEL?.trim() ||
    DEFAULT_SURVEY_ACTION_MODEL;
  return uniqueModels([preferred, ...ACTION_MODEL_FALLBACKS]);
}

/** Cheap utility calls: chat titles, JSON repair. */
export function resolveSurveyUtilityModels(): string[] {
  const preferred = process.env.ANTHROPIC_SURVEY_CHAT_MODEL?.trim() || DEFAULT_SURVEY_CHAT_MODEL;
  return uniqueModels([preferred, ...CHAT_MODEL_FALLBACKS]);
}

const ACTION_VERB_RE =
  /\b(erstell(?:e|en)|leg(?:e|en)\s+(?:eine|einen|an)|create|generier(?:e|en)|generate|füg(?:e|en)\s+hinzu|add|einfüg|bearbeit(?:e|en)|edit|änder(?:e|en)|change|update|patch|korrigier(?:e|en)|fix|reparier(?:e|en)|lösch(?:e|en)|delete|entfern(?:e|en)|remove|veröffentlich(?:e|en)|publish|unpublish|depublish|ordner|folder|speicher(?:e|n)|abspeicher(?:e|n)|umbenenn(?:e|en)|rename|zuweis(?:e|en)|assign|überarbeit(?:e|en)|rewrite|ersetz(?:e|en)|replace|duplikat|duplicate\s*id|infotext|schritt\s+\d+|step\s+\d+|frage(?:n)?\s+(?:hinzu|ändern|entfernen)|prompt|persona|agent(?:en)?|wunschkunde|avatar)\b/i;

const CHAT_SIGNAL_RE =
  /\b(was\s+(?:ist|sind|bedeutet)|wie\s+(?:funktioniert|kann|soll|würde)|warum|erklär(?:e| mir|ung)|explain|hilf\s+mir\s+(?:bei|beim|zu\s+verstehen)|brainstorm|ideen\s+für|best\s+practice|unterschied\s+zwischen)\b/i;

const QUESTION_ONLY_RE = /^\s*(?:was|wie|warum|welche|wann|wo|who|what|how|why|can you explain)[\s,?]/i;

type ActionIntentInput = {
  userMessage: string;
  page:
    | "survey_list"
    | "survey_builder_new"
    | "survey_builder_edit"
    | "dt_agents"
    | "survey_to_agent";
  /** Last assistant message looked like action JSON */
  recentAssistantWasAction?: boolean;
};

/**
 * Heuristic pre-router: action intents need Sonnet-quality JSON; chat turns use Haiku.
 * When uncertain on builder pages, prefer action (edits are likely).
 */
export function isLikelySurveyActionIntent(input: ActionIntentInput): boolean {
  const text = input.userMessage.trim();
  if (!text) return false;

  if (ACTION_VERB_RE.test(text)) return true;

  if (input.recentAssistantWasAction && /\b(nochmal|erneut|korrigier|fix|retry|wiederhol)\b/i.test(text)) {
    return true;
  }

  if (
    input.page === "survey_builder_edit" ||
    input.page === "survey_builder_new" ||
    input.page === "dt_agents" ||
    input.page === "survey_to_agent"
  ) {
    if (CHAT_SIGNAL_RE.test(text) || QUESTION_ONLY_RE.test(text)) return false;
    if (text.length > 80 && !text.endsWith("?")) return true;
  }

  if (CHAT_SIGNAL_RE.test(text) && !ACTION_VERB_RE.test(text)) return false;
  if (QUESTION_ONLY_RE.test(text) && !ACTION_VERB_RE.test(text)) return false;

  return false;
}

export function selectSurveyModelsForMessage(input: ActionIntentInput): {
  modelsToTry: string[];
  tier: "chat" | "action";
  maxTokens: number;
} {
  const action = isLikelySurveyActionIntent(input);
  return {
    tier: action ? "action" : "chat",
    modelsToTry: action ? resolveSurveyActionModels() : resolveSurveyChatModels(),
    maxTokens: action ? 16384 : 4096,
  };
}

export const MULTIPHASE_MIN_STEPS = 12;
export const MULTIPHASE_STEP_CHUNK_SIZE = 6;

const CREATE_SURVEY_RE =
  /\b(erstell(?:e|en)|leg(?:e|en)\s+(?:eine|einen|an)|create|generier(?:e|en)|generate|neue\s+umfrage|speicher(?:e|n)|abspeicher(?:e|n)|anleg(?:e|en)|übernehm(?:e|en))\b/i;
const SURVEY_NOUN_RE = /\b(umfrage|survey|fragebogen)\b/i;
/** Pasted questionnaires are often long even without an explicit "create" verb. */
const LARGE_PASTE_CHAR_THRESHOLD = 6_000;

/** Large new-survey requests use phased generation (outline → batched expand). */
export function isLargeSurveyCreationIntent(userMessage: string): boolean {
  const text = userMessage.trim();
  if (!text) return false;

  const hasSurveyNoun = SURVEY_NOUN_RE.test(text);
  const hasCreateVerb = CREATE_SURVEY_RE.test(text);
  const looksLikeNumberedQuestionnaire = /#{1,3}\s+\d+\./.test(text);
  // German Fragebogen pastes often omit the word "fragebogen" and only say "abspeichern".
  const largePaste =
    text.length >= LARGE_PASTE_CHAR_THRESHOLD &&
    (hasCreateVerb || looksLikeNumberedQuestionnaire || /\b(?:frage|fragen)\b/i.test(text));

  if (largePaste && (hasSurveyNoun || looksLikeNumberedQuestionnaire || hasCreateVerb)) {
    return true;
  }

  if (!hasSurveyNoun) return false;
  if (!hasCreateVerb) return false;

  const numMatch =
    text.match(/\b(\d{1,3})\s*(?:\+?\s*)?(?:fragen|questions|schritte|steps|seiten|pages)\b/i) ||
    text.match(/\b(?:mindestens|über|more\s+than|at\s+least)\s*(\d{1,3})\b/i);
  if (numMatch && parseInt(numMatch[1]!, 10) >= MULTIPHASE_MIN_STEPS) return true;

  if (
    /\b(große|großes|umfangreich|comprehensive|ausführlich|sehr\s+viele|viele\s+fragen|long\s+survey|big\s+survey)\b/i.test(
      text,
    )
  ) {
    return true;
  }

  return false;
}
