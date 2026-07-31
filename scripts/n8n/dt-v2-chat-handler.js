// n8n Code node — DT v2 chat handler (no fetch; uses this.helpers.httpRequest)
const CONFIG = {
  supabaseUrl: "__DT_SUPABASE_URL__",
  supabaseAnon: "__DT_SUPABASE_ANON__",
  appBase: "__DT_APP_BASE_URL__",
  dtSecret: "__DT_INTERNAL_WEBHOOK_SECRET__",
  anthropicKey: "__DT_ANTHROPIC_API_KEY__",
};

const helpers = this.helpers;
const items = $input.all();
const webhookItem = items[0]?.json ?? {};
const headers = webhookItem.headers ?? {};
const body = webhookItem.body ?? webhookItem;

async function httpJson(options) {
  const response = await helpers.httpRequest({
    json: true,
    ignoreHttpStatusErrors: true,
    returnFullResponse: true,
    ...options,
  });
  const statusCode = response.statusCode ?? 200;
  let data = response.body;
  if (typeof data === "string") {
    try {
      data = data ? JSON.parse(data) : null;
    } catch {
      // keep string
    }
  }
  return {
    ok: statusCode >= 200 && statusCode < 300,
    statusCode,
    data,
  };
}

const authHeader =
  headers.authorization ??
  headers.Authorization ??
  body.authorization ??
  "";
const token = String(authHeader).replace(/^Bearer\s+/i, "").trim();
if (!token) {
  return [{ json: { ok: false, message: "Unauthorized.", statusCode: 401 } }];
}

const supabaseUrl = (CONFIG.supabaseUrl || "").replace(/\/+$/, "");
const supabaseAnon = CONFIG.supabaseAnon || "";
const appBase = (CONFIG.appBase || "").replace(/\/+$/, "");
const dtSecret = CONFIG.dtSecret || "";
const anthropicKey = CONFIG.anthropicKey || "";

if (!supabaseUrl || !supabaseAnon || !appBase || !dtSecret || !anthropicKey) {
  return [
    {
      json: {
        ok: false,
        message: "Workflow config incomplete — re-run: node scripts/deploy-dt-chat-n8n-workflow.mjs",
        statusCode: 500,
      },
    },
  ];
}

async function supabaseFetch(path, init = {}) {
  const method = init.method || "GET";
  const url = `${supabaseUrl}${path}`;
  const reqHeaders = {
    apikey: supabaseAnon,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Prefer:
      method === "POST" || method === "PATCH" ? "return=representation" : "return=minimal",
    ...(init.headers || {}),
  };
  let reqBody;
  if (init.body) {
    reqBody = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
  }
  return httpJson({
    method,
    url,
    headers: reqHeaders,
    body: reqBody,
  });
}

const userRes = await httpJson({
  method: "GET",
  url: `${supabaseUrl}/auth/v1/user`,
  headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnon },
});
const userJson = userRes.data;
if (!userRes.ok || !userJson?.id) {
  return [{ json: { ok: false, message: "Invalid JWT.", statusCode: 401 } }];
}
const userId = userJson.id;

const chatId = body.chatId;
const organisationId = body.organisationId;
const agentId = body.agentId;
const mode = body.mode || "default";
const message = (body.message || body.userMessage || "").trim();
const ghostMode = Boolean(body.ghostMode);
const userMessageId = body.userMessageId || null;
const dryRun =
  String(webhookItem.query?.dryRun ?? body.dryRun ?? "").toLowerCase() === "true" ||
  webhookItem.query?.dryRun === "1";

if (!chatId || !organisationId || !agentId || !message) {
  return [
    {
      json: {
        ok: false,
        message: "Missing chatId, organisationId, agentId, or message.",
        statusCode: 400,
      },
    },
  ];
}

const chatLookup = await supabaseFetch(
  `/rest/v1/dt_chats?id=eq.${chatId}&select=id,organisation_id,agent_id,mode,title&limit=1`,
);
if (!chatLookup.ok || !Array.isArray(chatLookup.data) || chatLookup.data.length === 0) {
  return [{ json: { ok: false, message: "Chat not found or forbidden.", statusCode: 403 } }];
}
const chat = chatLookup.data[0];

if (!ghostMode && !userMessageId) {
  const insertUser = await supabaseFetch(`/rest/v1/dt_chat_messages`, {
    method: "POST",
    body: {
      chat_id: chatId,
      role: "user",
      content: message,
      author_user_id: userId,
      metadata: {},
    },
  });
  if (!insertUser.ok) {
    return [
      {
        json: {
          ok: false,
          message: "User message insert failed.",
          statusCode: 500,
          detail: insertUser.data,
        },
      },
    ];
  }
}

const promptRes = await httpJson({
  method: "POST",
  url: `${appBase}/api/dt/internal/build-system-prompt`,
  headers: {
    "Content-Type": "application/json",
    "X-DT-Webhook-Secret": dtSecret,
  },
  body: { userId, chatId, ghostMode },
});
const promptJson = promptRes.data;
if (!promptRes.ok || !promptJson?.ok) {
  return [
    {
      json: {
        ok: false,
        message: promptJson?.message || "build-system-prompt failed.",
        statusCode: 500,
        detail: promptJson,
      },
    },
  ];
}

if (dryRun) {
  return [
    {
      json: {
        ok: true,
        dryRun: true,
        system: promptJson.system,
        messages: promptJson.messages,
        model: promptJson.model,
        statusCode: 200,
      },
    },
  ];
}

// On-demand website retrieval tools (SEO mode). The full page text is NOT in
// the prompt — the model pulls only what it needs via these tools, so we don't
// burn tokens dumping every page body into context.
const seoTools = [
  {
    name: "search_website_content",
    description:
      "Durchsucht den vollständigen Text ALLER gecrawlten Unterseiten der Organisation nach Stichworten und liefert die relevantesten Treffer mit kurzem Auszug und URL. Nutze dies, bevor du Aussagen über Inhalte der Website triffst.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Suchbegriffe / Stichworte." },
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
            "Optionale Sitemap-URL. Wenn leer: Org-Sitemap bzw. Website/sitemap.xml.",
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

async function runSeoTool(name, input) {
  const args = input || {};
  try {
    if (name === "search_website_content") {
      const q = String(args.query || "").trim();
      if (!q) return "Kein Suchbegriff angegeben.";
      const r = await httpJson({
        method: "POST",
        url: `${appBase}/api/dt/seo/site-search`,
        headers: { "Content-Type": "application/json", "X-DT-Webhook-Secret": dtSecret },
        body: { organisationId, action: "search", query: q },
      });
      if (!r.ok || !r.data?.ok) return "Suche fehlgeschlagen.";
      const hits = r.data.hits || [];
      if (!hits.length) return `Keine Treffer für „${q}“.`;
      return hits
        .map((h, i) => `${i + 1}. ${h.title || h.url}\n   URL: ${h.url}\n   Auszug: ${h.snippet}`)
        .join("\n\n");
    }
    if (name === "read_website_page") {
      const u = String(args.url || "").trim();
      if (!u) return "Keine URL angegeben.";
      const r = await httpJson({
        method: "POST",
        url: `${appBase}/api/dt/seo/site-search`,
        headers: { "Content-Type": "application/json", "X-DT-Webhook-Secret": dtSecret },
        body: { organisationId, action: "read", url: u },
      });
      if (!r.ok || !r.data?.ok) return "Abruf fehlgeschlagen.";
      if (!r.data.found || !r.data.page) return `Keine gecrawlte Seite für ${u} gefunden.`;
      const p = r.data.page;
      return `Inhalt von ${p.url}${p.title ? ` (${p.title})` : ""}:\n\n${p.content || "(kein Text)"}`;
    }
    if (name === "read_full_seo_report") {
      const r = await httpJson({
        method: "POST",
        url: `${appBase}/api/dt/seo/report-detail`,
        headers: { "Content-Type": "application/json", "X-DT-Webhook-Secret": dtSecret },
        body: { organisationId },
      });
      if (!r.ok || !r.data?.ok) return "SEO-Report-Abruf fehlgeschlagen.";
      return r.data.report || "Kein Report-Inhalt.";
    }
    if (name === "read_sitemap") {
      const sitemapUrl = String(args.sitemapUrl || "").trim();
      const r = await httpJson({
        method: "POST",
        url: `${appBase}/api/dt/seo/site-search`,
        headers: { "Content-Type": "application/json", "X-DT-Webhook-Secret": dtSecret },
        body: {
          organisationId,
          action: "sitemap",
          ...(sitemapUrl ? { sitemapUrl } : {}),
        },
      });
      if (!r.ok || !r.data?.ok) return "Sitemap-Abruf fehlgeschlagen.";
      return r.data.text || "Keine Sitemap-Daten.";
    }
    if (name === "inspect_website_url") {
      const u = String(args.url || "").trim();
      if (!u) return "Keine URL angegeben.";
      const r = await httpJson({
        method: "POST",
        url: `${appBase}/api/dt/seo/site-search`,
        headers: { "Content-Type": "application/json", "X-DT-Webhook-Secret": dtSecret },
        body: { organisationId, action: "inspect", url: u },
      });
      if (!r.ok || !r.data?.ok) return "Live-URL-Check fehlgeschlagen.";
      return r.data.text || "Keine Prüfergebnisse.";
    }
    return `Unbekanntes Werkzeug: ${name}`;
  } catch (err) {
    return `Fehler beim Abrufen: ${err?.message || "unbekannt"}`;
  }
}

const maxTokens = mode === "seo" ? 8192 : 4096;
const useTools = mode === "seo";
const convo = Array.isArray(promptJson.messages) ? promptJson.messages.slice() : [];
let anthropicJson = null;
let totalInputTokens = 0;
let totalOutputTokens = 0;

function addUsage(u) {
  if (!u) return;
  totalInputTokens += u.input_tokens || 0;
  totalOutputTokens += u.output_tokens || 0;
}

for (let round = 0; round < 4; round++) {
  const callBody = {
    model: promptJson.model,
    max_tokens: maxTokens,
    system: promptJson.system,
    messages: convo,
  };
  if (useTools) callBody.tools = seoTools;

  const res = await httpJson({
    method: "POST",
    url: "https://api.anthropic.com/v1/messages",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: callBody,
  });
  if (!res.ok) {
    return [
      {
        json: {
          ok: false,
          message: "Anthropic call failed.",
          statusCode: 500,
          detail: res.data,
        },
      },
    ];
  }
  anthropicJson = res.data;
  addUsage(anthropicJson.usage);

  if (!useTools || anthropicJson.stop_reason !== "tool_use") break;

  const toolUses = (anthropicJson.content || []).filter((b) => b.type === "tool_use");
  convo.push({ role: "assistant", content: anthropicJson.content });
  const toolResults = [];
  for (const tu of toolUses) {
    const out = await runSeoTool(tu.name, tu.input);
    toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: out });
  }
  convo.push({ role: "user", content: toolResults });
}

// Tool budget exhausted but model still wants a tool — force a final answer.
if (useTools && anthropicJson && anthropicJson.stop_reason === "tool_use") {
  const finalRes = await httpJson({
    method: "POST",
    url: "https://api.anthropic.com/v1/messages",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: {
      model: promptJson.model,
      max_tokens: maxTokens,
      system: promptJson.system,
      messages: convo,
    },
  });
  if (finalRes.ok) {
    anthropicJson = finalRes.data;
    addUsage(anthropicJson.usage);
  }
}

const assistantText = (anthropicJson.content || [])
  .filter((b) => b.type === "text")
  .map((b) => b.text)
  .join("")
  .trim();

if (!assistantText) {
  return [{ json: { ok: false, message: "Empty assistant response.", statusCode: 500 } }];
}

let messageId = null;
if (!ghostMode) {
  const insertAssistant = await supabaseFetch(`/rest/v1/dt_chat_messages`, {
    method: "POST",
    body: {
      chat_id: chatId,
      role: "assistant",
      content: assistantText,
      metadata: {
        via: "n8n",
        model: promptJson.model,
        stop_reason: anthropicJson.stop_reason ?? null,
      },
      model: promptJson.model,
      token_count_in: totalInputTokens || null,
      token_count_out: totalOutputTokens || null,
    },
  });
  if (!insertAssistant.ok || !Array.isArray(insertAssistant.data) || !insertAssistant.data[0]?.id) {
    return [
      {
        json: {
          ok: false,
          message: "Assistant message insert failed.",
          statusCode: 500,
          detail: insertAssistant.data,
        },
      },
    ];
  }
  messageId = insertAssistant.data[0].id;
}

let title = null;
if (!ghostMode && (chat.title === "Neuer Chat" || !String(chat.title || "").trim())) {
  title = message.replace(/\s+/g, " ").slice(0, 60) || assistantText.slice(0, 60);
  await supabaseFetch(`/rest/v1/dt_chats?id=eq.${chatId}`, {
    method: "PATCH",
    body: { title },
  });
}

return [
  {
    json: {
      ok: true,
      messageId,
      content: assistantText,
      assistantMessage: assistantText,
      finishReason: anthropicJson.stop_reason ?? null,
      title,
      model: promptJson.model,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
      },
      statusCode: 200,
    },
  },
];
