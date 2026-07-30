import Anthropic from "@anthropic-ai/sdk";

import { extractAnthropicText } from "@/lib/ai/anthropic-helpers";
import { resolveDtAnthropicModel } from "@/lib/dt/resolve-model";
import {
  getDtSitePageContent,
  searchDtSitePages,
} from "@/lib/dt/seo/search-site-pages";
import {
  inspectWebsiteUrlForTool,
  readSitemapForTool,
} from "@/lib/dt/seo/live-site-tools";
import {
  formatSeoReportRawForTool,
  loadLatestDtSeoReportRawForOrg,
} from "@/lib/dt/seo/report-detail-tool";
import { mergeUsage, sumAnthropicUsage } from "@/lib/dt/record-llm-usage";
import { sanitizeForLlmText } from "@/lib/shared/sanitize-llm-text";
import type { DtChatMode } from "@/lib/dt/types";

const MAX_TOOL_ROUNDS = 4;

export type DtAnthropicUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type DtAnthropicChatResult = {
  text: string;
  model: string;
  stopReason: string | null;
  usage: DtAnthropicUsage;
};

const DT_SEO_RETRIEVAL_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_website_content",
    description:
      "Durchsucht den vollständigen Text ALLER gecrawlten Unterseiten der Organisation nach Stichworten und liefert die relevantesten Treffer mit kurzem Auszug und URL. Nutze dies, bevor du Aussagen über Inhalte der Website triffst.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Suchbegriffe / Stichworte (z. B. „Versandkosten Rückgabe“).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "read_website_page",
    description:
      "Liefert den vollständigen Textinhalt einer einzelnen gecrawlten Seite anhand ihrer URL. Nutze dies, wenn du eine konkrete Seite im Detail brauchst.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Die exakte URL der gewünschten Unterseite." },
      },
      required: ["url"],
    },
  },
  {
    name: "read_full_seo_report",
    description:
      "Liefert die vollständigen Rohdaten (payload.raw) des letzten abgeschlossenen SEO-Reports — alle Keywords, Empfehlungen und Metriken vor der n8n-Komprimierung. Der Abschnitt „Letzter SEO-Report“ im Prompt ist nur eine Kurzfassung. Rufe dieses Werkzeug nur auf, wenn du Detailtiefe brauchst (z. B. alle Empfehlungen, vollständige Keyword-Listen, detaillierte Metriken).",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "read_sitemap",
    description:
      "Liest eine Sitemap (XML, inkl. Sitemap-Index) live und listet die enthaltenen URLs. Optional Vergleich mit dem DigitalTwin-Crawl-Index. Nutze dies, wenn der Nutzer eine Sitemap schickt oder fragt, welche URLs in der Sitemap stehen. Behaupte nie, du könntest keine Sitemap lesen.",
    input_schema: {
      type: "object",
      properties: {
        sitemapUrl: {
          type: "string",
          description:
            "Optionale Sitemap-URL (z. B. https://example.de/sitemap.xml). Wenn leer: Org-Sitemap bzw. Website/sitemap.xml.",
        },
      },
    },
  },
  {
    name: "inspect_website_url",
    description:
      "Live-Check einer öffentlichen URL: HTTP-Status, Title, Meta-Robots/noindex, Canonical und ob die URL im DigitalTwin-Crawl-Index liegt. Nutze dies für Erreichbarkeit/noindex — nicht mit Google-Indexierung verwechseln.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Die zu prüfende absolute URL." },
      },
      required: ["url"],
    },
  },
];

async function runDtRetrievalTool(
  organisationId: string,
  name: string,
  input: unknown,
): Promise<string> {
  const args = (input ?? {}) as Record<string, unknown>;
  try {
    if (name === "search_website_content") {
      const query = String(args.query ?? "").trim();
      if (!query) return "Kein Suchbegriff angegeben.";
      const hits = await searchDtSitePages(organisationId, query, 5);
      if (hits.length === 0) return `Keine Treffer für „${query}“ in den gecrawlten Seiten.`;
      return hits
        .map((h, i) => `${i + 1}. ${h.title ?? h.url}\n   URL: ${h.url}\n   Auszug: ${h.snippet}`)
        .join("\n\n");
    }
    if (name === "read_website_page") {
      const url = String(args.url ?? "").trim();
      if (!url) return "Keine URL angegeben.";
      const page = await getDtSitePageContent(organisationId, url);
      if (!page) return `Keine gecrawlte Seite für ${url} gefunden.`;
      if (!page.content.trim()) {
        return `Seite ${page.url} ist gecrawlt, enthält aber keinen extrahierbaren Text (evtl. JavaScript-gerendert).`;
      }
      return `Inhalt von ${page.url}${page.title ? ` (${page.title})` : ""}:\n\n${page.content}`;
    }
    if (name === "read_full_seo_report") {
      const report = await loadLatestDtSeoReportRawForOrg(organisationId);
      return formatSeoReportRawForTool(report);
    }
    if (name === "read_sitemap") {
      const sitemapUrl = typeof args.sitemapUrl === "string" ? args.sitemapUrl : null;
      return readSitemapForTool(organisationId, sitemapUrl);
    }
    if (name === "inspect_website_url") {
      const url = String(args.url ?? "").trim();
      if (!url) return "Keine URL angegeben.";
      return inspectWebsiteUrlForTool(organisationId, url);
    }
    return `Unbekanntes Werkzeug: ${name}`;
  } catch (err) {
    return `Fehler beim Abrufen: ${err instanceof Error ? err.message : "unbekannt"}`;
  }
}

function sanitizeAnthropicMessages(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  return messages.map((message) => {
    if (typeof message.content === "string") {
      return { ...message, content: sanitizeForLlmText(message.content) };
    }

    if (!Array.isArray(message.content)) return message;

    return {
      ...message,
      content: message.content.map((block) => {
        if (block.type === "text" && "text" in block && typeof block.text === "string") {
          return { ...block, text: sanitizeForLlmText(block.text) };
        }
        return block;
      }),
    };
  });
}

function resultFromResponse(
  resp: Anthropic.Message,
  model: string,
  usage: DtAnthropicUsage,
): DtAnthropicChatResult {
  return {
    text: extractAnthropicText(resp) || "Keine Antwort erhalten.",
    model,
    stopReason: resp.stop_reason ?? null,
    usage,
  };
}

export async function callDtAnthropicChat(params: {
  system: string;
  messages: Anthropic.MessageParam[];
  mode: DtChatMode;
  /** When provided (SEO mode), enables on-demand website-content retrieval tools. */
  retrieval?: { organisationId: string };
}): Promise<DtAnthropicChatResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY fehlt.");
  }

  const model = resolveDtAnthropicModel(params.mode);
  const client = new Anthropic({ apiKey });
  const max_tokens = params.mode === "seo" ? 8192 : 4096;
  const system = sanitizeForLlmText(params.system);

  const retrievalOrgId = params.mode === "seo" ? params.retrieval?.organisationId : undefined;

  if (!retrievalOrgId) {
    const resp = await client.messages.create({
      model,
      max_tokens,
      system,
      messages: sanitizeAnthropicMessages(params.messages),
    });
    return resultFromResponse(resp, model, sumAnthropicUsage(resp.usage));
  }

  const messages: Anthropic.MessageParam[] = sanitizeAnthropicMessages(params.messages);
  let lastResp: Anthropic.Message | null = null;
  let totalUsage: DtAnthropicUsage = { inputTokens: 0, outputTokens: 0 };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const resp = await client.messages.create({
      model,
      max_tokens,
      system,
      messages,
      tools: DT_SEO_RETRIEVAL_TOOLS,
    });
    lastResp = resp;
    totalUsage = mergeUsage(totalUsage, sumAnthropicUsage(resp.usage));

    if (resp.stop_reason !== "tool_use") {
      return resultFromResponse(resp, model, totalUsage);
    }

    const toolUses = resp.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    messages.push({ role: "assistant", content: resp.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const output = await runDtRetrievalTool(retrievalOrgId, tu.name, tu.input);
      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: output });
    }
    messages.push({ role: "user", content: toolResults });
  }

  const finalResp = await client.messages.create({
    model,
    max_tokens,
    system,
    messages,
  });
  totalUsage = mergeUsage(totalUsage, sumAnthropicUsage(finalResp.usage));

  return {
    text:
      extractAnthropicText(finalResp) ||
      (lastResp ? extractAnthropicText(lastResp) : "") ||
      "Keine Antwort erhalten.",
    model,
    stopReason: finalResp.stop_reason ?? null,
    usage: totalUsage,
  };
}

export function suggestChatTitle(userMessage: string, assistantMessage: string): string {
  const raw = userMessage.trim() || assistantMessage.trim();
  const oneLine = raw.replace(/\s+/g, " ").slice(0, 60);
  return oneLine.length > 0 ? oneLine : "Neuer Chat";
}
