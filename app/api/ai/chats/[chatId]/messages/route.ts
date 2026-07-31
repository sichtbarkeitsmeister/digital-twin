import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  buildCachedSurveyChatSystem,
  type SurveyChatSystemPromptInput,
} from "@/lib/ai/chat-context";
import {
  anthropicSurveyBetaHeaders,
  callAnthropicFirstAvailable,
  extractAnthropicText,
  isAnthropicModelNotFoundError,
  isMultiPhaseSurveyCreationEnabled,
  isPromptCachingEnabled,
  stripCodeFences,
  tryParseJsonObject,
  type SurveyChatSystem,
} from "@/lib/ai/anthropic-helpers";
import {
  AI_CHAT_ATTACHMENTS_BUCKET,
  attachmentStorageObjectPath,
  decodeBase64Strict,
  isMultimodalMediaType,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BASE64_CHARS,
  MAX_MULTIMODAL_TOTAL_BYTES,
  normalizeMimeType,
  sanitizeStorageFileSegment,
} from "@/lib/ai/chat-attachments";
import { SURVEY_AI_MAX_MESSAGE_CHARS } from "@/lib/ai/survey-ai-attachments-shared";
import { requireAuthUser, getChatOrNull } from "@/lib/ai/chat-db";
import {
  hydrateHistoryForAnthropic,
  stripLegacyAttachmentSuffix,
  type DbAttachmentRow,
  type DbChatMessageRow,
} from "@/lib/ai/chat-history-anthropic";
import { createSseStream, sseHeaders } from "@/lib/ai/chat-stream";
import { buildPastedUrlContextText } from "@/lib/shared/pasted-url-context";
import {
  isLargeSurveyCreationIntent,
  resolveSurveyActionModels,
  resolveSurveyUtilityModels,
  selectSurveyModelsForMessage,
} from "@/lib/ai/survey-model-config";
import { runMultiPhaseSurveyCreation } from "@/lib/ai/survey-multiphase-create";
import { surveyAiProposalSchema } from "@/lib/ai/survey-assistant-types";
import { ensureSurveyAiUserPreferences } from "@/lib/settings/survey-ai-server";

export const maxDuration = 300;

const MAX_CANDIDATE_SURVEY_CONTEXTS = 2;
const MAX_KNOWN_SURVEYS = 50;
const SURVEY_RANK_POOL = 100;
const RAW_HISTORY_LIMIT = 10;
const HISTORY_SUMMARY_CHAR_LIMIT = 2400;

const attachmentInboundSchema = z
  .object({
    fileName: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(120),
    sizeBytes: z.number().int().nonnegative().max(10 * 1024 * 1024),
    textContent: z.string().max(20000).optional(),
    dataBase64: z.string().max(MAX_ATTACHMENT_BASE64_CHARS).optional(),
  })
  .superRefine((a, ctx) => {
    const norm = normalizeMimeType(a.mimeType);
    if (isMultimodalMediaType(norm) && !a.dataBase64?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: `Für die Datei „${a.fileName}“ (${norm}) fehlt dataBase64.`,
        path: ["dataBase64"],
      });
    }
  });

const requestSchema = z
  .object({
    content: z
      .string()
      .trim()
      .min(1)
      .max(
        SURVEY_AI_MAX_MESSAGE_CHARS,
        `Nachricht zu lang (max. ${SURVEY_AI_MAX_MESSAGE_CHARS.toLocaleString("de-DE")} Zeichen). Bitte kürzen oder als Datei anhängen.`,
      ),
    pageContext: z.object({
      page: z.enum(["survey_list", "survey_builder_new", "survey_builder_edit"]),
      surveyId: z.string().uuid().nullable().optional(),
      visibility: z.enum(["private", "public"]).optional(),
      slug: z.string().nullable().optional(),
      notificationEmails: z.array(z.string()).optional(),
    }),
    attachments: z.array(attachmentInboundSchema).optional().default([]),
  })
  .superRefine((data, ctx) => {
    const list = data.attachments ?? [];
    if (list.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      ctx.addIssue({
        code: "custom",
        message: `Höchstens ${MAX_ATTACHMENTS_PER_MESSAGE} Anhänge pro Nachricht.`,
        path: ["attachments"],
      });
      return;
    }
    let multimodalTotal = 0;
    for (let i = 0; i < list.length; i += 1) {
      const a = list[i]!;
      const norm = normalizeMimeType(a.mimeType);
      if (!isMultimodalMediaType(norm)) continue;
      if (!a.dataBase64?.trim()) continue;
      try {
        const bytes = decodeBase64Strict(a.dataBase64.trim());
        if (Math.abs(bytes.length - a.sizeBytes) > 1) {
          ctx.addIssue({
            code: "custom",
            message: `Dateigröße für „${a.fileName}“ stimmt nicht mit sizeBytes überein.`,
            path: ["attachments", i, "sizeBytes"],
          });
        } else {
          multimodalTotal += bytes.length;
        }
      } catch {
        ctx.addIssue({
          code: "custom",
          message: `Base64 für „${a.fileName}“ ist ungültig oder zu groß.`,
          path: ["attachments", i, "dataBase64"],
        });
      }
    }
    if (multimodalTotal > MAX_MULTIMODAL_TOTAL_BYTES) {
      ctx.addIssue({
        code: "custom",
        message: "Summe der Mediendateien überschreitet das Grenzlimit.",
        path: ["attachments"],
      });
    }
  });

type InboundAttachment = z.infer<typeof attachmentInboundSchema>;

type PersistAttachmentsResult =
  | { ok: true }
  | { ok: false; uploadedPaths: string[]; message: string };

async function persistAiChatAttachments(params: {
  supabase: SupabaseClient;
  userId: string;
  chatId: string;
  messageId: string;
  attachments: InboundAttachment[];
}): Promise<PersistAttachmentsResult> {
  const uploadedPaths: string[] = [];
  const rows: Array<{
    chat_id: string;
    message_id: string;
    storage_path: string;
    file_name: string;
    mime_type: string;
    size_bytes: number;
  }> = [];

  try {
    for (let i = 0; i < params.attachments.length; i += 1) {
      const a = params.attachments[i]!;
      const norm = normalizeMimeType(a.mimeType);
      const safeName = sanitizeStorageFileSegment(a.fileName);
      const unique = `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 9)}`;

      if (isMultimodalMediaType(norm)) {
        const rawB64 = a.dataBase64!.trim().replace(/\s/g, "");
        const bytes = decodeBase64Strict(rawB64);
        const path = attachmentStorageObjectPath({
          userId: params.userId,
          chatId: params.chatId,
          messageId: params.messageId,
          safeFileName: safeName,
          uniqueSuffix: unique,
        });
        const { error: upErr } = await params.supabase.storage
          .from(AI_CHAT_ATTACHMENTS_BUCKET)
          .upload(path, bytes, { contentType: norm, upsert: false });
        if (upErr) {
          return { ok: false, uploadedPaths, message: upErr.message };
        }
        uploadedPaths.push(path);
        rows.push({
          chat_id: params.chatId,
          message_id: params.messageId,
          storage_path: path,
          file_name: a.fileName,
          mime_type: a.mimeType,
          size_bytes: a.sizeBytes,
        });
      } else {
        rows.push({
          chat_id: params.chatId,
          message_id: params.messageId,
          storage_path: `meta-only/${params.messageId}/${unique}_${safeName}`,
          file_name: a.fileName,
          mime_type: a.mimeType,
          size_bytes: a.sizeBytes,
        });
      }
    }

    if (rows.length > 0) {
      const { error: insErr } = await params.supabase.from("ai_chat_attachments").insert(rows);
      if (insErr) {
        return { ok: false, uploadedPaths, message: insErr.message };
      }
    }
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Anhang-Verarbeitung fehlgeschlagen.";
    return { ok: false, uploadedPaths, message };
  }
}

async function rollbackUserMessageAndStorage(input: {
  supabase: SupabaseClient;
  messageId: string;
  storagePaths: string[];
}) {
  if (input.storagePaths.length > 0) {
    await input.supabase.storage.from(AI_CHAT_ATTACHMENTS_BUCKET).remove(input.storagePaths);
  }
  await input.supabase.from("ai_chat_messages").delete().eq("id", input.messageId);
}

function extractText(resp: Anthropic.Messages.Message) {
  return extractAnthropicText(resp);
}

function isModelNotFoundError(error: unknown) {
  return isAnthropicModelNotFoundError(error);
}

function extractProposalHintFromText(text: string) {
  const normalized = stripCodeFences(text);
  const kindMatch = normalized.match(/"kind"\s*:\s*"([^"]+)"/i);
  if (!kindMatch?.[1]) return null;

  const summaryMatch = normalized.match(/"summary"\s*:\s*"([^"]*)"/i);
  const surveyIdMatch = normalized.match(
    /"surveyId"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})"/i,
  );

  return {
    kind: kindMatch[1].trim(),
    summary: summaryMatch?.[1]?.trim() || undefined,
    surveyId: surveyIdMatch?.[1]?.trim() || undefined,
    rawPreview: normalized.slice(0, 4000),
  };
}

function hasActionJsonIntent(text: string) {
  return extractProposalHintFromText(text)?.kind != null;
}

async function ensureValidAssistantOutput(input: {
  anthropic: Anthropic;
  utilityModels: string[];
  system: SurveyChatSystem;
  baseMessages: Anthropic.MessageParam[];
  assistantText: string;
}) {
  const initialParsed = tryParseJsonObject(input.assistantText);
  if (initialParsed) {
    return { assistantText: input.assistantText, parsedJson: initialParsed };
  }
  if (!hasActionJsonIntent(input.assistantText)) {
    return { assistantText: input.assistantText, parsedJson: null };
  }

  let candidate = stripCodeFences(input.assistantText);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // Truncate repair input — full 16k+ Fragebogen JSON can blow utility context.
    const repairSource =
      candidate.length > 120_000 ? `${candidate.slice(0, 120_000)}\n…` : candidate;
    const repairCall = await callAnthropicFirstAvailable({
      anthropic: input.anthropic,
      models: input.utilityModels,
      maxTokens: 8192,
      system:
        "You repair malformed JSON. Return exactly one valid JSON object only. No markdown, no prose, no code fences.",
      messages: [
        {
          role: "user",
          content:
            `Repariere das folgende fehlerhafte JSON für eine Survey-Aktion.` +
            `\n\nWICHTIG:` +
            `\n- Gib NUR ein valides JSON-Objekt zurück.` +
            `\n- Keine Erklärungen, kein Markdown, keine Code-Fences.` +
            `\n- Behalte die fachliche Bedeutung bei.` +
            `\n\nFehlerhafte Antwort:\n${repairSource}`,
        },
      ],
      stream: true,
      timeoutMs: 120_000,
    });
    if (!repairCall) break;
    const repairedText = extractText(repairCall.response).trim();
    const repairedParsed = tryParseJsonObject(repairedText);
    if (repairedParsed) {
      return { assistantText: repairedText, parsedJson: repairedParsed };
    }
    if (repairedText) candidate = repairedText;
  }

  const actionModels = resolveSurveyActionModels();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const regenerate = await callAnthropicFirstAvailable({
      anthropic: input.anthropic,
      models: actionModels,
      maxTokens: 16384,
      system: input.system,
      messages: [
        ...input.baseMessages,
        { role: "assistant", content: input.assistantText },
        {
          role: "user",
          content:
            "Deine letzte Antwort war nicht als valides JSON parsebar. Erzeuge jetzt die gleiche Aktion erneut, " +
            "aber gib ausschließlich EIN valides JSON-Objekt zurück. Kein Text davor/danach, keine Markdown-Code-Fences.",
        },
      ],
      stream: true,
      timeoutMs: 240_000,
    });
    if (!regenerate) break;
    const regeneratedText = extractText(regenerate.response).trim();
    const regeneratedParsed = tryParseJsonObject(regeneratedText);
    if (regeneratedParsed) {
      return { assistantText: regeneratedText, parsedJson: regeneratedParsed };
    }
  }

  return {
    assistantText:
      "Ich konnte den Vorschlag gerade nicht sauber formatieren. Schick die Anfrage bitte direkt nochmal, ich liefere dir dann einen korrekt validen JSON-Vorschlag.",
    parsedJson: null,
  };
}

function toPromptTerms(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

function buildStepOutline(definition: unknown) {
  if (!definition || typeof definition !== "object") return [];
  const def = definition as { steps?: unknown };
  if (!Array.isArray(def.steps)) return [];
  return def.steps
    .map((rawStep, idx) => {
      if (!rawStep || typeof rawStep !== "object") return null;
      const step = rawStep as {
        id?: unknown;
        title?: unknown;
        description?: unknown;
        fields?: unknown;
      };
      const fields = Array.isArray(step.fields) ? step.fields : [];
      const fieldSummaries = fields
        .map((f) => {
          if (!f || typeof f !== "object") return null;
          const field = f as { id?: unknown; title?: unknown; type?: unknown };
          const id = typeof field.id === "string" ? field.id : "";
          if (!id) return null;
          return {
            id,
            title: typeof field.title === "string" ? field.title : "",
            type: typeof field.type === "string" ? field.type : "",
          };
        })
        .filter((v): v is { id: string; title: string; type: string } => Boolean(v));
      return {
        index: idx + 1,
        id: typeof step.id === "string" ? step.id : `step_${idx + 1}`,
        title: typeof step.title === "string" ? step.title : "",
        description: typeof step.description === "string" ? step.description : "",
        fieldCount: fields.length,
        fields: fieldSummaries,
      };
    })
    .filter((v): v is {
      index: number;
      id: string;
      title: string;
      description: string;
      fieldCount: number;
      fields: Array<{ id: string; title: string; type: string }>;
    } => Boolean(v));
}

function buildDuplicateIdReport(definition: unknown) {
  const empty = {
    stepIds: [] as Array<{ id: string; count: number }>,
    fieldIds: [] as Array<{ id: string; count: number }>,
    optionIds: [] as Array<{ fieldId: string; optionId: string; count: number }>,
  };
  if (!definition || typeof definition !== "object") return empty;
  const def = definition as { steps?: unknown };
  if (!Array.isArray(def.steps)) return empty;

  const stepCounts = new Map<string, number>();
  const fieldCounts = new Map<string, number>();
  const optionCounts = new Map<string, number>();

  for (const rawStep of def.steps) {
    if (!rawStep || typeof rawStep !== "object") continue;
    const step = rawStep as { id?: unknown; fields?: unknown };
    if (typeof step.id === "string" && step.id.trim()) {
      stepCounts.set(step.id, (stepCounts.get(step.id) ?? 0) + 1);
    }
    if (!Array.isArray(step.fields)) continue;
    for (const rawField of step.fields) {
      if (!rawField || typeof rawField !== "object") continue;
      const field = rawField as { id?: unknown; options?: unknown };
      const fieldId = typeof field.id === "string" ? field.id : "";
      if (fieldId) fieldCounts.set(fieldId, (fieldCounts.get(fieldId) ?? 0) + 1);
      if (!Array.isArray(field.options)) continue;
      for (const rawOption of field.options) {
        if (!rawOption || typeof rawOption !== "object") continue;
        const optionId = (rawOption as { id?: unknown }).id;
        if (typeof optionId !== "string" || !optionId.trim()) continue;
        const optionKey = `${fieldId}:::${optionId}`;
        optionCounts.set(optionKey, (optionCounts.get(optionKey) ?? 0) + 1);
      }
    }
  }

  return {
    stepIds: Array.from(stepCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([id, count]) => ({ id, count })),
    fieldIds: Array.from(fieldCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([id, count]) => ({ id, count })),
    optionIds: Array.from(optionCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([key, count]) => {
        const [fieldId, optionId] = key.split(":::");
        return { fieldId, optionId, count };
      }),
  };
}

const DEFAULT_AI_CHAT_TITLE = "Neuer Chat";

function stripMessageBodyForTitle(content: string): string {
  const trimmed = content.split(/\n\nAnhang-Zusammenfassung:\n/)[0]?.trim() ?? content.trim();
  return trimmed.replace(/\s+/g, " ").trim();
}

/** Fallback: erste Nutzernachricht (ohne technischen Anhang-Block). */
function deriveFallbackChatTitleFromFirstUser(messages: Array<{ role: string; content: string }>): string | null {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser?.content?.trim()) return null;
  const oneLine = stripMessageBodyForTitle(firstUser.content);
  const title = oneLine.slice(0, 100).trim();
  if (!title || title === DEFAULT_AI_CHAT_TITLE) return null;
  return title;
}

function sanitizeOneLineAiTitle(raw: string): string | null {
  const firstLine =
    raw
      .trim()
      .replace(/^[`"'„“\s]+|[`"'”“\s]+$/g, "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  const clipped = firstLine.slice(0, 120).trim();
  if (!clipped || clipped.toLowerCase() === DEFAULT_AI_CHAT_TITLE.toLowerCase()) return null;
  return clipped;
}

async function generateChatTitleFromFirstThreeMessages(input: {
  anthropic: Anthropic;
  firstThree: Array<{ role: string; content: string }>;
}): Promise<string | null> {
  const serialized = input.firstThree
    .map((m, idx) => {
      const roleLabel =
        m.role === "user" ? "Nutzer" : m.role === "assistant" ? "Assistent" : String(m.role);
      const text = stripMessageBodyForTitle(m.content).slice(0, 2500);
      return `${idx + 1}. ${roleLabel}: ${text}`;
    })
    .join("\n");

  const userPrompt = `Konversation (erste drei Nachrichten):\n${serialized}\n\nAntworte ausschließlich mit einem passenden deutschsprachigen Chat-Titel, sonst mit nichts.`;

  for (const model of resolveSurveyUtilityModels()) {
    try {
      const res = await input.anthropic.messages.create({
        model,
        max_tokens: 120,
        system:
          "Du vergibst einen kurzen prägnanten deutschen Chat-Titel (maximal etwa zehn Wörter, höchstens 100 Zeichen). Keine Anführungszeichen, keine Nummerierung, kein Markdown.",
        messages: [{ role: "user", content: userPrompt }],
      });
      const sanitized = sanitizeOneLineAiTitle(extractText(res));
      if (sanitized) return sanitized;
    } catch (error) {
      if (isModelNotFoundError(error)) continue;
      console.warn("auto chat title generation failed", { model }, error);
    }
  }

  return null;
}

async function maybeAutoTitleAiChat(input: {
  supabase: SupabaseClient;
  userId: string;
  chatId: string;
  title: string;
  messages: Array<{ role: string; content: string }>;
  anthropic: Anthropic;
}) {
  if (input.title.trim() !== DEFAULT_AI_CHAT_TITLE) return;
  if (input.messages.length < 3) return;

  const firstThree = input.messages.slice(0, 3);
  const derived =
    (await generateChatTitleFromFirstThreeMessages({
      anthropic: input.anthropic,
      firstThree,
    })) ?? deriveFallbackChatTitleFromFirstUser(input.messages);
  if (!derived) return;

  await input.supabase
    .from("ai_chats")
    .update({ title: derived.slice(0, 120).trim(), updated_at: new Date().toISOString() })
    .eq("id", input.chatId)
    .eq("user_id", input.userId);
}

function buildConversationSummary(history: Array<{ role: "user" | "assistant" | "system"; content: string }>) {
  if (history.length === 0) return "Keine vorherigen Nachrichten.";
  const lines = history.map((msg) => {
    const roleLabel = msg.role === "user" ? "User" : msg.role === "assistant" ? "Assistant" : "System";
    const compact = msg.content.replace(/\s+/g, " ").trim();
    const snippet = compact.length > 220 ? `${compact.slice(0, 220)}...` : compact;
    return `${roleLabel}: ${snippet}`;
  });
  const summary = lines.join("\n");
  if (summary.length <= HISTORY_SUMMARY_CHAR_LIMIT) return summary;
  return `${summary.slice(0, HISTORY_SUMMARY_CHAR_LIMIT)}...`;
}

async function completeAssistantTextWithContinuation(input: {
  anthropic: Anthropic;
  model: string;
  maxTokens: number;
  system: SurveyChatSystem;
  baseMessages: Anthropic.MessageParam[];
  initialResponse: Anthropic.Messages.Message;
}) {
  let fullText = extractText(input.initialResponse);
  let stopReason = input.initialResponse.stop_reason;
  let rounds = 0;

  while (stopReason === "max_tokens" && rounds < 3) {
    rounds += 1;
    const continued = await callAnthropicFirstAvailable({
      anthropic: input.anthropic,
      models: [input.model],
      maxTokens: input.maxTokens,
      system: input.system,
      messages: [
        ...input.baseMessages,
        { role: "assistant", content: fullText },
        {
          role: "user",
          content:
            "Fahre exakt dort fort, wo du aufgehört hast. Wiederhole nichts und beende die Antwort vollständig.",
        },
      ],
      timeoutMs: 240_000,
    });
    if (!continued) break;

    const nextText = extractText(continued.response);
    // Never inject separator characters between continuations: this can corrupt large JSON payloads.
    if (nextText) fullText += nextText;
    stopReason = continued.response.stop_reason;
  }

  return fullText;
}

export async function POST(req: Request, context: { params: Promise<{ chatId: string }> }) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Not authenticated." }, { status: 401 });
  }

  const { chatId } = await context.params;
  const chat = await getChatOrNull(chatId, auth.userId);
  if (!chat) return NextResponse.json({ ok: false, message: "Chat nicht gefunden." }, { status: 404 });

  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  const attachments = parsed.data.attachments ?? [];
  const attachmentSummaries = attachments.map((a) => ({
    fileName: a.fileName,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    textPreview: (a.textContent ?? "").slice(0, 1500),
  }));

  const { data: insertedUserMessage, error: userMsgError } = await auth.supabase
    .from("ai_chat_messages")
    .insert({
      chat_id: chatId,
      role: "user",
      content: parsed.data.content,
      metadata: {
        pageContext: parsed.data.pageContext,
        attachments: attachmentSummaries,
      },
    })
    .select("id,chat_id,role,content,metadata,created_at")
    .single();

  if (userMsgError || !insertedUserMessage) {
    return NextResponse.json({ ok: false, message: "Nachricht konnte nicht gespeichert werden." }, { status: 500 });
  }

  if (attachments.length > 0) {
    const persistResult = await persistAiChatAttachments({
      supabase: auth.supabase,
      userId: auth.userId,
      chatId,
      messageId: insertedUserMessage.id,
      attachments,
    });

    if (!persistResult.ok) {
      await rollbackUserMessageAndStorage({
        supabase: auth.supabase,
        messageId: insertedUserMessage.id,
        storagePaths: persistResult.uploadedPaths,
      });
      return NextResponse.json(
        { ok: false, message: persistResult.message || "Anhänge konnten nicht gespeichert werden." },
        { status: 400 },
      );
    }
  }

  await auth.supabase
    .from("ai_chats")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", chatId)
    .eq("user_id", auth.userId);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, message: "ANTHROPIC_API_KEY is not configured." }, { status: 500 });
  }
  const anthropic = new Anthropic({
    apiKey,
    defaultHeaders: anthropicSurveyBetaHeaders(),
  });

  // Start SSE immediately after the user message is persisted so proxies get a
  // first byte quickly. Heavy prep (history, URL fetch, title, Anthropic) runs
  // inside the stream with heartbeats + status events.
  const stream = createSseStream(async (emit) => {
    emit("status", { message: "Ich lese kurz den bisherigen Chatverlauf..." });

    const prefsResult = await ensureSurveyAiUserPreferences(auth.supabase, auth.userId);
    const globalAssistantRules = prefsResult.ok ? prefsResult.prefs.global_assistant_rules.trim() : "";
    const assistantRulesFromChat = (chat.assistant_rules ?? "").trim();

    const { data: chatMessages } = await auth.supabase
      .from("ai_chat_messages")
      .select("id,role,content,metadata,created_at")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true });

    const dbRowsFull: DbChatMessageRow[] = (chatMessages ?? []).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      metadata: m.metadata,
    }));

    const fullHistoryPlain = dbRowsFull.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: stripLegacyAttachmentSuffix(m.content),
    }));

    const rawDbSlice = dbRowsFull.slice(-RAW_HISTORY_LIMIT);
    const summaryDbSlice = dbRowsFull.slice(0, Math.max(0, dbRowsFull.length - RAW_HISTORY_LIMIT));
    const summaryForModel = summaryDbSlice.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: stripLegacyAttachmentSuffix(m.content),
    }));
    const conversationSummary = buildConversationSummary(summaryForModel);

    const rawSliceIds = rawDbSlice.map((m) => m.id);
    let attachRowsScoped: Array<{
      message_id: string | null;
      storage_path: string;
      mime_type: string;
      file_name: string;
    }> = [];
    if (rawSliceIds.length > 0) {
      const { data: attData } = await auth.supabase
        .from("ai_chat_attachments")
        .select("message_id,storage_path,mime_type,file_name")
        .eq("chat_id", chatId)
        .in("message_id", rawSliceIds);
      attachRowsScoped = attData ?? [];
    }

    const attachmentsByMessageId = new Map<string, DbAttachmentRow[]>();
    for (const r of attachRowsScoped) {
      const mid = r.message_id as string | null;
      if (!mid) continue;
      const arr = attachmentsByMessageId.get(mid) ?? [];
      arr.push({
        message_id: mid,
        storage_path: r.storage_path,
        mime_type: r.mime_type,
        file_name: r.file_name,
      });
      attachmentsByMessageId.set(mid, arr);
    }

    let anthropicHistory: Anthropic.MessageParam[];
    try {
      anthropicHistory = await hydrateHistoryForAnthropic({
        supabase: auth.supabase,
        messages: rawDbSlice,
        attachmentsByMessageId,
      });
    } catch (e) {
      console.error("hydrateHistoryForAnthropic failed; using text-only history", e);
      anthropicHistory = rawDbSlice
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: stripLegacyAttachmentSuffix(m.content),
        }));
    }

    const { data: surveys } = await auth.supabase
      .from("surveys")
      .select("id,title,description,visibility,folder_id,updated_at")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(SURVEY_RANK_POOL);
    const { data: folders } = await auth.supabase
      .from("survey_folders")
      .select("id,name")
      .order("name", { ascending: true });

    const folderSnapshots = (folders ?? []).map((f: { id: string; name: string }) => ({
      id: f.id,
      name: f.name,
    }));

    const activeSurveyId = parsed.data.pageContext.surveyId ?? null;
    const terms = toPromptTerms(parsed.data.content);

    type SurveyRankRow = {
      id: string;
      title: string;
      description: string | null;
      visibility: "private" | "public";
      folder_id: string | null;
      updated_at: string;
    };

    const rankedSurveys = (surveys ?? [])
      .map((s: SurveyRankRow) => {
        const hay = `${s.title} ${s.description ?? ""}`.toLowerCase();
        const score = terms.reduce((acc, term) => (hay.includes(term) ? acc + 1 : acc), 0);
        const currentBoost = activeSurveyId && activeSurveyId === s.id ? 3 : 0;
        return { ...s, score: score + currentBoost };
      })
      .sort(
        (a: SurveyRankRow & { score: number }, b: SurveyRankRow & { score: number }) =>
          b.score - a.score || b.updated_at.localeCompare(a.updated_at),
      );

    const knownSurveyIds = new Set<string>();
    if (activeSurveyId) knownSurveyIds.add(activeSurveyId);
    for (const s of rankedSurveys) {
      if (knownSurveyIds.size >= MAX_KNOWN_SURVEYS) break;
      knownSurveyIds.add(s.id);
    }

    const candidateIdSet = new Set<string>();
    if (activeSurveyId) candidateIdSet.add(activeSurveyId);
    for (const s of rankedSurveys) {
      if (candidateIdSet.size >= MAX_CANDIDATE_SURVEY_CONTEXTS) break;
      candidateIdSet.add(s.id);
    }
    const candidateIds = Array.from(candidateIdSet);

    const { data: candidateSurveyContexts } =
      candidateIds.length > 0
        ? await auth.supabase
            .from("surveys")
            .select("id,title,description,visibility,folder_id,notification_emails,definition")
            .in("id", candidateIds)
            .is("deleted_at", null)
        : {
            data: [] as Array<{
              id: string;
              title: string;
              description: string | null;
              visibility: "private" | "public";
              folder_id: string | null;
              notification_emails: string[] | null;
              definition: unknown;
            }>,
          };

    const lastAssistantMsg = [...fullHistoryPlain].reverse().find((m) => m.role === "assistant");
    const recentAssistantWasAction = lastAssistantMsg
      ? hasActionJsonIntent(lastAssistantMsg.content)
      : false;
    const modelSelection = selectSurveyModelsForMessage({
      userMessage: parsed.data.content,
      page: parsed.data.pageContext.page,
      recentAssistantWasAction,
    });

    emit("status", { message: "Ich bereite den Kontext vor..." });
    const pastedWebsiteContent = await buildPastedUrlContextText(parsed.data.content);

    const systemPromptInput: SurveyChatSystemPromptInput = {
      globalUserRules: globalAssistantRules,
      chatUserRules: assistantRulesFromChat,
      pageContext: {
        page: parsed.data.pageContext.page,
        surveyId: activeSurveyId,
        visibility: parsed.data.pageContext.visibility,
        slug: parsed.data.pageContext.slug,
        notificationEmails: parsed.data.pageContext.notificationEmails ?? [],
      },
      surveys: rankedSurveys
        .filter((s: SurveyRankRow & { score: number }) => knownSurveyIds.has(s.id))
        .map((s: SurveyRankRow) => ({
          id: s.id,
          title: s.title,
          visibility: s.visibility,
          folderId: s.folder_id ?? null,
        })),
      folders: folderSnapshots,
      candidateSurveyContexts: (candidateSurveyContexts ?? []).map(
        (s: {
          id: string;
          title: string;
          description: string | null;
          visibility: "private" | "public";
          folder_id: string | null;
          notification_emails: string[] | null;
          definition: unknown;
        }) => {
          const base = {
            id: s.id,
            title: s.title,
            visibility: s.visibility,
            folderId: s.folder_id ?? null,
            notificationEmails: s.notification_emails ?? [],
            stepOutline: buildStepOutline(s.definition),
            duplicateIdReport: buildDuplicateIdReport(s.definition),
          };
          if (activeSurveyId && s.id === activeSurveyId) {
            return { ...base, definition: s.definition };
          }
          return base;
        },
      ),
      attachmentSummaries: attachmentSummaries.map(
        (a) => `${a.fileName} (${a.mimeType}, ${a.sizeBytes} bytes)`,
      ),
      conversationSummary,
      pastedWebsiteContent,
    };

    const systemBlocks = buildCachedSurveyChatSystem(systemPromptInput);

    const useMultiPhase =
      isMultiPhaseSurveyCreationEnabled() &&
      modelSelection.tier === "action" &&
      isLargeSurveyCreationIntent(parsed.data.content);

    emit("meta", {
      pageContext: parsed.data.pageContext,
      modelTier: modelSelection.tier,
      modelCandidates: modelSelection.modelsToTry,
      promptCacheEnabled: isPromptCachingEnabled(),
      multiPhaseRequested: useMultiPhase,
      fullHistoryCount: fullHistoryPlain.length,
      selectedHistoryCount: anthropicHistory.length,
      summarizedHistoryCount: summaryDbSlice.length,
      contextTruncated: summaryDbSlice.length > 0,
      knownSurveyCount: knownSurveyIds.size,
      candidateSurveyCount: candidateIds.length,
    });

    // Non-blocking for the main reply path; title can finish in parallel-ish after first status.
    void maybeAutoTitleAiChat({
      supabase: auth.supabase,
      userId: auth.userId,
      chatId,
      title: chat.title,
      messages: fullHistoryPlain,
      anthropic,
    }).catch((err) => console.warn("auto chat title failed", err));

    let response: Anthropic.Messages.Message | null = null;
    let selectedModel: string | null = null;
    let rawAssistantText: string | null = null;
    let multiPhaseMeta: { phaseCount: number; stepCount: number } | null = null;

    if (useMultiPhase) {
      const multi = await runMultiPhaseSurveyCreation({
        anthropic,
        userMessage: parsed.data.content,
        system: systemBlocks,
        historyMessages: anthropicHistory,
        folders: folderSnapshots,
        onStatus: (message) => emit("status", { message }),
      });
      if (multi.ok) {
        rawAssistantText = multi.assistantText;
        selectedModel = multi.model;
        multiPhaseMeta = { phaseCount: multi.phaseCount, stepCount: multi.stepCount };
      } else {
        emit("status", {
          message: `Mehrphasige Erstellung fehlgeschlagen (${multi.message}) — ich versuche es in einem Schritt…`,
        });
        console.warn("Multi-phase survey creation failed; falling back to single-shot", multi.message);
      }
    }

    if (!rawAssistantText) {
      emit("status", { message: "Ich formuliere gerade die beste Antwort..." });

      const firstCall = await callAnthropicFirstAvailable({
        anthropic,
        models: modelSelection.modelsToTry,
        maxTokens: modelSelection.maxTokens,
        system: systemBlocks,
        messages: anthropicHistory,
        stream: true,
        timeoutMs: 240_000,
      });

      if (!firstCall) {
        emit("error", {
          message:
            "AI model unavailable. Set ANTHROPIC_SURVEY_CHAT_MODEL / ANTHROPIC_SURVEY_ACTION_MODEL to valid models.",
        });
        console.error("Global chat model selection failed", {
          tier: modelSelection.tier,
          modelsToTry: modelSelection.modelsToTry,
        });
        return;
      }

      response = firstCall.response;
      selectedModel = firstCall.model;

      rawAssistantText = await completeAssistantTextWithContinuation({
        anthropic,
        model: selectedModel,
        maxTokens: modelSelection.maxTokens,
        system: systemBlocks,
        baseMessages: anthropicHistory,
        initialResponse: response,
      });
    }

    emit("status", { message: "Ich prüfe das Format für dich..." });
    const ensuredAssistant = await ensureValidAssistantOutput({
      anthropic,
      utilityModels: resolveSurveyUtilityModels(),
      system: systemBlocks,
      baseMessages: anthropicHistory,
      assistantText: rawAssistantText,
    });
    const assistantText = ensuredAssistant.assistantText;
    emit("status", { message: "Ich finalisiere die Antwort..." });

    const assistantInsert = await auth.supabase
      .from("ai_chat_messages")
      .insert({
        chat_id: chatId,
        role: "assistant",
        content: assistantText,
        metadata: {
          selectedModel,
          modelTier: modelSelection.tier,
          promptCacheEnabled: isPromptCachingEnabled(),
          multiPhase: multiPhaseMeta,
          pageContext: parsed.data.pageContext,
        },
      })
      .select("id,chat_id,role,content,metadata,created_at")
      .single();
    emit("status", { message: "Ich speichere alles im Chat..." });

    if (assistantInsert.error || !assistantInsert.data) {
      emit("error", {
        message:
          assistantInsert.error?.message ||
          "Assistant message could not be persisted.",
      });
      return;
    }

    let actionId: string | null = null;
    const parsedJson = ensuredAssistant.parsedJson;
    if (parsedJson) {
      const proposal = surveyAiProposalSchema.safeParse(parsedJson);
      if (proposal.success) {
        emit("status", { message: "Ich hinterlege den Vorschlag zur Freigabe..." });
        const insertedAction = await auth.supabase
          .from("ai_chat_actions")
          .insert({
            chat_id: chatId,
            message_id: assistantInsert.data.id,
            proposal_kind: proposal.data.kind,
            proposal_json: proposal.data,
            execution_status: "proposed",
          })
          .select("id")
          .single();
        actionId = insertedAction.data?.id ?? null;
        if (!actionId) {
          console.warn("ai_chat_actions insert failed after valid proposal", insertedAction.error);
        }
      } else if (typeof (parsedJson as { kind?: unknown }).kind === "string") {
        emit("status", { message: "Ich hinterlege den Vorschlag zur Freigabe..." });
        const parsedObj = parsedJson as Record<string, unknown> & { kind: string };
        const insertedAction = await auth.supabase
          .from("ai_chat_actions")
          .insert({
            chat_id: chatId,
            message_id: assistantInsert.data.id,
            proposal_kind: parsedObj.kind,
            proposal_json: parsedObj,
            execution_status: "proposed",
            execution_result: {
              ok: false,
              message: "Vorschlag nicht vollständig validiert. Wird beim Annehmen geprüft.",
            },
          })
          .select("id")
          .single();
        actionId = insertedAction.data?.id ?? null;
      } else {
        console.warn("Assistant JSON parsed but surveyAiProposalSchema rejected it", {
          issues: proposal.error.issues.slice(0, 5),
        });
      }
    }

    emit("done", {
      messageId: assistantInsert.data.id,
      actionId,
      selectedModel,
    });
    await auth.supabase
      .from("ai_chats")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", chatId)
      .eq("user_id", auth.userId);
  });

  return new Response(stream, { headers: sseHeaders() });
}

