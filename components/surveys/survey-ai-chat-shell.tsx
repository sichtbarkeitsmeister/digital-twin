"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import { ArrowUp, FileImage, FileType, PanelLeftOpen, Plus, Settings, X } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  getSurveyAiAutoNavigateDefault,
  getSurveyAiShowArchivedDefault,
  SURVEY_AI_LAST_CHAT_KEY,
} from "@/lib/settings/survey-ai";
import { SURVEY_AI_MAX_ASSISTANT_RULES_CHARS } from "@/lib/settings/survey-ai-server";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  SurveyAiChatList,
  type AiChatListItem,
} from "@/components/surveys/survey-ai-chat-list";
import {
  SurveyAiChatThread,
  type AiChatMessage,
  type AiChatStoredAttachment,
} from "@/components/surveys/survey-ai-chat-thread";
import type { AiChatAction } from "@/components/surveys/survey-ai-action-trace";
import {
  countSurveyDeletesInProposal,
  parseSurveyAiProposal,
} from "@/lib/ai/survey-assistant-types";
import { describeSkippedPatchFields } from "@/lib/ai/survey-patch";
import {
  applySurveyProposalToWizardDraft,
  isLiveWizardSurveyProposal,
} from "@/lib/surveys/apply-wizard-survey-proposal";
import {
  getFragebogenWizardDraft,
  setFragebogenWizardDraft,
} from "@/lib/surveys/fragebogen-wizard-draft-store";
import type { Survey } from "@/lib/surveys/types";
import {
  isSurveyAiMultimodalMime,
  isSurveyAiMultimodalImageMime,
  normalizeSurveyAiMime,
  SURVEY_AI_ATTACHMENT_ACCEPT_ATTR,
  SURVEY_AI_MAX_ATTACHMENT_BYTES,
  SURVEY_AI_MAX_ATTACHMENTS,
  SURVEY_AI_MAX_MESSAGE_CHARS,
} from "@/lib/ai/survey-ai-attachments-shared";

type PageContext = {
  page:
    | "survey_list"
    | "survey_builder_new"
    | "survey_builder_edit"
    | "dt_agents"
    | "survey_to_agent";
  surveyId: string | null;
  visibility?: "private" | "public";
  slug?: string | null;
  notificationEmails?: string[];
  organisationId?: string | null;
  agentId?: string | null;
  liveWizardDraft?: boolean;
  currentSurvey?: Survey;
};

type AttachmentDraft = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  textContent?: string;
  dataBase64?: string;
  /** Lokale Vorschau nur im Composer / optimistische Bubble */
  previewObjectUrl?: string;
};

function guessMimeFromFile(file: File): string {
  if (file.type?.trim()) return file.type.trim();
  const n = file.name.toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".gif")) return "image/gif";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".md")) return "text/markdown";
  if (n.endsWith(".json")) return "application/json";
  if (n.endsWith(".txt")) return "text/plain";
  if (n.endsWith(".csv")) return "text/csv";
  return "application/octet-stream";
}

function readFileAsBase64Payload(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? "");
      const comma = s.indexOf(",");
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(file);
  });
}

export function SurveyAiChatShell(props: { pageContext: PageContext }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(
    getSurveyAiShowArchivedDefault(),
  );
  const [autoNavigate, setAutoNavigate] = useState(
    getSurveyAiAutoNavigateDefault(),
  );

  const [chats, setChats] = useState<AiChatListItem[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [actions, setActions] = useState<AiChatAction[]>([]);
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const attachmentsLenRef = useRef(0);
  useEffect(() => {
    attachmentsLenRef.current = attachments.length;
  }, [attachments]);
  const [chatAttachmentsByMessage, setChatAttachmentsByMessage] = useState<
    Map<string, AiChatStoredAttachment[]>
  >(new Map());
  const [dropHighlight, setDropHighlight] = useState(false);
  type ChatStatusTone = "error" | "success" | "neutral";
  const [status, setStatusState] = useState<{
    message: string;
    tone: ChatStatusTone;
  } | null>(null);
  const setStatus = (message: string | null, tone: ChatStatusTone = "error") => {
    if (!message) {
      setStatusState(null);
      return;
    }
    setStatusState({ message, tone });
  };
  const [thinkingStatus, setThinkingStatus] = useState<string | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const preferredChatIdRef = useRef<string | null>(null);
  const hasFinishedInitialLoadRef = useRef(false);
  const lastPersistedAssistantRulesRef = useRef("");
  const selectedChatIdRef = useRef<string | null>(null);
  const [chatSettingsPanelOpen, setChatSettingsPanelOpen] = useState(false);
  const [chatAssistantRules, setChatAssistantRules] = useState("");

  const finishInitialLoading = useCallback(() => {
    if (!hasFinishedInitialLoadRef.current) {
      hasFinishedInitialLoadRef.current = true;
      setIsInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
  }, [selectedChatId]);

  useEffect(() => {
    /** Device-local only: restores last opened chat ID (Survey KI settings are server-backed). */
    try {
      const rawLastChat = window.localStorage.getItem(SURVEY_AI_LAST_CHAT_KEY);
      if (rawLastChat) {
        preferredChatIdRef.current = rawLastChat;
        setSelectedChatId(rawLastChat);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/settings/survey-ai", { cache: "no-store" });
      const data = (await res.json()) as {
        ok: boolean;
        preferences?: {
          autoNavigate: boolean;
          showArchivedChats: boolean;
        };
      };
      if (cancelled) return;
      if (data.ok && data.preferences) {
        setAutoNavigate(data.preferences.autoNavigate);
        setShowArchived(data.preferences.showArchivedChats);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedChatId) {
      setChatAssistantRules("");
      lastPersistedAssistantRulesRef.current = "";
      setChatSettingsPanelOpen(false);
    }
  }, [selectedChatId]);

  const headerChatTitle = useMemo(() => {
    if (!selectedChatId) return null;
    const c = chats.find((x) => x.id === selectedChatId);
    const t = c?.title?.trim();
    return t || "Chat";
  }, [chats, selectedChatId]);

  const contextSummary = useMemo(() => {
    const pageLabel =
      props.pageContext.page === "survey_list"
        ? "Du bist gerade in der Umfrage-Liste."
        : props.pageContext.page === "survey_builder_new"
          ? props.pageContext.currentSurvey
            ? "Du prüfst gerade einen neuen Fragebogen-Entwurf. Änderungen gelten direkt in der Prüfung."
            : "Du erstellst gerade eine neue Umfrage."
          : props.pageContext.page === "dt_agents"
            ? "Du bist in der Agenten-Verwaltung (DigitalTwin)."
            : props.pageContext.page === "survey_to_agent"
              ? "Du konvertierst gerade eine Umfrage zu einem Agenten."
              : "Du bearbeitest gerade eine bestehende Umfrage.";
    const details = [
      props.pageContext.surveyId
        ? `Survey-ID: ${props.pageContext.surveyId}`
        : null,
      props.pageContext.organisationId
        ? `Org: ${props.pageContext.organisationId}`
        : null,
      props.pageContext.agentId ? `Agent: ${props.pageContext.agentId}` : null,
      props.pageContext.visibility
        ? `Sichtbarkeit: ${props.pageContext.visibility}`
        : null,
      props.pageContext.slug ? `Slug: ${props.pageContext.slug}` : null,
      props.pageContext.currentSurvey
        ? "Offener Entwurf (noch nicht gespeichert)"
        : null,
    ]
      .filter(Boolean)
      .join(" | ");
    return details ? `${pageLabel} ${details}` : pageLabel;
  }, [props.pageContext]);

  const handleShellWheelCapture = useCallback(
    (e: WheelEvent<HTMLDivElement>) => {
      const root = shellRef.current;
      if (!root) return;

      const target = e.target as HTMLElement | null;
      if (!target || !root.contains(target)) return;

      const isScrollable = (el: HTMLElement) => {
        const style = window.getComputedStyle(el);
        const overflowY = style.overflowY;
        return (
          (overflowY === "auto" || overflowY === "scroll") &&
          el.scrollHeight > el.clientHeight
        );
      };

      let current: HTMLElement | null = target;
      let scrollContainer: HTMLElement | null = null;
      while (current && current !== root) {
        if (isScrollable(current)) {
          scrollContainer = current;
          break;
        }
        current = current.parentElement;
      }

      if (!scrollContainer && messagesViewportRef.current) {
        scrollContainer = messagesViewportRef.current;
      }

      if (scrollContainer) {
        scrollContainer.scrollTop += e.deltaY;
        e.preventDefault();
        e.stopPropagation();
      }
    },
    [],
  );

  const loadChats = useCallback(
    async (nextQuery = query, nextShowArchived = showArchived) => {
      const sp = new URLSearchParams();
      if (nextQuery.trim()) sp.set("q", nextQuery.trim());
      if (nextShowArchived) sp.set("includeArchived", "1");
      const res = await fetch(`/api/ai/chats?${sp.toString()}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        ok: boolean;
        chats?: AiChatListItem[];
        message?: string;
      };
      if (!res.ok || !data.ok) {
        setStatus(data.message ?? "Chats konnten nicht geladen werden.");
        finishInitialLoading();
        return;
      }
      const nextChats = data.chats ?? [];
      setChats(nextChats);
      const preferredId = selectedChatId ?? preferredChatIdRef.current;
      if (preferredId && nextChats.some((chat) => chat.id === preferredId)) {
        if (selectedChatId !== preferredId) {
          setSelectedChatId(preferredId);
        }
        finishInitialLoading();
        return;
      }
      if (nextChats.length > 0) {
        setSelectedChatId(nextChats[0]?.id ?? null);
      } else if (selectedChatId) {
        setSelectedChatId(null);
      }
      finishInitialLoading();
    },
    [finishInitialLoading, query, selectedChatId, showArchived],
  );

  const loadChat = useCallback(async (chatId: string) => {
    const res = await fetch(`/api/ai/chats/${chatId}`, { cache: "no-store" });
    const data = (await res.json()) as {
      ok: boolean;
      chat?: { title?: string; assistant_rules?: string | null };
      messages?: AiChatMessage[];
      actions?: AiChatAction[];
      attachments?: AiChatStoredAttachment[];
      message?: string;
    };
    if (!res.ok || !data.ok) {
      setStatus(data.message ?? "Chat konnte nicht geladen werden.");
      return;
    }
    const nextTitle =
      typeof data.chat?.title === "string" && data.chat.title.trim()
        ? data.chat.title.trim()
        : null;
    if (nextTitle) {
      setChats((prev) =>
        prev.some((c) => c.id === chatId)
          ? prev.map((c) => (c.id === chatId ? { ...c, title: nextTitle } : c))
          : prev,
      );
    }
    setMessages((data.messages ?? []) as AiChatMessage[]);
    setActions((data.actions ?? []) as AiChatAction[]);
    const byMsg = new Map<string, AiChatStoredAttachment[]>();
    for (const row of data.attachments ?? []) {
      const mid = row.message_id;
      if (!mid) continue;
      const list = byMsg.get(mid) ?? [];
      list.push(row);
      byMsg.set(mid, list);
    }
    setChatAttachmentsByMessage(byMsg);
    const rules =
      typeof data.chat?.assistant_rules === "string"
        ? data.chat.assistant_rules
        : "";
    setChatAssistantRules(rules);
    lastPersistedAssistantRulesRef.current = rules;
  }, []);

  useEffect(() => {
    void loadChats();
  }, [loadChats]);

  useEffect(() => {
    if (!selectedChatId) {
      setChatAttachmentsByMessage(new Map());
      return;
    }
    setChatAttachmentsByMessage(new Map());
    void loadChat(selectedChatId);
  }, [loadChat, selectedChatId]);

  useEffect(() => {
    if (!selectedChatId) return;
    if (chatAssistantRules === lastPersistedAssistantRulesRef.current) return;
    const chatIdForPatch = selectedChatId;
    const rulesForPatch = chatAssistantRules;
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/ai/chats/${chatIdForPatch}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assistantRules: rulesForPatch }),
          });
          const data = (await res.json()) as { ok: boolean; message?: string };
          if (
            res.ok &&
            data.ok &&
            selectedChatIdRef.current === chatIdForPatch
          ) {
            lastPersistedAssistantRulesRef.current = rulesForPatch;
          } else if (data.message) {
            setStatus(data.message);
          }
        } catch {
          setStatus("Chat-Regeln konnten nicht gespeichert werden.");
        }
      })();
    }, 450);
    return () => window.clearTimeout(t);
  }, [chatAssistantRules, selectedChatId]);

  useLayoutEffect(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport || !selectedChatId) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [selectedChatId, messages, isBusy]);

  useEffect(() => {
    try {
      if (selectedChatId) {
        window.localStorage.setItem(SURVEY_AI_LAST_CHAT_KEY, selectedChatId);
        preferredChatIdRef.current = selectedChatId;
      } else {
        window.localStorage.removeItem(SURVEY_AI_LAST_CHAT_KEY);
        preferredChatIdRef.current = null;
      }
    } catch {
      // ignore
    }
  }, [selectedChatId]);

  async function createChat() {
    const res = await fetch("/api/ai/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = (await res.json()) as {
      ok: boolean;
      chat?: AiChatListItem;
      message?: string;
    };
    if (!res.ok || !data.ok || !data.chat) {
      setStatus(data.message ?? "Chat konnte nicht erstellt werden.");
      return;
    }
    setSelectedChatId(data.chat.id);
    await loadChats();
  }

  async function renameChat(id: string) {
    const title = window.prompt("Neuer Chat-Titel");
    if (!title?.trim()) return;
    await fetch(`/api/ai/chats/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim() }),
    });
    await loadChats();
  }

  async function archiveToggle(id: string, archive: boolean) {
    await fetch(`/api/ai/chats/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: archive }),
    });
    await loadChats();
    if (selectedChatId === id && archive && !showArchived) {
      setSelectedChatId(null);
      setMessages([]);
      setActions([]);
    }
  }

  async function deleteChat(id: string) {
    const ok = window.confirm("Chat wirklich löschen?");
    if (!ok) return;
    await fetch(`/api/ai/chats/${id}`, { method: "DELETE" });
    await loadChats();
    if (selectedChatId === id) {
      setSelectedChatId(null);
      setMessages([]);
      setActions([]);
    }
  }

  function revokeDraftPreview(d: AttachmentDraft) {
    if (d.previewObjectUrl) URL.revokeObjectURL(d.previewObjectUrl);
  }

  function removeComposerAttachment(index: number) {
    setAttachments((prev) => {
      const copy = [...prev];
      const removed = copy.splice(index, 1)[0];
      if (removed) revokeDraftPreview(removed);
      return copy;
    });
  }

  async function processFilesForAttachments(fileArray: File[]) {
    const incoming = fileArray.filter(Boolean);
    if (incoming.length === 0) return;

    if (attachmentsLenRef.current >= SURVEY_AI_MAX_ATTACHMENTS) {
      setStatus(`Höchstens ${SURVEY_AI_MAX_ATTACHMENTS} Anhänge pro Nachricht.`);
      return;
    }

    const slots = SURVEY_AI_MAX_ATTACHMENTS - attachmentsLenRef.current;
    const drafts: AttachmentDraft[] = [];
    for (const f of incoming) {
      if (drafts.length >= slots) break;
      const rawMime = guessMimeFromFile(f);
      const mimeNorm = normalizeSurveyAiMime(rawMime);

      if (f.size > SURVEY_AI_MAX_ATTACHMENT_BYTES) {
        setStatus(
          `„${f.name}“ ist zu groß (max. ${Math.round(SURVEY_AI_MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB).`,
        );
        continue;
      }

      const draft: AttachmentDraft = {
        fileName: f.name,
        mimeType: rawMime || mimeNorm,
        sizeBytes: f.size,
      };

      if (isSurveyAiMultimodalMime(mimeNorm)) {
        try {
          draft.dataBase64 = await readFileAsBase64Payload(f);
          if (isSurveyAiMultimodalImageMime(mimeNorm)) {
            draft.previewObjectUrl = URL.createObjectURL(f);
          }
        } catch {
          setStatus(`„${f.name}“ konnte nicht gelesen werden.`);
          continue;
        }
      } else if (
        mimeNorm.startsWith("text/") ||
        mimeNorm.includes("json") ||
        f.name.toLowerCase().endsWith(".md") ||
        mimeNorm === "application/json"
      ) {
        try {
          draft.textContent = (await f.text()).slice(0, 20000);
        } catch {
          /* ignore */
        }
      }

      drafts.push(draft);
    }

    if (drafts.length === 0) return;

    setAttachments((prev) => {
      const remain = SURVEY_AI_MAX_ATTACHMENTS - prev.length;
      if (remain <= 0) {
        drafts.forEach((d) => revokeDraftPreview(d));
        return prev;
      }
      const take = drafts.slice(0, remain);
      const drop = drafts.slice(remain);
      drop.forEach((d) => revokeDraftPreview(d));
      return [...prev, ...take];
    });
  }

  async function onAddAttachmentsFromFileList(files: FileList | null) {
    if (!files?.length) return;
    await processFilesForAttachments(Array.from(files));
  }

  async function sendPrompt() {
    await sendPromptInternal();
  }

  async function sendPromptInternal(forcedPrompt?: string) {
    const promptText = (forcedPrompt ?? prompt).trim();
    if (!promptText) return;
    if (promptText.length > SURVEY_AI_MAX_MESSAGE_CHARS) {
      setStatus(
        `Nachricht zu lang (${promptText.length.toLocaleString("de-DE")} / ${SURVEY_AI_MAX_MESSAGE_CHARS.toLocaleString("de-DE")} Zeichen). Bitte kürzen oder als Datei anhängen.`,
      );
      return;
    }
    const outgoingAttachments = [...attachments];
    const previewUrlsToCleanup = outgoingAttachments
      .map((a) => a.previewObjectUrl)
      .filter((u): u is string => Boolean(u));

    let targetChatId = selectedChatId;
    if (!targetChatId) {
      const res = await fetch("/api/ai/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as {
        ok: boolean;
        chat?: AiChatListItem;
        message?: string;
      };
      if (!res.ok || !data.ok || !data.chat) {
        setStatus(data.message ?? "Chat konnte nicht erstellt werden.");
        return;
      }
      targetChatId = data.chat.id;
      setSelectedChatId(targetChatId);
      await loadChats();
    }
    setIsBusy(true);
    setStatus(null);
    setThinkingStatus("Ich sammle kurz den relevanten Kontext...");
    const optimisticUserId = `temp-user-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: optimisticUserId,
        role: "user",
        content: promptText,
        metadata: {
          attachments: outgoingAttachments.map((a) => ({
            fileName: a.fileName,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes,
            ...(a.previewObjectUrl ? { previewUrl: a.previewObjectUrl } : {}),
          })),
        },
        created_at: new Date().toISOString(),
      },
    ]);
    if (!forcedPrompt) {
      setPrompt("");
      setAttachments([]);
    }

    const restoreComposerAfterFailure = () => {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUserId));
      if (!forcedPrompt) {
        setPrompt(promptText);
        setAttachments(outgoingAttachments);
      }
    };

    let streamStarted = false;
    try {
      const res = await fetch(`/api/ai/chats/${targetChatId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: promptText,
          pageContext: props.pageContext,
          attachments: outgoingAttachments,
        }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as {
          message?: string;
        } | null;
        restoreComposerAfterFailure();
        setStatus(data?.message ?? "Nachricht konnte nicht gesendet werden.");
        return;
      }

      streamStarted = true;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawDone = false;
      let sawError = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const evt of events) {
          // Skip SSE comments / heartbeats (`: …`)
          if (!evt.trim() || evt.trimStart().startsWith(":")) continue;
          const eventMatch = evt.match(/^event:\s*(.+)$/m);
          const dataMatch = evt.match(/^data:\s*(.+)$/m);
          if (!eventMatch || !dataMatch) continue;
          const eventName = eventMatch[1]?.trim();
          let payload: Record<string, unknown> = {};
          try {
            payload = JSON.parse(dataMatch[1] ?? "{}") as Record<string, unknown>;
          } catch {
            continue;
          }
          if (eventName === "status") {
            const nextStatus =
              typeof payload.message === "string" && payload.message.trim()
                ? payload.message.trim()
                : null;
            if (nextStatus) setThinkingStatus(nextStatus);
          }
          if (eventName === "error") {
            sawError = true;
            setStatus(String(payload.message ?? "Streaming error."));
            setThinkingStatus(null);
          }
          if (eventName === "done") {
            sawDone = true;
            setStatus(null);
            setThinkingStatus(null);
          }
        }
      }
      await loadChats();
      await loadChat(targetChatId);
      if (sawDone) {
        setStatus(null);
      } else if (!sawError) {
        setStatus(
          "Die Antwort wurde unterbrochen (Timeout). Bitte die Nachricht erneut senden.",
        );
      }
      for (const u of previewUrlsToCleanup) {
        URL.revokeObjectURL(u);
      }
    } catch {
      // Once the SSE response started, the user message is already persisted —
      // restoring the composer would hide it and look like a silent no-reply on reload.
      if (streamStarted) {
        try {
          await loadChat(targetChatId);
          await loadChats();
        } catch {
          /* ignore */
        }
        setStatus(
          "Die Verbindung wurde unterbrochen. Bitte prüfen, ob eine Antwort vorliegt, oder die Nachricht erneut senden.",
        );
      } else {
        restoreComposerAfterFailure();
        setStatus("Nachricht konnte nicht gesendet werden.");
      }
      setThinkingStatus(null);
    } finally {
      setIsBusy(false);
      setThinkingStatus(null);
    }
  }

  function isLikelyDuplicateIdFailure(message: string) {
    const text = message.toLowerCase();
    return (
      text.includes("doppelte schritt-id") ||
      text.includes("doppelte feld-id") ||
      text.includes("doppelte option-id") ||
      (text.includes("doppelte") && text.includes("id")) ||
      (text.includes("duplicate") && text.includes("id"))
    );
  }

  async function maybeTriggerAutoFixForFailedAction(
    actionId: string,
    failureMessage: string,
  ) {
    if (!isLikelyDuplicateIdFailure(failureMessage)) return;
    const shouldFix = window.confirm(
      "Die Aktion ist wegen doppelter IDs fehlgeschlagen. Soll ich die KI automatisch einen korrigierten Vorschlag mit eindeutigen IDs erstellen lassen?",
    );
    if (!shouldFix) return;
    const relatedAction = actions.find((a) => a.id === actionId);
    const actionKind =
      relatedAction &&
      relatedAction.proposal_json &&
      typeof relatedAction.proposal_json === "object" &&
      typeof (relatedAction.proposal_json as { kind?: unknown }).kind ===
        "string"
        ? String((relatedAction.proposal_json as { kind: string }).kind)
        : "unbekannt";
    const fixPrompt =
      `Die letzte Aktion (${actionKind}) ist fehlgeschlagen: "${failureMessage}". ` +
      "Bitte erstelle jetzt einen korrigierten neuen Vorschlag mit denselben fachlichen Inhalten, " +
      "aber mit eindeutigem ID-Schema (alle step.id global eindeutig, alle field.id global eindeutig, " +
      "option.id innerhalb jedes Feldes eindeutig). Nutze bei kleinen Änderungen patch_survey_definition. " +
      "Wenn etwas unklar ist, stelle eine Rückfrage statt zu raten.";
    await sendPromptInternal(fixPrompt);
  }

  async function applyAction(actionId: string) {
    if (!selectedChatId) return;
    const proposalSource = actions.find((a) => a.id === actionId);
    const deleteCount =
      proposalSource?.proposal_json != null
        ? countSurveyDeletesInProposal(proposalSource.proposal_json)
        : 0;
    if (deleteCount > 1) {
      const confirmed = window.confirm(
        `${deleteCount} Umfragen löschen — wirklich?`,
      );
      if (!confirmed) return;
    }
    setPendingActionId(actionId);
    const liveSurveyId = props.pageContext.currentSurvey?.id ?? null;
    const parsedProposal =
      proposalSource?.proposal_json != null
        ? parseSurveyAiProposal(proposalSource.proposal_json)
        : null;
    let liveDraft = false;
    let nextLiveDraft = null as ReturnType<typeof getFragebogenWizardDraft>;
    let liveSkipped: string[] = [];
    if (
      parsedProposal?.success &&
      isLiveWizardSurveyProposal(parsedProposal.data, liveSurveyId)
    ) {
      const draft = getFragebogenWizardDraft();
      if (!draft) {
        setStatus("Kein offener Fragebogen-Entwurf zum Übernehmen.");
        setPendingActionId(null);
        return;
      }
      const applied = applySurveyProposalToWizardDraft(draft, parsedProposal.data);
      if (!applied.ok) {
        setStatus(applied.message);
        setPendingActionId(null);
        return;
      }
      liveDraft = true;
      nextLiveDraft = applied.draft;
      liveSkipped = applied.skipped;
    }
    const res = await fetch(
      `/api/ai/chats/${selectedChatId}/actions/${actionId}/apply`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organisationId: props.pageContext.organisationId ?? null,
          liveDraft,
        }),
      },
    );
    const data = (await res.json()) as {
      ok: boolean;
      message: string;
      navigateTo?: string | null;
    };
    if (data.ok && liveDraft && nextLiveDraft) {
      setFragebogenWizardDraft(nextLiveDraft, "ai");
    }
    const skipNote = liveDraft ? describeSkippedPatchFields(liveSkipped) : null;
    const statusMessage =
      data.ok && skipNote
        ? `${data.message} ${skipNote}`
        : data.message;
    setStatus(statusMessage, data.ok ? "success" : "error");
    if (!data.ok) {
      await maybeTriggerAutoFixForFailedAction(actionId, data.message);
    }
    if (data.ok && !liveDraft && autoNavigate && data.navigateTo)
      router.push(data.navigateTo);
    if (data.ok && !liveDraft) router.refresh();
    await loadChat(selectedChatId);
    await loadChats();
    setPendingActionId(null);
  }

  async function revertAction(actionId: string) {
    if (!selectedChatId) return;
    setPendingActionId(actionId);
    const res = await fetch(
      `/api/ai/chats/${selectedChatId}/actions/${actionId}/revert`,
      {
        method: "POST",
      },
    );
    const data = (await res.json()) as { ok: boolean; message: string };
    setStatus(data.message, data.ok ? "success" : "error");
    if (data.ok) router.refresh();
    await loadChat(selectedChatId);
    await loadChats();
    setPendingActionId(null);
  }

  async function rejectAction(actionId: string) {
    if (!selectedChatId) return;
    setPendingActionId(actionId);
    const res = await fetch(
      `/api/ai/chats/${selectedChatId}/actions/${actionId}/reject`,
      {
        method: "POST",
      },
    );
    const data = (await res.json()) as { ok: boolean; message: string };
    setStatus(data.message, data.ok ? "success" : "error");
    await loadChat(selectedChatId);
    await loadChats();
    setPendingActionId(null);
  }

  return (
    <div
      ref={shellRef}
      className={`grid h-full max-h-full min-h-0 overflow-hidden rounded-2xl border border-border/70 bg-background shadow-xl overscroll-contain ${
        sidebarCollapsed
          ? "grid-cols-[54px_minmax(0,1fr)]"
          : "grid-cols-[280px_minmax(0,1fr)]"
      }`}
      onWheelCapture={handleShellWheelCapture}
    >
      {sidebarCollapsed ? (
        <div className="flex h-full flex-col border-r border-border/70 bg-muted/35">
          <div className="flex flex-col items-center gap-1 p-3">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => setSidebarCollapsed(false)}
              aria-label="Chat-Liste öffnen"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="shrink-0"
              onClick={() => {
                router.push("/settings#survey-ai-settings");
                window.requestAnimationFrame(() => {
                  document
                    .getElementById("survey-ai-settings")
                    ?.scrollIntoView({ behavior: "smooth" });
                });
              }}
              aria-label="Survey-KI-Einstellungen öffnen"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <SurveyAiChatList
          chats={chats}
          selectedChatId={selectedChatId}
          query={query}
          onQueryChange={(v) => {
            setQuery(v);
            void loadChats(v, showArchived);
          }}
          onCreateChat={createChat}
          onSelectChat={setSelectedChatId}
          onRenameChat={renameChat}
          onArchiveToggle={archiveToggle}
          onDeleteChat={deleteChat}
          onToggleSidebar={() => setSidebarCollapsed(true)}
          chatSettingsOpenForId={chatSettingsPanelOpen ? selectedChatId : null}
          onOpenChatSettings={(id) => {
            if (chatSettingsPanelOpen && selectedChatId === id) {
              setChatSettingsPanelOpen(false);
              return;
            }
            setSelectedChatId(id);
            setChatSettingsPanelOpen(true);
          }}
        />
      )}

      <div
        className={`relative grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-transparent transition-colors ${
          dropHighlight && selectedChatId ? "bg-primary/[0.04]" : ""
        }`}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (selectedChatId && e.dataTransfer.types.includes("Files")) setDropHighlight(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          const rel = e.relatedTarget as Node | null;
          if (!e.currentTarget.contains(rel)) setDropHighlight(false);
        }}
        onDragOver={(e) => {
          if (!selectedChatId) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDropHighlight(false);
          if (!selectedChatId) return;
          const fl = e.dataTransfer.files;
          if (fl?.length) void processFilesForAttachments(Array.from(fl));
        }}
      >
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-card/85 px-4 py-3 backdrop-blur">
          <div className="min-w-0 shrink">
            <p
              className="truncate text-sm font-semibold"
              title={headerChatTitle ?? "Survey KI"}
            >
              {headerChatTitle ?? "Survey KI"}
            </p>
            <p className="truncate text-xs text-secondary">{contextSummary}</p>
            {status ? (
              <p
                className={
                  status.tone === "success"
                    ? "mt-1 whitespace-normal break-words rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-800 dark:text-emerald-200"
                    : status.tone === "neutral"
                      ? "mt-1 whitespace-normal break-words rounded-md border border-border/70 bg-muted/50 px-2 py-1 text-xs font-medium text-foreground"
                      : "mt-1 whitespace-normal break-words rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive"
                }
                role={status.tone === "error" ? "alert" : "status"}
              >
                {status.message}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-8 w-8 shrink-0"
              title="Survey-KI-Einstellungen"
              aria-label="Survey-KI-Einstellungen"
              onClick={() => {
                router.push("/settings#survey-ai-settings");
                window.requestAnimationFrame(() => {
                  document
                    .getElementById("survey-ai-settings")
                    ?.scrollIntoView({ behavior: "smooth" });
                });
              }}
            >
              <Settings className="h-4 w-4" />
            </Button>
            <button
              type="button"
              className="rounded border px-2 py-1"
              onClick={() => {
                const prevArchived = showArchived;
                const next = !prevArchived;
                setShowArchived(next);
                void fetch("/api/settings/survey-ai", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ showArchivedChats: next }),
                }).then(async (res) => {
                  const data = (await res.json()) as { ok?: boolean };
                  if (!res.ok || !data.ok) {
                    setShowArchived(prevArchived);
                    return;
                  }
                  void loadChats(query, next);
                });
              }}
            >
              Archivierte {showArchived ? "an" : "aus"}
            </button>
            <button
              type="button"
              className="rounded border px-2 py-1"
              onClick={() => {
                const prevNav = autoNavigate;
                const next = !prevNav;
                setAutoNavigate(next);
                void fetch("/api/settings/survey-ai", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ autoNavigate: next }),
                }).then(async (res) => {
                  const data = (await res.json()) as { ok?: boolean };
                  if (!res.ok || !data.ok) setAutoNavigate(prevNav);
                });
              }}
            >
              Auto-Navigation {autoNavigate ? "an" : "aus"}
            </button>
          </div>
        </div>

        <div className="relative min-h-0 overflow-hidden">
          {dropHighlight && selectedChatId ? (
            <div
              className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-lg bg-background/55 backdrop-blur-[1px]"
              aria-hidden
            >
              <div className="rounded-xl border-2 border-dashed border-primary/45 bg-card/95 px-6 py-4 text-center shadow-lg">
                <p className="text-sm font-semibold text-foreground">Dateien hier ablegen</p>
                <p className="mt-1 text-xs text-muted-foreground">Loslassen zum Anfügen</p>
              </div>
            </div>
          ) : null}
          <div
            ref={messagesViewportRef}
            className="scrollbar-subtle h-full min-h-0 overflow-y-auto overscroll-contain bg-background p-4"
          >
            <div className="mx-auto w-full max-w-4xl">
              {isInitialLoading ? (
                <div className="grid gap-3 py-2">
                  <div className="h-20 w-[78%] animate-pulse rounded-2xl bg-muted" />
                  <div className="h-16 w-[58%] animate-pulse rounded-2xl bg-muted" />
                  <div className="h-28 w-[84%] animate-pulse rounded-2xl bg-muted" />
                </div>
              ) : selectedChatId ? (
                <SurveyAiChatThread
                  messages={messages}
                  actions={actions}
                  attachmentsByMessageId={chatAttachmentsByMessage}
                  isAssistantThinking={isBusy}
                  thinkingStatus={thinkingStatus}
                  pendingActionId={pendingActionId}
                  onApplyAction={applyAction}
                  onRevertAction={revertAction}
                  onRejectAction={rejectAction}
                />
              ) : (
                <div className="rounded-2xl border border-dashed border-border bg-card/60 p-6 text-center text-sm text-secondary">
                  Wähle einen Chat oder erstelle einen neuen.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-border/70 bg-muted/40 p-3">
          <div className="mx-auto w-full max-w-4xl">
            <div className="rounded-[28px] border border-border bg-card p-2 shadow-sm">
              {attachments.length > 0 ? (
                <div className="flex flex-wrap gap-2 px-2 pb-2">
                  {attachments.map((a, i) => {
                    const m = normalizeSurveyAiMime(a.mimeType);
                    const showThumb =
                      Boolean(a.previewObjectUrl) && isSurveyAiMultimodalImageMime(m);
                    const Icon =
                      normalizeSurveyAiMime(a.mimeType) === "application/pdf"
                        ? FileType
                        : FileImage;
                    return (
                      <div
                        key={`${a.fileName}-${i}`}
                        className="relative flex max-w-[200px] items-center gap-2 rounded-xl border border-border bg-muted/60 py-1.5 pl-1.5 pr-7 text-xs"
                      >
                        {showThumb && a.previewObjectUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={a.previewObjectUrl}
                            alt=""
                            className="h-10 w-10 shrink-0 rounded-lg object-cover"
                          />
                        ) : (
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                            <Icon className="h-5 w-5 text-muted-foreground" aria-hidden />
                          </span>
                        )}
                        <span className="min-w-0 truncate text-secondary" title={a.fileName}>
                          {a.fileName}
                        </span>
                        <button
                          type="button"
                          className="absolute right-1 top-1 rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                          aria-label={`Anhang „${a.fileName}“ entfernen`}
                          onClick={() => removeComposerAttachment(i)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              <div className="flex items-center gap-2 px-1">
                <div className="flex items-center gap-1">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept={SURVEY_AI_ATTACHMENT_ACCEPT_ATTR}
                    className="hidden"
                    onChange={(e) => {
                      void onAddAttachmentsFromFileList(e.currentTarget.files);
                      e.currentTarget.value = "";
                    }}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-9 w-9 text-secondary hover:bg-muted hover:text-foreground"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <Textarea
                  rows={1}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onPaste={(e) => {
                    const items = e.clipboardData?.items;
                    if (!items?.length || !selectedChatId) return;
                    const pastedFiles: File[] = [];
                    for (let i = 0; i < items.length; i += 1) {
                      const item = items[i];
                      if (item?.kind === "file") {
                        const f = item.getAsFile();
                        if (f) pastedFiles.push(f);
                      }
                    }
                    if (pastedFiles.length > 0) {
                      e.preventDefault();
                      void processFilesForAttachments(pastedFiles);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (!isBusy) {
                        void sendPrompt();
                      }
                    }
                  }}
                  placeholder="Nachricht an den KI-Assistenten…"
                  className="min-h-[40px] max-h-[120px] flex-1 resize-none border-0 bg-transparent px-1 py-2.5 leading-5 text-foreground placeholder:text-muted-foreground shadow-none focus-visible:ring-0"
                />
                <Button
                  type="button"
                  size="icon"
                  className="h-9 w-9 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={sendPrompt}
                  disabled={isBusy || !prompt.trim()}
                  aria-label="Senden"
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        {selectedChatId && chatSettingsPanelOpen ? (
          <div
            className="pointer-events-auto absolute inset-0 z-[40] flex flex-col border-t border-border/60 bg-background px-4 py-3 pt-2 shadow-[0_-4px_24px_rgba(0,0,0,0.06)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="chat-context-panel-title"
          >
            <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border/70 pb-3">
              <div className="min-w-0">
                <p
                  id="chat-context-panel-title"
                  className="text-sm font-semibold"
                >
                  Chat-Kontext
                </p>
                <p className="text-xs text-secondary">
                  Zusätzliche Anweisungen nur für diesen Chat. Ergänzt die
                  globalen Regeln unter Einstellungen und speichert
                  automatisch.
                </p>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                onClick={() => setChatSettingsPanelOpen(false)}
                aria-label="Schließen"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col py-3">
              <Textarea
                value={chatAssistantRules}
                maxLength={SURVEY_AI_MAX_ASSISTANT_RULES_CHARS}
                onChange={(e) => setChatAssistantRules(e.target.value)}
                placeholder="z. B. „Nur Ordner XY“ oder „Antworten in Stichpunkten“"
                className="min-h-[220px] flex-1 resize-none border border-input bg-muted text-foreground placeholder:text-muted-foreground shadow-sm text-sm leading-relaxed focus-visible:ring-1 focus-visible:ring-ring"
                aria-label="Chat-Kontext"
              />
              <p className="mt-2 shrink-0 text-right text-[11px] text-secondary">
                {chatAssistantRules.length}/
                {SURVEY_AI_MAX_ASSISTANT_RULES_CHARS}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
