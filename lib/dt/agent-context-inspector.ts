import type { SupabaseClient } from "@supabase/supabase-js";

import { buildDtSystemPrompt } from "@/lib/dt/prompts/build-system-prompt";
import { buildDtGeoGroundingText } from "@/lib/dt/prompts/geo-grounding";
import { buildDtChatStaticSystemText } from "@/lib/dt/prompts/system-static";
import {
  DT_SEO_MODE_INSTRUCTIONS,
  formatDtSitePagesForPrompt,
  loadDtSitePagesForPrompt,
} from "@/lib/dt/seo/build-seo-context";
import {
  formatDtSeoMonthlyStatsForPrompt,
  loadDtSeoMonthlyStats,
} from "@/lib/dt/seo/monthly-stats";
import {
  formatDtSeoReportForPrompt,
  loadLatestDtSeoReportForPrompt,
} from "@/lib/dt/seo/report-prompt-context";
import {
  formatDtSeoTasksForPrompt,
  loadDtSeoTasksForPrompt,
} from "@/lib/dt/seo/task-context";
import { PASTED_URL_PROMPT_HINT_DE } from "@/lib/shared/pasted-url-context";
import { createServiceClient } from "@/lib/supabase/service";

export type DtAgentContextSourceType =
  | "system"
  | "agent"
  | "organisation"
  | "user"
  | "crawl"
  | "report"
  | "analytics"
  | "tasks"
  | "dynamic";

export type DtAgentContextMode = "default" | "seo" | "team";

export type DtAgentContextSection = {
  id: string;
  title: string;
  sourceLabel: string;
  sourceType: DtAgentContextSourceType;
  description: string;
  content: string;
  isEmpty: boolean;
  editHref?: string;
  meta?: Record<string, string | number>;
};

export type DtAgentContextBundle = {
  organisationId: string;
  organisationName: string;
  agentId: string;
  agentName: string;
  agentKind: string;
  mode: DtAgentContextMode;
  sections: DtAgentContextSection[];
  excludedNote: string;
  assembledPreviewChars: number;
};

export function estimateSectionChars(content: string): number {
  return content.trim().length;
}

function formatSeoChecklist(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length === 0) return "";
  return raw
    .map((item, i) => {
      if (typeof item === "string") return `${i + 1}. ${item}`;
      if (item && typeof item === "object" && "label" in item) {
        const label = String((item as { label?: unknown }).label ?? "").trim();
        if (label) return `${i + 1}. ${label}`;
      }
      return null;
    })
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function section(
  partial: Omit<DtAgentContextSection, "isEmpty"> & { isEmpty?: boolean },
): DtAgentContextSection {
  const content = partial.content.trim();
  return {
    ...partial,
    content,
    isEmpty: partial.isEmpty ?? content.length === 0,
  };
}

export async function loadDtAgentContextBundle(input: {
  userId: string;
  organisationId: string;
  agentId: string;
  mode: DtAgentContextMode;
  supabase?: SupabaseClient;
}): Promise<DtAgentContextBundle> {
  const supabase = input.supabase ?? createServiceClient();

  const { data: organisation } = await supabase
    .from("organisations")
    .select("id, name")
    .eq("id", input.organisationId)
    .maybeSingle();

  if (!organisation) {
    throw new Error("Organisation nicht gefunden.");
  }

  const { data: agent } = await supabase
    .from("dt_agents")
    .select("id, name, role, kind, prompt_template")
    .eq("id", input.agentId)
    .eq("organisation_id", input.organisationId)
    .maybeSingle();

  if (!agent) {
    throw new Error("Agent nicht gefunden.");
  }

  const { data: orgConfig } = await supabase
    .from("dt_org_config")
    .select(
      "display_name, website_url, focus_keyword, seo_checklist, sitemap_url",
    )
    .eq("organisation_id", input.organisationId)
    .maybeSingle();

  const { data: prefs } = await supabase
    .from("dt_user_preferences")
    .select("global_assistant_rules")
    .eq("user_id", input.userId)
    .maybeSingle();

  const promptMode =
    input.mode === "team" ? "team" : input.mode === "seo" ? "seo" : "default";
  const isSeoOrGeo =
    promptMode === "seo" || agent.kind === "geo_advisor";

  const sitePages = isSeoOrGeo
    ? await loadDtSitePagesForPrompt(supabase, input.organisationId)
    : [];
  const monthlyStatsRows =
    promptMode === "seo"
      ? await loadDtSeoMonthlyStats(supabase, input.organisationId, 12)
      : [];
  const latestSeoReport =
    promptMode === "seo"
      ? await loadLatestDtSeoReportForPrompt(supabase, input.organisationId)
      : null;
  const seoTaskRows =
    promptMode === "seo"
      ? await loadDtSeoTasksForPrompt(supabase, input.organisationId)
      : [];

  const globalRules = prefs?.global_assistant_rules?.trim() ?? "";
  const checklistText = formatSeoChecklist(orgConfig?.seo_checklist);
  const sitePagesText = formatDtSitePagesForPrompt(sitePages);
  const latestReportText = formatDtSeoReportForPrompt(latestSeoReport);
  const monthlyStatsText = formatDtSeoMonthlyStatsForPrompt(monthlyStatsRows);
  const seoTasksText = formatDtSeoTasksForPrompt(seoTaskRows);

  const orgQuery = encodeURIComponent(input.organisationId);
  const agentsEditHref = `/dashboard/verwaltung/agents?org=${orgQuery}`;
  const seoSettingsHref = `/dashboard/verwaltung/seo?org=${orgQuery}&tab=settings`;
  const seoTasksHref = `/dashboard/verwaltung/seo?org=${orgQuery}&tab=tasks`;
  const reportEditHref = latestSeoReport
    ? `/dashboard/verwaltung/seo/reports/${latestSeoReport.id}`
    : undefined;

  const identityLines = [
    `Du bist ${agent.name}${agent.role ? ` (${agent.role})` : ""}.`,
    `Organisation: ${orgConfig?.display_name ?? agent.name}.`,
    orgConfig?.website_url ? `Website: ${orgConfig.website_url}.` : "",
    orgConfig?.focus_keyword
      ? `Fokus-Keyword: ${orgConfig.focus_keyword}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const sections: DtAgentContextSection[] = [
    section({
      id: "static_rules",
      title: "System-Anweisungen",
      sourceLabel: "System",
      sourceType: "system",
      description:
        "Fest im Code hinterlegte Regeln für alle DigitalTwin-Chats (Sprache, Markdown, keine erfundenen Aktionen).",
      content: buildDtChatStaticSystemText(),
    }),
    section({
      id: "identity",
      title: "Identität",
      sourceLabel: "Agent + Organisation",
      sourceType: "agent",
      description:
        "Name, Rolle und Organisations-Metadaten aus Agent und dt_org_config.",
      content: identityLines,
      editHref: agentsEditHref,
      meta: { agentKind: agent.kind },
    }),
    section({
      id: "persona",
      title: "Persona-Anweisungen",
      sourceLabel: "Agent",
      sourceType: "agent",
      description: "Individuelles Prompt-Template des gewählten Agenten.",
      content: agent.prompt_template?.trim() || "Kein Prompt hinterlegt.",
      editHref: agentsEditHref,
    }),
  ];

  if (globalRules) {
    sections.push(
      section({
        id: "user_rules",
        title: "Deine globalen Regeln",
        sourceLabel: "Deine Einstellungen",
        sourceType: "user",
        description:
          "Persönliche Zusatzregeln aus dt_user_preferences — gelten für alle deine DigitalTwin-Chats.",
        content: globalRules,
        editHref: "/settings#digital-twin-settings",
      }),
    );
  } else {
    sections.push(
      section({
        id: "user_rules",
        title: "Deine globalen Regeln",
        sourceLabel: "Deine Einstellungen",
        sourceType: "user",
        description:
          "Persönliche Zusatzregeln aus dt_user_preferences — aktuell leer.",
        content: "",
        isEmpty: true,
        editHref: "/settings#digital-twin-settings",
      }),
    );
  }

  if (isSeoOrGeo) {
    sections.push(
      section({
        id: "geo_grounding",
        title: "GEO-Grundlagen",
        sourceLabel: "System",
        sourceType: "system",
        description:
          "Fester GEO/LLM-Sichtbarkeitsblock für SEO- und geo_advisor-Agenten.",
        content: buildDtGeoGroundingText(),
      }),
    );

    if (checklistText) {
      sections.push(
        section({
          id: "seo_checklist",
          title: "SEO-Checkliste",
          sourceLabel: "Organisation",
          sourceType: "organisation",
          description: "Checkliste aus dt_org_config.seo_checklist.",
          content: checklistText,
          editHref: seoSettingsHref,
        }),
      );
    } else {
      sections.push(
        section({
          id: "seo_checklist",
          title: "SEO-Checkliste",
          sourceLabel: "Organisation",
          sourceType: "organisation",
          description: "Noch keine Checkliste hinterlegt.",
          content: "",
          isEmpty: true,
          editHref: seoSettingsHref,
        }),
      );
    }

    if (orgConfig?.sitemap_url) {
      sections.push(
        section({
          id: "sitemap",
          title: "Sitemap",
          sourceLabel: "Organisation",
          sourceType: "organisation",
          description: "Sitemap-URL aus dt_org_config.",
          content: `Sitemap: ${orgConfig.sitemap_url}`,
          editHref: seoSettingsHref,
        }),
      );
    }
  }

  if (promptMode === "seo") {
    sections.push(
      section({
        id: "seo_instructions",
        title: "SEO-Modus Regeln",
        sourceLabel: "System",
        sourceType: "system",
        description:
          "Verhaltensregeln für SEO-Chat inkl. Aufgaben-Vorschlagsformat.",
        content: DT_SEO_MODE_INSTRUCTIONS,
      }),
      section({
        id: "pasted_url_hint",
        title: "Hinweis zu eingefügten URLs",
        sourceLabel: "System (dynamisch)",
        sourceType: "dynamic",
        description:
          "Statischer Hinweis im Prompt. Der tatsächliche Seiteninhalt wird nur eingefügt, wenn du URLs in einer Nachricht sendest — nicht hier sichtbar.",
        content: PASTED_URL_PROMPT_HINT_DE,
      }),
      section({
        id: "site_pages",
        title: "Prüfbare Unterseiten",
        sourceLabel: "Crawl",
        sourceType: "crawl",
        description:
          "Kompakter Index der gecrawlten Seiten (nur Titel + URL, nicht ausgeschlossen). Voller Text wird on-demand über die Such-/Lese-Werkzeuge geladen, nicht hier.",
        content: sitePagesText,
        isEmpty: sitePages.length === 0,
        editHref: seoSettingsHref,
        meta: { pageCount: sitePages.length },
      }),
      section({
        id: "latest_report",
        title: "Letzter SEO-Report",
        sourceLabel: "Report",
        sourceType: "report",
        description:
          "Neuester abgeschlossener Report aus dt_seo_reports — wird in den Prompt formatiert.",
        content:
          latestReportText.trim() ||
          "Kein abgeschlossener SEO-Report geladen.",
        isEmpty: !latestSeoReport,
        editHref: reportEditHref,
        meta: latestSeoReport?.finished_at
          ? { finishedAt: latestSeoReport.finished_at }
          : undefined,
      }),
      section({
        id: "monthly_stats",
        title: "Monatliche SEO-Trends",
        sourceLabel: "Analytics",
        sourceType: "analytics",
        description: "Aggregierte monatliche Statistiken für Verlaufsfragen.",
        content:
          monthlyStatsText.trim() ||
          "Keine monatlichen SEO-Statistiken hinterlegt.",
        isEmpty: monthlyStatsRows.length === 0,
        editHref: `/dashboard/verwaltung/seo?org=${orgQuery}&tab=stats`,
      }),
      section({
        id: "seo_tasks",
        title: "Bestehende SEO-Aufgaben",
        sourceLabel: "Aufgaben-Board",
        sourceType: "tasks",
        description:
          "Offene und laufende Aufgaben — verhindert doppelte Vorschläge im Chat.",
        content:
          seoTasksText.trim() ||
          "Keine Aufgabenliste geladen — vor Task-Empfehlungen kurz prüfen, ob der Nutzer schon Aufgaben im Board hat.",
        isEmpty: seoTaskRows.length === 0,
        editHref: seoTasksHref,
        meta: { taskCount: seoTaskRows.length },
      }),
    );
  }

  if (promptMode === "team") {
    sections.push(
      section({
        id: "team_mode",
        title: "Team-Modus",
        sourceLabel: "System",
        sourceType: "system",
        description:
          "Hinweis für geteilte Chats. Im Verlauf werden Nutzernamen vor Nachrichten gesetzt — das ist Chat-Historie und hier nicht enthalten.",
        content:
          "Mehrere Teammitglieder nutzen diesen Chat. Beachte, wer gesprochen hat, wenn Namen im Verlauf stehen.",
      }),
    );
  }

  const assembled = buildDtSystemPrompt({
    agent: {
      name: agent.name,
      role: agent.role,
      prompt_template:
        agent.prompt_template?.trim() || "Du bist ein hilfreicher Assistent.",
      kind: agent.kind,
    },
    org: {
      display_name: orgConfig?.display_name ?? agent.name,
      website_url: orgConfig?.website_url,
      focus_keyword: orgConfig?.focus_keyword,
      seo_checklist: orgConfig?.seo_checklist,
      sitemap_url: orgConfig?.sitemap_url,
    },
    mode: promptMode,
    globalRules: globalRules || undefined,
    sitePages: promptMode === "seo" ? sitePages : undefined,
    latestSeoReportText: promptMode === "seo" ? latestReportText : undefined,
    monthlyStatsText: promptMode === "seo" ? monthlyStatsText : undefined,
    seoTasksText: promptMode === "seo" ? seoTasksText : undefined,
  });

  return {
    organisationId: input.organisationId,
    organisationName: organisation.name,
    agentId: agent.id,
    agentName: agent.name,
    agentKind: agent.kind,
    mode: input.mode,
    sections,
    excludedNote:
      "Nicht enthalten: Chat-Verlauf, Nachrichten-Anhänge und dynamisch eingefügte URL-Inhalte aus einzelnen Nachrichten.",
    assembledPreviewChars: estimateSectionChars(assembled),
  };
}
