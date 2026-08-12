import { NextResponse } from "next/server";
import { z } from "zod";

import {
  comparePromptToSurveyFacts,
  loadAgentSurveyFactsBundle,
} from "@/lib/dt/agent-survey-coverage";
import {
  listSurveyResponsesForAgentCoverage,
  suggestCoverageOptionForAgent,
} from "@/lib/dt/agent-survey-coverage-options";
import { requireAuthUser } from "@/lib/dt/db";
import { isMemberOfOrganisation } from "@/lib/dashboard/org-context";

const bodySchema = z.object({
  promptTemplate: z.string().max(64_000),
    promptAppend: z.string().max(120_000).nullable().optional(),
  /** Optional override — compare against any completed response (current questionnaire data). */
  surveyId: z.string().uuid().optional(),
  responseId: z.string().uuid().optional(),
});

/**
 * List questionnaire responses available for Abgleich for this agent/org.
 */
export async function GET(
  _: Request,
  context: { params: Promise<{ agentId: string }> },
) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const { agentId } = await context.params;
  const { data: agent, error } = await auth.supabase
    .from("dt_agents")
    .select(
      "id,organisation_id,name,kind,source_survey_id,source_survey_response_id",
    )
    .eq("id", agentId)
    .maybeSingle();

  if (error || !agent) {
    return NextResponse.json({ ok: false, message: "Agent nicht gefunden." }, { status: 404 });
  }

  const member = await isMemberOfOrganisation(
    auth.supabase,
    auth.userId,
    agent.organisation_id as string,
  );
  if (!member) {
    return NextResponse.json({ ok: false, message: "Kein Zugriff." }, { status: 403 });
  }

  const options = await listSurveyResponsesForAgentCoverage({
    organisationId: agent.organisation_id as string,
    agentId: agent.id as string,
    agentKind: agent.kind as string,
    sourceSurveyId: agent.source_survey_id as string | null,
    sourceResponseId: agent.source_survey_response_id as string | null,
  });

  const suggested = suggestCoverageOptionForAgent(
    options,
    (agent.name as string) ?? "",
  );

  return NextResponse.json({
    ok: true,
    options,
    sourceSurveyId: agent.source_survey_id,
    sourceResponseId: agent.source_survey_response_id,
    defaultResponseId: suggested?.responseId ?? null,
  });
}

/**
 * Compare an agent's (draft) prompt against current questionnaire answers.
 * Uses stored survey lineage by default, or an explicitly selected response.
 */
export async function POST(
  req: Request,
  context: { params: Promise<{ agentId: string }> },
) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const { agentId } = await context.params;
  const { data: agent, error } = await auth.supabase
    .from("dt_agents")
    .select(
      "id,organisation_id,name,kind,source_survey_id,source_survey_response_id,prompt_template,prompt_append",
    )
    .eq("id", agentId)
    .maybeSingle();

  if (error || !agent) {
    return NextResponse.json({ ok: false, message: "Agent nicht gefunden." }, { status: 404 });
  }

  const member = await isMemberOfOrganisation(
    auth.supabase,
    auth.userId,
    agent.organisation_id as string,
  );
  if (!member) {
    return NextResponse.json({ ok: false, message: "Kein Zugriff." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  let surveyId = parsed.data.surveyId ?? (agent.source_survey_id as string | null);
  let responseId =
    parsed.data.responseId ?? (agent.source_survey_response_id as string | null);

  if (!surveyId || !responseId) {
    const options = await listSurveyResponsesForAgentCoverage({
      organisationId: agent.organisation_id as string,
      agentId: agent.id as string,
      agentKind: agent.kind as string,
      sourceSurveyId: agent.source_survey_id as string | null,
      sourceResponseId: agent.source_survey_response_id as string | null,
    });
    const pick =
      suggestCoverageOptionForAgent(options, (agent.name as string) ?? "") ??
      null;
    if (!pick) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Keine abgeschlossene Umfrage-Antwort für diese Organisation gefunden. Bitte zuerst einen Fragebogen ausfüllen.",
        },
        { status: 400 },
      );
    }
    surveyId = pick.surveyId;
    responseId = pick.responseId;
  }

  // Ensure selected response belongs to an accessible org survey (or agent source).
  const options = await listSurveyResponsesForAgentCoverage({
    organisationId: agent.organisation_id as string,
    agentId: agent.id as string,
    agentKind: agent.kind as string,
    sourceSurveyId: agent.source_survey_id as string | null,
    sourceResponseId: agent.source_survey_response_id as string | null,
  });
  const allowed = options.some(
    (o) => o.surveyId === surveyId && o.responseId === responseId,
  );
  if (!allowed) {
    // Still allow explicit pair if the survey is org-linked (may be outside limit).
    const supabase = (await import("@/lib/supabase/service")).createServiceClient();
    const { data: survey } = await supabase
      .from("surveys")
      .select("id, organisation_id")
      .eq("id", surveyId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!survey || survey.organisation_id !== agent.organisation_id) {
      return NextResponse.json(
        { ok: false, message: "Diese Umfrage-Antwort gehört nicht zur Organisation." },
        { status: 403 },
      );
    }
  }

  const loaded = await loadAgentSurveyFactsBundle(surveyId, responseId);
  if (!loaded.ok) {
    return NextResponse.json(
      { ok: false, message: loaded.message },
      { status: loaded.status },
    );
  }

  const coverage = comparePromptToSurveyFacts({
    facts: loaded.bundle.facts,
    promptTemplate: parsed.data.promptTemplate,
    promptAppend: parsed.data.promptAppend,
  });

  return NextResponse.json({
    ok: true,
    agentId: agent.id,
    agentName: agent.name,
    surveyId,
    responseId,
    surveyTitle: loaded.bundle.surveyTitle,
    factCount: loaded.bundle.facts.length,
    usedStoredSource: Boolean(
      agent.source_survey_id === surveyId &&
        agent.source_survey_response_id === responseId,
    ),
    coverage,
  });
}
