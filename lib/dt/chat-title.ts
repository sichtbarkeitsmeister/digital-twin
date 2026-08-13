import Anthropic from "@anthropic-ai/sdk";

import {
  extractAnthropicText,
  isAnthropicModelNotFoundError,
} from "@/lib/ai/anthropic-helpers";

export const DEFAULT_DT_CHAT_TITLE = "Neuer Chat";
export const TEAM_DT_CHAT_TITLE = "Team-Chat";

/** Minimum assistant reply length to allow early titling after the 1st user turn. */
export const MEANINGFUL_ASSISTANT_REPLY_MIN_CHARS = 80;

/**
 * System placeholders that should still receive an auto-title once the chat
 * has enough content. Manual renames and prior AI titles are left alone.
 */
export function isProvisionalDtChatTitle(title: string): boolean {
  const t = title.trim();
  if (!t) return true;
  if (t === DEFAULT_DT_CHAT_TITLE) return true;
  if (t === TEAM_DT_CHAT_TITLE) return true;
  // Wizard / probe chats start as "Test: <Persona>" and must still be renamed.
  if (/^Test:\s+/i.test(t)) return true;
  return false;
}

/**
 * Auto-title timing (Digital Twin):
 * - Never retitle once the chat left a provisional/system title.
 * - At the latest after the 2nd user message.
 * - Optionally earlier after the 1st turn when the assistant reply is meaningful.
 */
export function shouldAutoTitleDtChat(input: {
  currentTitle: string;
  userMessageCount: number;
  assistantText: string;
}): boolean {
  if (!isProvisionalDtChatTitle(input.currentTitle)) return false;
  if (input.userMessageCount >= 2) return true;
  if (input.userMessageCount >= 1 && isMeaningfulAssistantReply(input.assistantText)) {
    return true;
  }
  return false;
}

export function isMeaningfulAssistantReply(text: string): boolean {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length < MEANINGFUL_ASSISTANT_REPLY_MIN_CHARS) return false;
  if (/^keine antwort erhalten\.?$/i.test(oneLine)) return false;
  if (/^fehler[:\s]/i.test(oneLine)) return false;
  return true;
}

export function fallbackDtChatTitle(userMessage: string, assistantMessage = ""): string {
  const raw = userMessage.trim() || assistantMessage.trim();
  const oneLine = raw.replace(/\s+/g, " ").slice(0, 60).trim();
  return oneLine.length > 0 ? oneLine : DEFAULT_DT_CHAT_TITLE;
}

export function sanitizeDtChatTitle(raw: string): string | null {
  const firstLine =
    raw
      .trim()
      .replace(/^[`"'„“\s]+|[`"'”“\s]+$/g, "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  const clipped = firstLine.replace(/\s+/g, " ").slice(0, 80).trim();
  if (!clipped || isProvisionalDtChatTitle(clipped)) return null;
  return clipped;
}

/** Keep test chats recognizable in the sidebar after auto-naming. */
export function formatDtAutoTitleForCurrent(input: {
  currentTitle: string;
  nextTitle: string;
}): string {
  const next = input.nextTitle.trim().slice(0, 80);
  if (!next) return DEFAULT_DT_CHAT_TITLE;
  const wasTest = /^Test:\s+/i.test(input.currentTitle.trim());
  if (wasTest && !/^Test:\s+/i.test(next)) {
    return `Test: ${next}`.slice(0, 80);
  }
  return next;
}

function resolveDtTitleModels(): string[] {
  const preferred =
    process.env.ANTHROPIC_DT_TITLE_MODEL?.trim() ||
    process.env.ANTHROPIC_DT_PERSONA_MODEL?.trim() ||
    "claude-haiku-4-5-20251001";
  return Array.from(
    new Set([preferred, "claude-haiku-4-5-20251001", "claude-3-5-haiku-latest"].filter(Boolean)),
  );
}

/** Cheap Anthropic call: 4–7 word German title from the first turns. */
export async function generateDtChatTitleFromMessages(input: {
  messages: Array<{ role: string; content: string }>;
  anthropic?: Anthropic;
}): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey && !input.anthropic) return null;

  const client = input.anthropic ?? new Anthropic({ apiKey: apiKey! });
  const sample = input.messages.slice(0, 4);
  if (sample.length === 0) return null;

  const serialized = sample
    .map((m, idx) => {
      const roleLabel =
        m.role === "user" ? "Nutzer" : m.role === "assistant" ? "Assistent" : String(m.role);
      const text = m.content.replace(/\s+/g, " ").trim().slice(0, 1500);
      return `${idx + 1}. ${roleLabel}: ${text}`;
    })
    .join("\n");

  const userPrompt = `Konversation:\n${serialized}\n\nAntworte ausschließlich mit einem passenden deutschsprachigen Chat-Titel (4–7 Wörter), sonst mit nichts.`;

  for (const model of resolveDtTitleModels()) {
    try {
      const res = await client.messages.create({
        model,
        max_tokens: 60,
        system:
          "Du vergibst einen kurzen prägnanten deutschen Chat-Titel (4–7 Wörter, höchstens 80 Zeichen). Keine Anführungszeichen, keine Nummerierung, kein Markdown.",
        messages: [{ role: "user", content: userPrompt }],
      });
      const sanitized = sanitizeDtChatTitle(extractAnthropicText(res));
      if (sanitized) return sanitized;
    } catch (error) {
      if (isAnthropicModelNotFoundError(error)) continue;
      console.warn("[dt] auto chat title generation failed", { model }, error);
    }
  }

  return null;
}

/**
 * Resolve the title to persist after a successful (non-ghost) chat turn.
 * Returns null when the chat should keep its current title.
 */
export async function resolveDtAutoTitleAfterTurn(input: {
  currentTitle: string;
  userMessageCount: number;
  latestUserText: string;
  assistantText: string;
  recentMessages: Array<{ role: string; content: string }>;
  /** Prefer an external title only when timing already allows auto-title. */
  preferredTitle?: string | null;
  anthropic?: Anthropic;
}): Promise<string | null> {
  if (
    !shouldAutoTitleDtChat({
      currentTitle: input.currentTitle,
      userMessageCount: input.userMessageCount,
      assistantText: input.assistantText,
    })
  ) {
    return null;
  }

  const preferred = input.preferredTitle?.trim();
  if (preferred && !isProvisionalDtChatTitle(preferred)) {
    return formatDtAutoTitleForCurrent({
      currentTitle: input.currentTitle,
      nextTitle: preferred.slice(0, 80),
    });
  }

  const generated = await generateDtChatTitleFromMessages({
    messages: input.recentMessages,
    anthropic: input.anthropic,
  });
  if (generated) {
    return formatDtAutoTitleForCurrent({
      currentTitle: input.currentTitle,
      nextTitle: generated,
    });
  }

  const fallback = fallbackDtChatTitle(input.latestUserText, input.assistantText);
  if (isProvisionalDtChatTitle(fallback)) return null;
  return formatDtAutoTitleForCurrent({
    currentTitle: input.currentTitle,
    nextTitle: fallback,
  });
}
