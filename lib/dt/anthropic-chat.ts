import Anthropic from "@anthropic-ai/sdk";

import {
  callAnthropicFirstAvailable,
  extractAnthropicText,
} from "@/lib/ai/anthropic-helpers";
import { fallbackDtChatTitle } from "@/lib/dt/chat-title";
import { resolveDtAnthropicModel } from "@/lib/dt/resolve-model";
import {
  getDtSitePageContent,
  searchDtSitePages,
} from "@/lib/dt/seo/search-site-pages";
import {
  auditSiteIndexabilityForTool,
  inspectWebsiteUrlForTool,
  readSitemapForTool,
} from "@/lib/dt/seo/live-site-tools";
import {
  formatSeoReportRawForTool,
  loadLatestDtSeoReportRawForOrg,
} from "@/lib/dt/seo/report-detail-tool";
import { formatSerpSnippetCheckForTool } from "@/lib/dt/seo/serp-pixel";
import {
  answerGroundingDraftForTool,
  startGroundingDraftForTool,
  updateGroundingPageForTool,
} from "@/lib/dt/seo/grounding-tools";
import {
  appendWebResearchNotes,
  DT_WEB_RESEARCH_TOOLS,
  inspectWebResearchBlocks,
  mergeWebResearchUsage,
  sumServerToolUsage,
  type DtWebResearchUsage,
} from "@/lib/dt/seo/web-research";
import {
  deleteSeoTaskForTool,
  updateSeoTaskForTool,
} from "@/lib/dt/seo/task-tools";
import {
  readIndexStatusForTool,
  triggerGscIndexCheckN8n,
} from "@/lib/dt/seo/url-index-status";
import { mergeUsage, sumAnthropicUsage } from "@/lib/dt/record-llm-usage";
import { sanitizeForLlmText } from "@/lib/shared/sanitize-llm-text";
import type { DtChatMode } from "@/lib/dt/types";
import {
  buildCreatedChatFile,
  createdFileToolResultMessage,
  DT_MAX_CREATED_FILE_CHARS,
  DT_MAX_CREATED_FILES,
  type DtCreatedChatFile,
} from "@/lib/dt/chat-files";

const MAX_TOOL_ROUNDS = 6;
/** How often one chat turn may recover from an output cut off at `max_tokens`. */
const MAX_TRUNCATION_RECOVERIES = 2;

export type DtAnthropicUsage = {
  inputTokens: number;
  outputTokens: number;
  /** Websuchen (Anthropic server tool) in dieser Antwort — kostet extra. */
  webSearchRequests?: number;
  /** Web-Abrufe (Anthropic server tool) in dieser Antwort — nur Tokens. */
  webFetchRequests?: number;
};

export type DtAnthropicChatResult = {
  text: string;
  model: string;
  stopReason: string | null;
  usage: DtAnthropicUsage;
  createdFiles: DtCreatedChatFile[];
};

const DT_CREATE_FILE_TOOL: Anthropic.Tool = {
  name: "create_file",
  description:
    `Erzeugt eine echte Datei, die der Nutzer im Chat öffnen, anschauen und herunterladen kann (HTML-Vorschau, PDF, Excel, CSV, Markdown, Text, JSON). Nutze dies, sobald der Nutzer eine Datei, ein Dokument, eine Tabelle oder ein Artefakt braucht — nicht nur Code in der Antwort zeigen. Maximal ${DT_MAX_CREATED_FILE_CHARS} Zeichen je Datei — längere Inhalte auf mehrere Dateien oder mehrere Antworten aufteilen.`,
  input_schema: {
    type: "object",
    properties: {
      filename: {
        type: "string",
        description: "Dateiname inkl. Endung, z. B. angebot.pdf, landingpage.html, keywords.xlsx",
      },
      format: {
        type: "string",
        enum: ["html", "markdown", "text", "csv", "json", "pdf", "xlsx"],
        description: "Dateiformat. html = interaktive Vorschau, pdf = druckbares Dokument, xlsx = Excel.",
      },
      content: {
        type: "string",
        description:
          "Dateiinhalt. HTML: Markup. PDF: Fließtext. Excel/CSV: Tabellen als CSV oder TSV. JSON: gültiges JSON.",
      },
      title: {
        type: "string",
        description: "Optionaler Anzeigetitel in der Dateikarte.",
      },
    },
    required: ["filename", "format", "content"],
  },
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
  {
    name: "audit_site_indexability",
    description:
      "Prüft mehrere URLs auf einmal auf technische Blocker: HTTP-Fehler, noindex, fremdes Canonical, Weiterleitungen — plus Abgleich mit dem Crawl-Index. Nutze dies bei Fragen wie „warum ist Seite X nicht bei Google“ oder für einen Indexierbarkeits-Überblick. Ohne Argumente: URLs aus Sitemap bzw. Crawl-Index. Achtung: kein Google-Indexierungsstatus.",
    input_schema: {
      type: "object",
      properties: {
        sitemapUrl: {
          type: "string",
          description: "Optionale Sitemap-URL als Quelle der zu prüfenden URLs.",
        },
        urls: {
          type: "array",
          items: { type: "string" },
          description: "Optionale konkrete URL-Liste (hat Vorrang vor der Sitemap).",
        },
        limit: {
          type: "number",
          description: "Wie viele URLs geprüft werden (Standard 15, max. 30).",
        },
      },
    },
  },
  {
    name: "read_index_status",
    description:
      "Liest gespeicherte Google-URL-Inspection-Stichproben (GSC) für diese Organisation. Kein Coverage-Bericht — nur zuvor geprüfte URLs. Bei leerem Ergebnis ehrlich „keine Daten“ sagen und ggf. request_gsc_index_check vorschlagen.",
    input_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Optional: genau diese URL lesen.",
        },
        limit: {
          type: "number",
          description: "Max. Einträge (Standard 20, max. 50).",
        },
      },
    },
  },
  {
    name: "request_gsc_index_check",
    description:
      "Startet eine asynchrone Google-URL-Inspection-Stichprobe über n8n/GSC. Danach später read_index_status erneut aufrufen. Ohne urls: Stichprobe aus Sitemap/Crawl.",
    input_schema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          description: "Optionale konkrete URL-Liste.",
        },
        limit: {
          type: "number",
          description: "Max. URLs in der Stichprobe (Standard 10, max. 20).",
        },
      },
    },
  },
  {
    name: "update_seo_task",
    description:
      "Bearbeitet eine bestehende SEO-Aufgabe im Board (Titel, Status, Keyword, URL, Maßnahme, Priorität, …). Nutze die taskId aus „Bestehende SEO-Aufgaben“. Das Board erlaubt Edit — nicht nur Hinzufügen.",
    input_schema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "UUID der bestehenden Aufgabe." },
        title: { type: "string", description: "Neuer Titel." },
        url: { type: "string", description: "Ziel-URL (leer = entfernen)." },
        keyword: { type: "string", description: "Keyword (leer = entfernen)." },
        action: { type: "string", description: "Maßnahme / nächste Schritte." },
        status: {
          type: "string",
          enum: ["open", "in_progress", "done", "wont_fix"],
          description: "Neuer Status.",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high", "urgent"],
          description: "Priorität.",
        },
        currentStatus: {
          type: "string",
          description: "Ist-Status (Ranking, Impressionen, …).",
        },
        notes: { type: "string", description: "Interne Notizen." },
      },
      required: ["taskId"],
    },
  },
  {
    name: "delete_seo_task",
    description:
      "Löscht eine bestehende SEO-Aufgabe aus dem Board. Nutze die taskId aus „Bestehende SEO-Aufgaben“. Bei uneindeutiger Nutzeranfrage vorher nachfragen.",
    input_schema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "UUID der zu löschenden Aufgabe." },
      },
      required: ["taskId"],
    },
  },
  {
    name: "update_grounding_page",
    description:
      "Rückgabe an das Tool (Grounding-Tab): meldet je Grounding Page (Hub oder Entitätsseite) URL, Art, Status (Entwurf/freigegeben), dateModified, lastReviewed, Prüfer und Standardversion. Upsert per URL. lastReviewed und Prüfer nur nach dokumentierter Freigabe durch den Nutzer setzen — nie bei Entwürfen, nie ein Zukunftsdatum. Nach „prüfe“, „aktualisiere“ oder einem Neubau für jede Seite einmal aufrufen.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Live-URL der Grounding Page (bestehende URLs haben Vorrang vor /grounding/)." },
        kind: { type: "string", enum: ["hub", "entity"], description: "hub = Haupt-Grounding-Page, entity = Entitätsseite." },
        entityName: { type: "string", description: "Entitätsname (nur Entitätsseiten)." },
        slug: { type: "string", description: "Slug der Entitätsseite, ohne Orts-/Keyword-Zusätze." },
        status: { type: "string", enum: ["draft", "approved"], description: "draft = Entwurf (v1.6), approved = menschlich geprüft und freigegeben (v1.7)." },
        dateModified: { type: "string", description: "dateModified der Seite (YYYY-MM-DD)." },
        lastReviewed: { type: "string", description: "Tatsächliches Prüfdatum (YYYY-MM-DD), nur nach Freigabe." },
        reviewedBy: { type: "string", description: "Prüfer (Person oder Organisation), nur nach Freigabe." },
        standardVersion: { type: "string", description: "Standardversion, die die Seite ausweist (z. B. 1.6 oder 1.7)." },
        uploadedAt: { type: "string", description: "Upload-/Veröffentlichungsdatum (YYYY-MM-DD), falls bekannt." },
        note: { type: "string", description: "Kurze Notiz (z. B. Befund: llms.txt neuer als Grounding Page)." },
      },
      required: ["url"],
    },
  },
  {
    name: "start_grounding_draft",
    description:
      "Startet den Grounding-Agenten für eine Seite (Hub oder Entitätsseite): legt die Seite im Tab Grounding an, falls neu, und erstellt den Entwurf im Hintergrund in vier Schritten (Fakten sammeln, Faktencheck, Seite bauen, Endprüfung). Nur nach ausdrücklicher Bestätigung des Nutzers aufrufen. Setzt einen pausierten Entwurf fort; startet einen fertigen Entwurf nicht neu.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["hub", "entity"], description: "hub = Haupt-Grounding-Page der Organisation, entity = Entitätsseite." },
        url: { type: "string", description: "Geplante Live-URL, z. B. https://…/grounding/ (Hub) oder https://…/grounding/<slug>/ (Entität). Nie die Startseite." },
        entityName: { type: "string", description: "Name der Entität (nur Entitätsseiten)." },
        slug: { type: "string", description: "Slug der Entitätsseite." },
      },
      required: ["kind", "url"],
    },
  },
  {
    name: "answer_grounding_draft",
    description:
      "Gibt die Antworten des Nutzers auf die Fragen des Faktenchecks an den Grounding-Agenten weiter; der Entwurf läuft dann mit „Seite bauen“ weiter. Nur aufrufen, wenn der Entwurf im Tool-Kontext auf „Braucht Ihre Antworten“ steht und der Nutzer die Fragen beantwortet hat.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL der Grounding Page, deren Fragen beantwortet werden." },
        answers: { type: "string", description: "Die Antworten des Nutzers in der Reihenfolge der Fragen, wörtlich." },
      },
      required: ["url", "answers"],
    },
  },
  {
    name: "check_serp_snippet",
    description:
      "Misst Title und/oder Meta-Description in Pixeln (Google-SERP-Schätzung mit Arial). Limits: Title Desktop ~600px, Mobile ~440px, Description ~920px. Zeichenzahl nur Zusatz. Nutze dies bei Title-/Meta-Vorschlägen.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Vorgeschlagener Title-Tag." },
        description: {
          type: "string",
          description: "Vorgeschlagene Meta-Description.",
        },
      },
    },
  },
];

async function runDtRetrievalTool(
  organisationId: string,
  name: string,
  input: unknown,
): Promise<string | null> {
  // `return await`: a rejected tool promise must land in this catch and become a tool
  // result, not abort the whole chat turn (a missing table killed every SEO answer).
  try {
    return await runDtRetrievalToolInner(organisationId, name, input);
  } catch (err) {
    return `Fehler beim Abrufen: ${err instanceof Error ? err.message : "unbekannt"}`;
  }
}

async function runDtRetrievalToolInner(
  organisationId: string,
  name: string,
  input: unknown,
): Promise<string | null> {
  const args = (input ?? {}) as Record<string, unknown>;
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
  if (name === "audit_site_indexability") {
    return auditSiteIndexabilityForTool(organisationId, {
      sitemapUrl: typeof args.sitemapUrl === "string" ? args.sitemapUrl : null,
      urls: Array.isArray(args.urls) ? args.urls.map((u) => String(u)) : null,
      limit: typeof args.limit === "number" ? args.limit : null,
    });
  }
  if (name === "read_index_status") {
    return readIndexStatusForTool(organisationId, {
      url: typeof args.url === "string" ? args.url : null,
      limit: typeof args.limit === "number" ? args.limit : undefined,
    });
  }
  if (name === "request_gsc_index_check") {
    return triggerGscIndexCheckN8n({
      organisationId,
      urls: Array.isArray(args.urls) ? args.urls.map((u) => String(u)) : undefined,
      limit: typeof args.limit === "number" ? args.limit : undefined,
    });
  }
  if (name === "update_seo_task") {
    const taskId = String(args.taskId ?? "").trim();
    const nullable = (v: unknown) =>
      v === undefined ? undefined : v === null ? null : String(v);
    return updateSeoTaskForTool(organisationId, taskId, {
      title: args.title !== undefined ? String(args.title) : undefined,
      url: nullable(args.url),
      keyword: nullable(args.keyword),
      action: nullable(args.action),
      status:
        args.status !== undefined
          ? (String(args.status) as "open" | "in_progress" | "done" | "wont_fix")
          : undefined,
      priority:
        args.priority === undefined
          ? undefined
          : args.priority === null
            ? null
            : String(args.priority),
      currentStatus: nullable(args.currentStatus),
      notes: nullable(args.notes),
    });
  }
  if (name === "delete_seo_task") {
    const taskId = String(args.taskId ?? "").trim();
    return deleteSeoTaskForTool(organisationId, taskId);
  }
  if (name === "update_grounding_page") {
    const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v));
    return updateGroundingPageForTool(organisationId, {
      url: String(args.url ?? ""),
      kind: args.kind === "hub" || args.kind === "entity" ? args.kind : undefined,
      entityName: str(args.entityName),
      slug: str(args.slug),
      status:
        args.status === "approved" || args.status === "draft" ? args.status : undefined,
      dateModified: str(args.dateModified),
      lastReviewed: str(args.lastReviewed),
      reviewedBy: str(args.reviewedBy),
      standardVersion: str(args.standardVersion),
      uploadedAt: str(args.uploadedAt),
      note: str(args.note),
    });
  }
  if (name === "start_grounding_draft") {
    return startGroundingDraftForTool(organisationId, {
      kind: args.kind === "entity" ? "entity" : "hub",
      url: String(args.url ?? ""),
      entityName: typeof args.entityName === "string" ? args.entityName : null,
      slug: typeof args.slug === "string" ? args.slug : null,
    });
  }
  if (name === "answer_grounding_draft") {
    return answerGroundingDraftForTool(organisationId, {
      url: String(args.url ?? ""),
      answers: String(args.answers ?? ""),
    });
  }
  if (name === "check_serp_snippet") {
    return formatSerpSnippetCheckForTool({
      title: typeof args.title === "string" ? args.title : null,
      description: typeof args.description === "string" ? args.description : null,
    });
  }
  return null;
}

function textOfContentBlock(block: Anthropic.ContentBlockParam): string | null {
  if (block.type === "text" && "text" in block && typeof block.text === "string") {
    return block.text;
  }
  return null;
}

function isEmptyMessageContent(content: Anthropic.MessageParam["content"]): boolean {
  if (typeof content === "string") return !content.trim();
  if (!Array.isArray(content) || content.length === 0) return true;
  return content.every((block) => {
    const text = textOfContentBlock(block);
    if (text !== null) return !text.trim();
    return false;
  });
}

function sanitizeMessageContent(
  content: Anthropic.MessageParam["content"],
): Anthropic.MessageParam["content"] {
  if (typeof content === "string") return sanitizeForLlmText(content);
  if (!Array.isArray(content)) return content;
  return content.map((block) => {
    const text = textOfContentBlock(block);
    if (text !== null) return { ...block, text: sanitizeForLlmText(text) };
    return block;
  });
}

function mergeMessageContent(
  left: Anthropic.MessageParam["content"],
  right: Anthropic.MessageParam["content"],
): Anthropic.MessageParam["content"] {
  if (typeof left === "string" && typeof right === "string") {
    return `${left.trim()}\n\n${right.trim()}`;
  }
  const toBlocks = (value: Anthropic.MessageParam["content"]): Anthropic.ContentBlockParam[] => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed ? [{ type: "text", text: trimmed }] : [];
    }
    return Array.isArray(value) ? [...value] : [];
  };
  return [...toBlocks(left), ...toBlocks(right)];
}

/**
 * Anthropic rejects empty content, consecutive same-role turns, and histories
 * that do not start and end with a user message. Failed chat turns still persist
 * the user row, so a retry would otherwise 400.
 */
export function normalizeDtAnthropicMessages(
  messages: Anthropic.MessageParam[],
): Anthropic.MessageParam[] {
  const merged: Anthropic.MessageParam[] = [];

  for (const raw of messages) {
    if (raw.role !== "user" && raw.role !== "assistant") continue;
    const content = sanitizeMessageContent(raw.content);
    if (isEmptyMessageContent(content)) continue;
    const next: Anthropic.MessageParam = { role: raw.role, content };
    const last = merged[merged.length - 1];
    if (last && last.role === next.role) {
      last.content = mergeMessageContent(last.content, next.content);
    } else {
      merged.push(next);
    }
  }

  while (merged.length > 0 && merged[0]!.role !== "user") merged.shift();
  while (merged.length > 0 && merged[merged.length - 1]!.role !== "user") merged.pop();
  return merged;
}

/** PDF beta only when this turn actually sends a PDF. Other betas are not used here. */
export function dtAnthropicBetaHeaders(
  messages: Anthropic.MessageParam[],
): Record<string, string> | undefined {
  const needsPdf = messages.some((message) => {
    if (!Array.isArray(message.content)) return false;
    return message.content.some((block) => {
      if (block.type !== "document" || !("source" in block)) return false;
      const source = block.source;
      return (
        !!source &&
        typeof source === "object" &&
        "media_type" in source &&
        source.media_type === "application/pdf"
      );
    });
  });
  if (!needsPdf) return undefined;
  return { "anthropic-beta": "pdfs-2024-09-25" };
}

/** Primary model, then a live fallback if that id was retired (404). */
export function dtAnthropicModelsForMode(mode: DtChatMode): string[] {
  const primary = resolveDtAnthropicModel(mode);
  const fallbacks =
    mode === "seo"
      ? ["claude-sonnet-4-6", "claude-sonnet-5"]
      : ["claude-haiku-4-5-20251001", "claude-haiku-4-5"];
  return [...new Set([primary, ...fallbacks].map((model) => model.trim()).filter(Boolean))];
}

/**
 * Short technical reason for the generic failure text, so an admin can read the cause
 * in the chat instead of the server log: "400 invalid_request_error: …".
 * The Anthropic SDK nests the API error one level deeper (`err.error.error`).
 */
export function dtChatFailureDetail(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const extra = err as {
    status?: unknown;
    error?: { message?: unknown; type?: unknown; error?: { message?: unknown; type?: unknown } };
    message?: unknown;
  };
  const api = extra.error?.error ?? extra.error;
  const type = typeof api?.type === "string" ? api.type : "";
  const apiMessage = typeof api?.message === "string" ? api.message : "";
  const own = typeof extra.message === "string" ? extra.message : "";
  const text = (apiMessage || own).replace(/\s+/g, " ").trim();
  if (!text && !type) return null;
  const parts = [
    typeof extra.status === "number" ? String(extra.status) : "",
    type,
  ].filter(Boolean);
  const head = parts.join(" ");
  const body = text.length > 220 ? `${text.slice(0, 217)}…` : text;
  return [head, body].filter(Boolean).join(": ");
}

export function dtChatFailureUserMessage(err: unknown): string {
  const chunks: string[] = [];
  if (err instanceof Error && err.message) chunks.push(err.message);
  if (err && typeof err === "object") {
    const extra = err as {
      status?: unknown;
      error?: { message?: unknown; type?: unknown; error?: { message?: unknown; type?: unknown } };
    };
    const api = extra.error?.error ?? extra.error;
    if (typeof api?.message === "string") chunks.push(api.message);
    if (typeof api?.type === "string") chunks.push(api.type);
    if (typeof extra.status === "number") chunks.push(String(extra.status));
  }
  const blob = chunks.join(" ");

  if (err instanceof Error) {
    const own = err.message.trim();
    if (
      own.startsWith("ANTHROPIC_API_KEY") ||
      own.startsWith("Keine gültige") ||
      own.startsWith("Kein verfügbares") ||
      own.startsWith("Die KI-Antwort war leer")
    ) {
      return own;
    }
  }

  if (/timeout|timed out|Zeitlimit|aborted/i.test(blob)) {
    return "Die KI hat zu lange gebraucht. Bitte erneut versuchen.";
  }
  if (
    /too many tokens|prompt is too long|context.?length|max.*context|input is too long|request too large|payload too large/i.test(
      blob,
    )
  ) {
    return "Der Chat ist zu lang für eine KI-Antwort. Bitte einen neuen Chat starten.";
  }
  if (/credit balance|insufficient credits|billing|purchase credits/i.test(blob)) {
    return "Das Anthropic-Guthaben ist aufgebraucht. Unter Plans & Billing Credits kaufen — danach antworten Chat und Agent-Generierung wieder.";
  }
  if (/invalid x-api-key|authentication_error|permission_error/i.test(blob)) {
    return "Die KI-Anmeldung wurde abgelehnt. Bitte den API-Schlüssel prüfen.";
  }
  if (/rate.?limit|overloaded|529/i.test(blob)) {
    return "Die KI ist gerade überlastet. Bitte in einem Moment erneut versuchen.";
  }
  const detail = dtChatFailureDetail(err);
  return detail
    ? `KI-Antwort fehlgeschlagen (${detail}). Bitte erneut versuchen.`
    : "KI-Antwort fehlgeschlagen. Bitte erneut versuchen.";
}

const DT_TRUNCATED_ANSWER_NOTE =
  "(Die Antwort wurde am Längenlimit abgeschnitten. Bitte um Fortsetzung bitten oder in kleineren Schritten fragen, z. B. eine Aufgabe nach der anderen.)";

const DT_CONTINUE_TRUNCATED_TEXT_PROMPT =
  "Deine Antwort wurde am Ausgabelimit abgeschnitten. Setze exakt an der Stelle fort, an der du aufgehört hast — ohne Wiederholung und ohne Einleitung.";

function truncatedToolCallResult(toolName: string, maxTokens: number): string {
  return (
    `Der Aufruf von ${toolName} wurde abgebrochen: Die Antwort hat das Ausgabelimit von ${maxTokens} Tokens überschritten, bevor der Aufruf vollständig war. Es wurde nichts erstellt oder geändert. ` +
    `Antworte stattdessen direkt im Chat in kompakter Form — oder teile den Inhalt auf mehrere kleinere Dateien (max. ${DT_MAX_CREATED_FILE_CHARS} Zeichen je Datei) bzw. auf mehrere Antworten auf (z. B. Aufgabe für Aufgabe) und biete dem Nutzer die Fortsetzung an.`
  );
}

/** Anthropic rejects empty text blocks in history; a stream cut off at a block start leaves one. */
function assistantContentForHistory(resp: Anthropic.Message): Anthropic.ContentBlock[] {
  return resp.content.filter((block) => block.type !== "text" || block.text.trim().length > 0);
}

/** Collects what the model wrote across tool rounds and continuation rounds of one turn. */
class DtAnswerAccumulator {
  private text = "";

  /** Text written before a tool call or before the limit cut it off. */
  append(part: string): void {
    const trimmed = part.trim();
    if (!trimmed) return;
    this.text = this.text ? `${this.text}\n\n${trimmed}` : trimmed;
  }

  /** The model picked up mid-sentence, so no separator. */
  appendContinuation(part: string): void {
    if (!part.trim()) return;
    if (!this.text) {
      this.text = part.trim();
      return;
    }
    this.text = `${this.text.replace(/\s+$/, "")}${part.replace(/^\s+/, " ")}`;
  }

  add(part: string, continuation: boolean): void {
    if (continuation) this.appendContinuation(part);
    else this.append(part);
  }

  finish(resp: Anthropic.Message, continuation: boolean): string {
    this.add(extractAnthropicText(resp), continuation);
    if (resp.stop_reason === "max_tokens") this.append(DT_TRUNCATED_ANSWER_NOTE);
    return this.text || "Keine Antwort erhalten.";
  }
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

  const messages = normalizeDtAnthropicMessages(params.messages);
  if (messages.length === 0) {
    throw new Error("Keine gültige Nutzer-Nachricht für die KI.");
  }

  const models = dtAnthropicModelsForMode(params.mode);
  const betaHeaders = dtAnthropicBetaHeaders(messages);
  const client = new Anthropic({
    apiKey,
    ...(betaHeaders ? { defaultHeaders: betaHeaders } : {}),
  });
  const max_tokens = 8192;
  const system = sanitizeForLlmText(params.system);
  const roundTimeoutMs = params.mode === "seo" ? 180_000 : 120_000;

  const retrievalOrgId = params.mode === "seo" ? params.retrieval?.organisationId : undefined;
  // SEO mode also gets Anthropic's server-side web search + web fetch (max uses per answer).
  const tools: Anthropic.ToolUnion[] = retrievalOrgId
    ? [...DT_SEO_RETRIEVAL_TOOLS, DT_CREATE_FILE_TOOL, ...DT_WEB_RESEARCH_TOOLS]
    : [DT_CREATE_FILE_TOOL];
  const createdFiles: DtCreatedChatFile[] = [];

  const createRound = async (input: {
    convo: Anthropic.MessageParam[];
    tools?: Anthropic.ToolUnion[];
  }): Promise<{ response: Anthropic.Message; model: string }> => {
    const result = await callAnthropicFirstAvailable({
      anthropic: client,
      models,
      maxTokens: max_tokens,
      system,
      messages: input.convo,
      tools: input.tools,
      timeoutMs: roundTimeoutMs,
      headers: betaHeaders,
    });
    if (!result) {
      throw new Error("Kein verfügbares Anthropic-Modell.");
    }
    return result;
  };

  const runTool = async (name: string, input: unknown): Promise<string> => {
    if (name === "create_file") {
      const args = (input ?? {}) as Record<string, unknown>;
      if (createdFiles.length >= DT_MAX_CREATED_FILES) {
        return `Höchstens ${DT_MAX_CREATED_FILES} Dateien pro Antwort.`;
      }
      const built = await buildCreatedChatFile({
        fileName: String(args.filename ?? args.fileName ?? "datei.txt"),
        format: args.format,
        content: String(args.content ?? ""),
        title: typeof args.title === "string" ? args.title : null,
      });
      if (!built.ok) return built.message;
      createdFiles.push(built.file);
      return createdFileToolResultMessage(built.file);
    }
    if (retrievalOrgId) {
      const seo = await runDtRetrievalTool(retrievalOrgId, name, input);
      if (seo != null) return seo;
    }
    return `Unbekanntes Werkzeug: ${name}`;
  };

  const convo: Anthropic.MessageParam[] = [...messages];
  const answer = new DtAnswerAccumulator();
  let usedModel = models[0] ?? resolveDtAnthropicModel(params.mode);
  let totalUsage: DtAnthropicUsage = { inputTokens: 0, outputTokens: 0 };
  let webUsage: DtWebResearchUsage = { webSearchRequests: 0, webFetchRequests: 0 };
  /** Every content block seen across rounds: web-search limit errors + citations live here. */
  const seenBlocks: unknown[] = [];
  let recoveries = 0;
  // True while the current round continues text that the limit cut off.
  let continuing = false;

  const finish = (resp: Anthropic.Message): DtAnthropicChatResult => ({
    text: appendWebResearchNotes(
      answer.finish(resp, continuing),
      inspectWebResearchBlocks(seenBlocks),
    ),
    model: usedModel,
    stopReason: resp.stop_reason ?? null,
    usage: { ...totalUsage, ...webUsage },
    createdFiles,
  });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const roundResult = await createRound({
      convo,
      tools,
    });
    const resp = roundResult.response;
    usedModel = roundResult.model;
    totalUsage = mergeUsage(totalUsage, sumAnthropicUsage(resp.usage));
    webUsage = mergeWebResearchUsage(webUsage, sumServerToolUsage(resp.usage));
    seenBlocks.push(...resp.content);

    // Server tools (web search / fetch) may pause a long turn: keep the text so far,
    // hand the content back unchanged and let the model continue.
    if (resp.stop_reason === "pause_turn") {
      answer.add(extractAnthropicText(resp), continuing);
      continuing = false;
      convo.push({ role: "assistant", content: assistantContentForHistory(resp) });
      continue;
    }

    const toolUses = resp.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    if (resp.stop_reason === "max_tokens" && recoveries < MAX_TRUNCATION_RECOVERIES) {
      recoveries += 1;
      const roundText = extractAnthropicText(resp);
      answer.add(roundText, continuing);
      continuing = false;

      if (toolUses.length > 0) {
        // The limit cut a tool call off mid-JSON (typically one huge create_file).
        // Running the fragment would produce a broken file; let the model answer
        // compactly or split the work instead of returning an empty turn.
        convo.push({ role: "assistant", content: assistantContentForHistory(resp) });
        convo.push({
          role: "user",
          content: toolUses.map((tu) => ({
            type: "tool_result" as const,
            tool_use_id: tu.id,
            is_error: true,
            content: truncatedToolCallResult(tu.name, max_tokens),
          })),
        });
        continue;
      }

      if (roundText) {
        convo.push({ role: "assistant", content: assistantContentForHistory(resp) });
        convo.push({ role: "user", content: DT_CONTINUE_TRUNCATED_TEXT_PROMPT });
        continuing = true;
        continue;
      }
    }

    if (resp.stop_reason !== "tool_use") {
      return finish(resp);
    }

    // Keep what the model said before calling tools; it is part of the answer.
    answer.add(extractAnthropicText(resp), continuing);
    continuing = false;

    convo.push({ role: "assistant", content: assistantContentForHistory(resp) });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const output = await runTool(tu.name, tu.input);
      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: output });
    }
    convo.push({ role: "user", content: toolResults });
  }

  const finalRound = await createRound({ convo });
  usedModel = finalRound.model;
  const finalResp = finalRound.response;
  totalUsage = mergeUsage(totalUsage, sumAnthropicUsage(finalResp.usage));
  webUsage = mergeWebResearchUsage(webUsage, sumServerToolUsage(finalResp.usage));
  seenBlocks.push(...finalResp.content);

  return finish(finalResp);
}

/** Sync truncation fallback (migration / callers without Anthropic). Prefer `resolveDtAutoTitleAfterTurn`. */
export function suggestChatTitle(userMessage: string, assistantMessage: string): string {
  return fallbackDtChatTitle(userMessage, assistantMessage);
}
