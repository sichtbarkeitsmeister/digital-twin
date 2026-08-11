import { NextResponse } from "next/server";
import { z } from "zod";

import {
  comparePromptToSurveyFacts,
  loadAgentSurveyFactsBundle,
} from "@/lib/dt/agent-survey-coverage";
import { requireAuthUser } from "@/lib/dt/db";
import { isMemberOfOrganisation } from "@/lib/dashboard/org-context";

const bodySchema = z.object({
  promptTemplate: z.string().max(64_000),
  promptAppend: z.string().max(32_000).nullable().optional(),
});

/**
 * Compare an agent's (draft) prompt against its source questionnaire answers.
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
      "id,organisation_id,name,source_survey_id,source_survey_response_id,prompt_template,prompt_append",
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

  const surveyId = agent.source_survey_id as string | null;
  const responseId = agent.source_survey_response_id as string | null;
  if (!surveyId || !responseId) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Dieser Agent hat keine Fragebogen-Herkunft — Abgleich ist nur für Umfrage-Avatare möglich.",
      },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
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
    coverage,
  });
}
