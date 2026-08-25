import type { SupabaseClient } from "@supabase/supabase-js";

import { isDefaultTwinAgent, isSeoAdvisorAgent } from "@/lib/dt/agents/seo-advisor";
import { hasAvatarGlobalPromptAnchor } from "@/lib/dt/prompts/avatar-global-prompt-anchor";
import { isProspectPersonaKind } from "@/lib/dt/prompts/build-system-prompt";
import { buildSurveyResponseContextForSeo } from "@/lib/dt/survey-facts";
import type { SurveyFieldQuestionRow } from "@/lib/dt/survey-to-agent-context";
import { normalizeSurveyPurpose } from "@/lib/surveys/purpose";

export const SEO_WUNSCHKUNDE_PROFILE_MAX_CHARS = 4500;
export const SEO_WUNSCHKUNDEN_TOTAL_MAX_CHARS = 18_000;

export type SeoWunschkundeSourceKind = "agent" | "survey";

export type SeoWunschkundeProfile = {
  id: string;
  name: string;
  role: string | null;
  sourceKind: SeoWunschkundeSourceKind;
  surveyTitle: string | null;
  body: string;
  bodyFrom: "survey_facts" | "avatar_prompt" | "empty";
};

type AgentKnowledgeRow = {
  id: string;
  name: string;
  role: string | null;
  kind: string;
  slug: string | null;
  is_enabled: boolean | null;
  is_default: boolean | null;
  prompt_append: string | null;
  source_survey_id: string | null;
  source_survey_response_id: string | null;
};

type SurveyRow = {
  id: string;
  title: string;
  definition: unknown;
  purpose: unknown;
};

type ResponseRow = {
  id: string;
  survey_id: string;
  status: string;
  answers: unknown;
  completed_at: string | null;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Avatars the SEO advisor should treat as Wunschkunden of this organisation. */
export function isSeoWunschkundeSourceAgent(agent: {
  kind?: string | null;
  slug?: string | null;
  is_enabled?: boolean | null;
  is_default?: boolean | null;
}): boolean {
  if (agent.is_enabled === false) return false;
  if (isSeoAdvisorAgent(agent)) return false;
  if (isDefaultTwinAgent(agent)) return false;
  if (agent.is_default) return false;
  return isProspectPersonaKind(agent.kind, agent.slug);
}

export function clipSeoKnowledgeText(text: string, maxChars: number): string {
  const t = text.trim();
  if (maxChars <= 0 || t.length <= maxChars) return t;
  const budget = Math.max(24, maxChars - 16);
  const sliced = t.slice(0, budget);
  const nl = sliced.lastIndexOf("\n");
  const cut = nl > budget * 0.55 ? sliced.slice(0, nl) : sliced;
  return `${cut.trimEnd()}\n… (gekürzt)`;
}

/**
 * Drop the shared DigitalTwin role-anchor so SEO context only keeps
 * personality / situation facts — not “stay in first person” rules.
 */
export function stripAvatarAnchorForSeoKnowledge(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (!hasAvatarGlobalPromptAnchor(trimmed)) return trimmed;

  const withoutHeading = trimmed.replace(
    /##\s*ANKER:\s*GLOBALER\s+DIGITALTWIN-PROMPT\s*/i,
    "",
  );
  const lines = withoutHeading.split("\n");
  const kept: string[] = [];
  let skippingPreamble = true;
  for (const line of lines) {
    if (skippingPreamble) {
      const t = line.trim();
      if (!t) continue;
      if (/^(dieser text ist nur|die verbindlichen regeln|bei widerspruch gilt)/i.test(t)) {
        continue;
      }
      skippingPreamble = false;
    }
    kept.push(line);
  }
  return kept.join("\n").trim();
}

function formatProfileHeading(profile: SeoWunschkundeProfile): string {
  const role = profile.role?.trim();
  const title = role ? `### Wunschkunde: ${profile.name} (${role})` : `### Wunschkunde: ${profile.name}`;
  const sourceParts: string[] = [];
  if (profile.sourceKind === "agent") sourceParts.push(`Avatar „${profile.name}“`);
  if (profile.surveyTitle?.trim()) {
    sourceParts.push(`Fragebogen „${profile.surveyTitle.trim()}“`);
  } else if (profile.sourceKind === "survey") {
    sourceParts.push("Persona-Fragebogen (noch kein Avatar)");
  }
  if (profile.bodyFrom === "avatar_prompt") {
    sourceParts.push("Profiltext — nicht in Ich-Form nachahmen");
  }
  const source = sourceParts.length > 0 ? `Quelle: ${sourceParts.join(" · ")}` : "";
  return source ? `${title}\n${source}` : title;
}

export function formatWunschkundenKnowledgeForSeo(
  profiles: SeoWunschkundeProfile[],
): string {
  const intro = [
    "## Wunschkunden-Wissen (Zielgruppen)",
    "",
    "Die folgenden Profile beschreiben die Wunschkunden dieser Organisation — die Zielgruppen, nicht das Unternehmen selbst.",
    "- Anbieter-Wissen (in den zusätzlichen Anweisungen) = Fakten über die Firma (Name, Leistungen, Standorte).",
    "- Dieser Abschnitt = Fakten über die Menschen, die ihr gewinnen wollt (Sprache, Sorgen, Suchintention, Einwände).",
    "- Du bleibst SEO-Berater. Sprich NICHT als diese Personen und übernimm nicht ihre Ich-Form.",
    "- Mehrere Wunschkunden nicht zu einem Durchschnittskunden vermischen. Nenne sie namentlich, wenn der Unterschied relevant ist.",
    "",
  ];

  if (profiles.length === 0) {
    return [
      ...intro,
      "Noch keine Wunschkunden hinterlegt. Sobald Persona-Avatare existieren oder ein abgeschlossener Persona-Fragebogen dieser Organisation zugeordnet ist, erscheint das Wissen hier automatisch — ohne extra „In SEO-Berater übernehmen“.",
    ].join("\n");
  }

  const perBudget = Math.min(
    SEO_WUNSCHKUNDE_PROFILE_MAX_CHARS,
    Math.max(800, Math.floor(SEO_WUNSCHKUNDEN_TOTAL_MAX_CHARS / profiles.length)),
  );

  const blocks = profiles.map((profile) => {
    const heading = formatProfileHeading(profile);
    const body =
      profile.body.trim() ||
      "Noch keine verwertbaren Angaben zu diesem Wunschkunden.";
    return clipSeoKnowledgeText(`${heading}\n\n${body}`, perBudget);
  });

  return clipSeoKnowledgeText([...intro, blocks.join("\n\n")].join("\n"), SEO_WUNSCHKUNDEN_TOTAL_MAX_CHARS);
}

function answersRecord(answers: unknown): Record<string, unknown> {
  return isRecord(answers) ? answers : {};
}

function factsFromSurveyBundle(input: {
  surveyTitle: string;
  definition: unknown;
  answers: unknown;
  fieldQuestions: SurveyFieldQuestionRow[];
}): string {
  return buildSurveyResponseContextForSeo({
    surveyTitle: input.surveyTitle,
    definition: input.definition,
    answers: answersRecord(input.answers),
    fieldQuestions: input.fieldQuestions,
  }).trim();
}

async function loadSurveyFactBundles(
  supabase: SupabaseClient,
  responseIds: string[],
): Promise<
  Map<
    string,
    {
      surveyTitle: string;
      surveyId: string;
      facts: string;
    }
  >
> {
  const map = new Map<string, { surveyTitle: string; surveyId: string; facts: string }>();
  if (responseIds.length === 0) return map;

  const { data: responses, error: responseError } = await supabase
    .from("survey_responses")
    .select("id, survey_id, status, answers, completed_at")
    .in("id", responseIds);

  if (responseError) {
    console.warn("[dt] wunschkunden responses:", responseError.message);
    return map;
  }

  const completed = ((responses ?? []) as ResponseRow[]).filter(
    (r) => r.status === "completed",
  );
  const surveyIds = [...new Set(completed.map((r) => r.survey_id).filter(Boolean))];
  if (surveyIds.length === 0) return map;

  const { data: surveys, error: surveyError } = await supabase
    .from("surveys")
    .select("id, title, definition, purpose")
    .in("id", surveyIds)
    .is("deleted_at", null);

  if (surveyError) {
    console.warn("[dt] wunschkunden surveys:", surveyError.message);
    return map;
  }

  const surveyById = new Map(
    ((surveys ?? []) as SurveyRow[]).map((s) => [s.id, s] as const),
  );

  const { data: questions, error: questionsError } = await supabase
    .from("survey_field_questions")
    .select("id, response_id, field_id, kind, question, answer")
    .in("response_id", completed.map((r) => r.id));

  if (questionsError) {
    console.warn("[dt] wunschkunden field questions:", questionsError.message);
  }

  const questionsByResponse = new Map<string, SurveyFieldQuestionRow[]>();
  for (const q of questions ?? []) {
    const responseId = String((q as { response_id?: string }).response_id ?? "");
    if (!responseId) continue;
    const list = questionsByResponse.get(responseId) ?? [];
    list.push({
      id: String((q as { id: string }).id),
      field_id: String((q as { field_id: string }).field_id),
      kind: String((q as { kind: string }).kind),
      question: String((q as { question: string }).question ?? ""),
      answer: (q as { answer: string | null }).answer,
    });
    questionsByResponse.set(responseId, list);
  }

  for (const response of completed) {
    const survey = surveyById.get(response.survey_id);
    if (!survey) continue;
    if (normalizeSurveyPurpose(survey.purpose) !== "persona") continue;
    const facts = factsFromSurveyBundle({
      surveyTitle: survey.title,
      definition: survey.definition,
      answers: response.answers,
      fieldQuestions: questionsByResponse.get(response.id) ?? [],
    });
    if (!facts || facts === "Keine verwertbaren Unternehmensfakten gefunden.") continue;
    map.set(response.id, {
      surveyTitle: survey.title,
      surveyId: survey.id,
      facts,
    });
  }

  return map;
}

function profileFromAgent(
  agent: AgentKnowledgeRow,
  factBundle: { surveyTitle: string; facts: string } | undefined,
): SeoWunschkundeProfile {
  if (factBundle?.facts) {
    return {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      sourceKind: "agent",
      surveyTitle: factBundle.surveyTitle,
      body: factBundle.facts,
      bodyFrom: "survey_facts",
    };
  }

  const avatar = stripAvatarAnchorForSeoKnowledge(agent.prompt_append ?? "");
  if (avatar) {
    return {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      sourceKind: "agent",
      surveyTitle: null,
      body: avatar,
      bodyFrom: "avatar_prompt",
    };
  }

  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    sourceKind: "agent",
    surveyTitle: null,
    body: "",
    bodyFrom: "empty",
  };
}

async function loadUnconvertedPersonaSurveys(
  supabase: SupabaseClient,
  organisationId: string,
  usedResponseIds: Set<string>,
  usedSurveyIds: Set<string>,
): Promise<SeoWunschkundeProfile[]> {
  const { data: surveys, error: surveyError } = await supabase
    .from("surveys")
    .select("id, title, definition, purpose")
    .eq("organisation_id", organisationId)
    .is("deleted_at", null);

  if (surveyError) {
    console.warn("[dt] wunschkunden org surveys:", surveyError.message);
    return [];
  }

  const personaSurveys = ((surveys ?? []) as SurveyRow[]).filter(
    (s) =>
      normalizeSurveyPurpose(s.purpose) === "persona" && !usedSurveyIds.has(s.id),
  );
  if (personaSurveys.length === 0) return [];

  const surveyIds = personaSurveys.map((s) => s.id);
  const { data: responses, error: responseError } = await supabase
    .from("survey_responses")
    .select("id, survey_id, status, answers, completed_at")
    .in("survey_id", surveyIds)
    .eq("status", "completed");

  if (responseError) {
    console.warn("[dt] wunschkunden org responses:", responseError.message);
    return [];
  }

  const latestBySurvey = new Map<string, ResponseRow>();
  for (const row of (responses ?? []) as ResponseRow[]) {
    if (usedResponseIds.has(row.id)) continue;
    const prev = latestBySurvey.get(row.survey_id);
    const prevTime = prev?.completed_at ?? "";
    const nextTime = row.completed_at ?? "";
    if (!prev || nextTime > prevTime) latestBySurvey.set(row.survey_id, row);
  }

  const leftoverIds = [...latestBySurvey.values()].map((r) => r.id);
  const factMap = await loadSurveyFactBundles(supabase, leftoverIds);
  const surveyById = new Map(personaSurveys.map((s) => [s.id, s] as const));

  const profiles: SeoWunschkundeProfile[] = [];
  for (const [surveyId, response] of latestBySurvey) {
    const facts = factMap.get(response.id);
    const survey = surveyById.get(surveyId);
    if (!facts || !survey) continue;
    profiles.push({
      id: `survey:${response.id}`,
      name: survey.title.replace(/\s*fragebogen\s*/i, " ").trim() || survey.title,
      role: null,
      sourceKind: "survey",
      surveyTitle: survey.title,
      body: facts.facts,
      bodyFrom: "survey_facts",
    });
  }
  return profiles;
}

export async function loadWunschkundeProfilesForSeo(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<SeoWunschkundeProfile[]> {
  const { data: agents, error: agentError } = await supabase
    .from("dt_agents")
    .select(
      "id, name, role, kind, slug, is_enabled, is_default, prompt_append, source_survey_id, source_survey_response_id",
    )
    .eq("organisation_id", organisationId)
    .eq("is_enabled", true)
    .order("position", { ascending: true });

  if (agentError) {
    throw new Error(agentError.message);
  }

  const wunschkunden = ((agents ?? []) as AgentKnowledgeRow[]).filter(
    isSeoWunschkundeSourceAgent,
  );

  const responseIds = [
    ...new Set(
      wunschkunden
        .map((a) => a.source_survey_response_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const factMap = await loadSurveyFactBundles(supabase, responseIds);

  const profiles = wunschkunden.map((agent) => {
    const bundle = agent.source_survey_response_id
      ? factMap.get(agent.source_survey_response_id)
      : undefined;
    return profileFromAgent(
      agent,
      bundle ? { surveyTitle: bundle.surveyTitle, facts: bundle.facts } : undefined,
    );
  });

  const usedResponseIds = new Set(responseIds);
  const usedSurveyIds = new Set(
    wunschkunden
      .map((a) => a.source_survey_id)
      .filter((id): id is string => Boolean(id)),
  );
  const extra = await loadUnconvertedPersonaSurveys(
    supabase,
    organisationId,
    usedResponseIds,
    usedSurveyIds,
  );

  return [...profiles, ...extra];
}

export async function loadWunschkundenKnowledgeForSeo(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<string> {
  try {
    const profiles = await loadWunschkundeProfilesForSeo(supabase, organisationId);
    return formatWunschkundenKnowledgeForSeo(profiles);
  } catch (err) {
    console.error("[dt] wunschkunden knowledge:", err);
    return formatWunschkundenKnowledgeForSeo([]);
  }
}
