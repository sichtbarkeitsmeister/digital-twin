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

const anthropicRes = await httpJson({
  method: "POST",
  url: "https://api.anthropic.com/v1/messages",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": anthropicKey,
    "anthropic-version": "2023-06-01",
  },
  body: {
    model: promptJson.model,
    max_tokens: mode === "seo" ? 8192 : 4096,
    system: promptJson.system,
    messages: promptJson.messages,
  },
});
const anthropicJson = anthropicRes.data;
if (!anthropicRes.ok) {
  return [
    {
      json: {
        ok: false,
        message: "Anthropic call failed.",
        statusCode: 500,
        detail: anthropicJson,
      },
    },
  ];
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
      statusCode: 200,
    },
  },
];
