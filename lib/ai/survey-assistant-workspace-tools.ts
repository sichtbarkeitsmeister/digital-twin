import type Anthropic from "@anthropic-ai/sdk";

import {
  callAnthropicFirstAvailable,
  extractAnthropicText,
  type SurveyChatSystem,
} from "@/lib/ai/anthropic-helpers";
import { loadFocusedOrgWorkspace } from "@/lib/ai/load-survey-assistant-workspace";
import {
  matchOrganisationIdsInText,
  type SurveyAssistantOrgDirectoryEntry,
} from "@/lib/ai/survey-assistant-workspace";
import {
  getDtSitePageContent,
  searchDtSitePages,
} from "@/lib/dt/seo/search-site-pages";

const MAX_TOOL_ROUNDS = 6;

export const SURVEY_ASSISTANT_WORKSPACE_TOOLS: Anthropic.Tool[] = [
  {
    name: "lookup_organisation_workspace",
    description:
      "Lädt Crawl-Zusammenfassung, Seitenindex und offene SEO-Aufgaben einer Organisation. Nutze dies, wenn die gewünschte Organisation nicht bereits im fokussierten Workspace steht oder der Nutzer nach Crawl/Aufgaben einer anderen Org fragt.",
    input_schema: {
      type: "object",
      properties: {
        organisationId: {
          type: "string",
          description: "UUID der Organisation (bevorzugt, aus Known organisations).",
        },
        name: {
          type: "string",
          description: "Name, Slug oder Website, falls die UUID unbekannt ist.",
        },
      },
    },
  },
  {
    name: "search_website_content",
    description:
      "Durchsucht den vollständigen Text ALLER gecrawlten Unterseiten einer Organisation nach Stichworten und liefert Treffer mit kurzem Auszug und URL. Nutze dies, bevor du über Website-Inhalte spekulierst oder Platzhalter im Fragebogen füllst.",
    input_schema: {
      type: "object",
      properties: {
        organisationId: {
          type: "string",
          description: "UUID der Organisation. Wenn leer: die aktuell fokussierte Organisation.",
        },
        query: {
          type: "string",
          description: "Suchbegriffe (z. B. „Team Geschäftsführer Leistungen Adresse“).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "read_website_page",
    description:
      "Liefert den vollständigen Textinhalt einer einzelnen gecrawlten Seite. Nutze dies für eine konkrete URL aus dem Crawl-Index.",
    input_schema: {
      type: "object",
      properties: {
        organisationId: {
          type: "string",
          description: "UUID der Organisation. Wenn leer: die aktuell fokussierte Organisation.",
        },
        url: { type: "string", description: "Die exakte URL der gewünschten Unterseite." },
      },
      required: ["url"],
    },
  },
];

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}

function resolveOrganisationId(input: {
  requestedId: string | null;
  name: string | null;
  organisations: SurveyAssistantOrgDirectoryEntry[];
  defaultOrganisationId: string | null;
}): { ok: true; organisationId: string } | { ok: false; message: string } {
  if (input.requestedId) {
    const hit = input.organisations.find((o) => o.id === input.requestedId);
    if (hit) return { ok: true, organisationId: hit.id };
    return {
      ok: false,
      message: `Unbekannte organisationId ${input.requestedId}. Nutze eine id aus „Known organisations“.`,
    };
  }

  if (input.name?.trim()) {
    const matches = matchOrganisationIdsInText(input.name, input.organisations);
    if (matches.length === 1) return { ok: true, organisationId: matches[0]! };
    if (matches.length > 1) {
      const labels = matches
        .map((id) => {
          const org = input.organisations.find((o) => o.id === id);
          return org ? `${org.displayName || org.name} (${org.id})` : id;
        })
        .join(", ");
      return {
        ok: false,
        message: `Mehrere Organisationen passen zu „${input.name.trim()}“: ${labels}. Bitte organisationId angeben.`,
      };
    }
    return {
      ok: false,
      message: `Keine Organisation zu „${input.name.trim()}“ gefunden. Prüfe „Known organisations“.`,
    };
  }

  if (input.defaultOrganisationId) {
    return { ok: true, organisationId: input.defaultOrganisationId };
  }

  return {
    ok: false,
    message:
      "Keine Organisation angegeben. Übergib organisationId aus „Known organisations“ oder den Namen.",
  };
}

export async function runSurveyAssistantWorkspaceTool(input: {
  name: string;
  args: unknown;
  organisations: SurveyAssistantOrgDirectoryEntry[];
  defaultOrganisationId: string | null;
}): Promise<string> {
  const args = asRecord(input.args);
  const requestedId =
    typeof args.organisationId === "string" && args.organisationId.trim()
      ? args.organisationId.trim()
      : null;
  const nameArg = typeof args.name === "string" ? args.name : null;

  try {
    if (input.name === "lookup_organisation_workspace") {
      const resolved = resolveOrganisationId({
        requestedId,
        name: nameArg,
        organisations: input.organisations,
        defaultOrganisationId: input.defaultOrganisationId,
      });
      if (!resolved.ok) return resolved.message;
      const packed = await loadFocusedOrgWorkspace(resolved.organisationId);
      if (!packed) return `Organisation ${resolved.organisationId} nicht gefunden.`;
      return [
        `${packed.organisationName} (${packed.organisationId})`,
        packed.websiteUrl ? `Website: ${packed.websiteUrl}` : "Website: (nicht hinterlegt)",
        `Crawl-Seiten: ${packed.crawlPageCount}`,
        "",
        packed.crawlSummary,
        "",
        packed.sitePageIndex,
        "",
        packed.openTasks,
      ].join("\n");
    }

    if (input.name === "search_website_content") {
      const resolved = resolveOrganisationId({
        requestedId,
        name: nameArg,
        organisations: input.organisations,
        defaultOrganisationId: input.defaultOrganisationId,
      });
      if (!resolved.ok) return resolved.message;
      const query = String(args.query ?? "").trim();
      if (!query) return "Kein Suchbegriff angegeben.";
      const hits = await searchDtSitePages(resolved.organisationId, query, 6);
      if (hits.length === 0) {
        return `Keine Treffer für „${query}“ im Crawl von ${resolved.organisationId}.`;
      }
      return hits
        .map((h, i) => `${i + 1}. ${h.title ?? h.url}\n   URL: ${h.url}\n   Auszug: ${h.snippet}`)
        .join("\n\n");
    }

    if (input.name === "read_website_page") {
      const resolved = resolveOrganisationId({
        requestedId,
        name: nameArg,
        organisations: input.organisations,
        defaultOrganisationId: input.defaultOrganisationId,
      });
      if (!resolved.ok) return resolved.message;
      const url = String(args.url ?? "").trim();
      if (!url) return "Keine URL angegeben.";
      const page = await getDtSitePageContent(resolved.organisationId, url);
      if (!page) return `Keine gecrawlte Seite für ${url} gefunden.`;
      if (!page.content.trim()) {
        return `Seite ${page.url} ist gecrawlt, enthält aber keinen extrahierbaren Text.`;
      }
      return `Inhalt von ${page.url}${page.title ? ` (${page.title})` : ""}:\n\n${page.content}`;
    }

    return `Unbekanntes Werkzeug: ${input.name}`;
  } catch (err) {
    return `Fehler beim Abrufen: ${err instanceof Error ? err.message : "unbekannt"}`;
  }
}

function toolStatusMessage(name: string, args: unknown): string {
  const rec = asRecord(args);
  if (name === "search_website_content") {
    const q = String(rec.query ?? "").trim();
    return q ? `Ich durchsuche den Crawl nach „${q.slice(0, 60)}“…` : "Ich durchsuche den Crawl…";
  }
  if (name === "read_website_page") {
    const url = String(rec.url ?? "").trim();
    return url ? `Ich lade die gecrawlte Seite ${url.slice(0, 80)}…` : "Ich lade eine gecrawlte Seite…";
  }
  if (name === "lookup_organisation_workspace") {
    const label = String(rec.name ?? rec.organisationId ?? "").trim();
    return label
      ? `Ich lade Crawl und Aufgaben für ${label.slice(0, 80)}…`
      : "Ich lade Organisations-Crawl und Aufgaben…";
  }
  return "Ich lade weiteren Workspace-Kontext…";
}

export async function callAnthropicWithSurveyWorkspaceTools(input: {
  anthropic: Anthropic;
  models: string[];
  maxTokens: number;
  system: SurveyChatSystem;
  messages: Anthropic.MessageParam[];
  timeoutMs?: number;
  organisations: SurveyAssistantOrgDirectoryEntry[];
  defaultOrganisationId: string | null;
  onStatus?: (message: string) => void;
}): Promise<{ response: Anthropic.Messages.Message; model: string } | null> {
  const messages: Anthropic.MessageParam[] = [...input.messages];
  let last: { response: Anthropic.Messages.Message; model: string } | null = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const call = await callAnthropicFirstAvailable({
      anthropic: input.anthropic,
      models: last ? [last.model] : input.models,
      maxTokens: input.maxTokens,
      system: input.system,
      messages,
      timeoutMs: input.timeoutMs,
      tools: SURVEY_ASSISTANT_WORKSPACE_TOOLS,
    });
    if (!call) return last;
    last = call;

    if (call.response.stop_reason !== "tool_use") {
      return call;
    }

    const toolUses = call.response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (toolUses.length === 0) return call;

    messages.push({ role: "assistant", content: call.response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      input.onStatus?.(toolStatusMessage(tu.name, tu.input));
      const output = await runSurveyAssistantWorkspaceTool({
        name: tu.name,
        args: tu.input,
        organisations: input.organisations,
        defaultOrganisationId: input.defaultOrganisationId,
      });
      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: output });
    }
    messages.push({ role: "user", content: toolResults });
  }

  const finalCall = await callAnthropicFirstAvailable({
    anthropic: input.anthropic,
    models: last ? [last.model] : input.models,
    maxTokens: input.maxTokens,
    system: input.system,
    messages,
    timeoutMs: input.timeoutMs,
  });
  return finalCall ?? last;
}
