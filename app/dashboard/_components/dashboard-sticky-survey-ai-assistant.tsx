"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { SurveyAiAssistant } from "@/components/surveys/survey-ai-assistant";
import { surveySchema } from "@/lib/surveys/schema";
import { surveyFromReviewOrNull } from "@/lib/surveys/fragebogen-review-draft";
import { useFragebogenWizardDraft } from "@/lib/surveys/fragebogen-wizard-draft-store";
import { useSurveyBuilderLiveSurvey } from "@/lib/surveys/survey-builder-live-store";
import type { Survey } from "@/lib/surveys/types";

export type DashboardSurveyAiPageContext = {
  page:
    | "survey_list"
    | "survey_builder_new"
    | "survey_builder_edit"
    | "dt_agents"
    | "survey_to_agent";
  surveyId: string | null;
  organisationId?: string | null;
  agentId?: string | null;
};

function uuidOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  )
    ? value
    : null;
}

/**
 * Derive Survey-KI page context from the current dashboard URL.
 * Keeps the floating assistant sticky across navigation.
 */
export function resolveDashboardSurveyAiPageContext(
  pathname: string,
  searchParams: URLSearchParams,
): DashboardSurveyAiPageContext {
  const org = uuidOrNull(searchParams.get("org"));
  const agent = uuidOrNull(searchParams.get("agent"));

  if (pathname.startsWith("/dashboard/verwaltung/agents")) {
    return {
      page: "dt_agents",
      surveyId: null,
      organisationId: org,
      agentId: agent,
    };
  }

  const createAgentMatch = pathname.match(
    /^\/dashboard\/surveys\/([^/]+)\/responses\/[^/]+\/create-agent\/?$/,
  );
  if (createAgentMatch) {
    return {
      page: "survey_to_agent",
      surveyId: uuidOrNull(createAgentMatch[1]),
      organisationId: org,
      agentId: agent,
    };
  }

  if (
    pathname === "/dashboard/surveys/new" ||
    pathname === "/dashboard/frageboegen/neu" ||
    pathname.startsWith("/dashboard/frageboegen/neu/")
  ) {
    return { page: "survey_builder_new", surveyId: null, organisationId: org };
  }

  const editMatch = pathname.match(/^\/dashboard\/surveys\/([^/]+)\/edit\/?$/);
  if (editMatch) {
    return {
      page: "survey_builder_edit",
      surveyId: uuidOrNull(editMatch[1]),
      organisationId: org,
    };
  }

  if (pathname === "/dashboard/surveys" || pathname.startsWith("/dashboard/surveys/")) {
    const surveyFromPath = pathname.match(/^\/dashboard\/surveys\/([^/]+)\/?$/);
    return {
      page: "survey_list",
      surveyId: surveyFromPath ? uuidOrNull(surveyFromPath[1]) : null,
      organisationId: org,
    };
  }

  if (
    pathname === "/dashboard/frageboegen" ||
    pathname.startsWith("/dashboard/frageboegen/")
  ) {
    return {
      page: "survey_list",
      surveyId: null,
      organisationId: org,
    };
  }

  // Anywhere else in the dashboard: still available for agent-prompt edits etc.
  return {
    page: "survey_list",
    surveyId: null,
    organisationId: org,
    agentId: agent,
  };
}

export function buildStickySurveyAiAssistantContext(input: {
  resolved: DashboardSurveyAiPageContext;
  wizardSurvey: Survey | null;
  builderSurvey: Survey | null;
}) {
  const wizardId = uuidOrNull(input.wizardSurvey?.id);
  const onWizard =
    input.resolved.page === "survey_builder_new" &&
    Boolean(input.wizardSurvey && wizardId);
  const parsedBuilder = input.builderSurvey
    ? surveySchema.safeParse(input.builderSurvey)
    : null;
  const builderOk = parsedBuilder?.success ? parsedBuilder.data : null;
  const onBuilderEdit = input.resolved.page === "survey_builder_edit" && Boolean(builderOk);

  return {
    page: input.resolved.page,
    surveyId: onWizard ? wizardId : input.resolved.surveyId,
    organisationId: input.resolved.organisationId ?? null,
    agentId: input.resolved.agentId ?? null,
    liveWizardDraft: onWizard,
    currentSurvey: onWizard
      ? input.wizardSurvey ?? undefined
      : onBuilderEdit
        ? builderOk ?? undefined
        : undefined,
  };
}

/**
 * Platform-admin floating Survey KI — one instance for the whole dashboard.
 */
export function DashboardStickySurveyAiAssistant() {
  const pathname = usePathname() || "/dashboard";
  const searchParams = useSearchParams();
  const liveDraft = useFragebogenWizardDraft();
  const builderSurvey = useSurveyBuilderLiveSurvey();

  const resolved = useMemo(
    () => resolveDashboardSurveyAiPageContext(pathname, searchParams),
    [pathname, searchParams],
  );

  const liveSurvey = useMemo(
    () => surveyFromReviewOrNull(liveDraft.draft),
    [liveDraft.draft],
  );

  const buildContext = useCallback(
    () =>
      buildStickySurveyAiAssistantContext({
        resolved,
        wizardSurvey: liveSurvey,
        builderSurvey,
      }),
    [resolved, liveSurvey, builderSurvey],
  );

  return (
    <SurveyAiAssistant title="KI Survey Assistant" buildContext={buildContext} />
  );
}
