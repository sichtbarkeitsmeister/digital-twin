"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type WheelEvent } from "react";
import { ArrowUp, PanelLeftOpen, Plus, Settings, X } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  getSurveyAiAutoNavigateDefault,
  getSurveyAiShowArchivedDefault,
  SURVEY_AI_LAST_CHAT_KEY,
} from "@/lib/settings/survey-ai";
import { SURVEY_AI_MAX_ASSISTANT_RULES_CHARS } from "@/lib/settings/survey-ai-server";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SurveyAiChatList, type AiChatListItem } from "@/components/surveys/survey-ai-chat-list";
import { SurveyAiChatThread, type AiChatMessage } from "@/components/surveys/survey-ai-chat-thread";
import type { AiChatAction } from "@/components/surveys/survey-ai-action-trace";
import { countSurveyDeletesInProposal } from "@/lib/ai/survey-assistant-types";

type PageContext = {
  page: "survey_list" | "survey_builder_new" | "survey_builder_edit";
  surveyId: string | null;
  visibility?: "private" | "public";
  slug?: string | null;
  notificationEmails?: string[];
};

type AttachmentDraft = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  textContent?: string;
};

export function SurveyAiChatShell(props: {
  pageContext: PageContext;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(getSurveyAiShowArchivedDefault());
  const [autoNavigate, setAutoNavigate] = useState(getSurveyAiAutoNavigateDefault());

  const [chats, setChats] = useState<AiChatListItem[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [actions, setActions] = useState<AiChatAction[]>([]);
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [status, setStatus] = useState<string | null>(null);
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
          ? "Du erstellst gerade eine neue Umfrage."
          : "Du bearbeitest gerade eine bestehende Umfrage.";
    const details = [
      props.pageContext.surveyId ? `Survey-ID: ${props.pageContext.surveyId}` : null,
      props.pageContext.visibility ? `Sichtbarkeit: ${props.pageContext.visibility}` : null,
      props.pageContext.slug ? `Slug: ${props.pageContext.slug}` : null,
    ]
      .filter(Boolean)
      .join(" | ");
    return details ? `${pageLabel} ${details}` : pageLabel;
  }, [props.pageContext]);

  const handleShellWheelCapture = useCallback((e: WheelEvent<HTMLDivElement>) => {
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
  }, []);

  const loadChats = useCallback(async (nextQuery = query, nextShowArchived = showArchived) => {
    const sp = new URLSearchParams();
    if (nextQuery.trim()) sp.set("q", nextQuery.trim());
    if (nextShowArchived) sp.set("includeArchived", "1");
    const res = await fetch(`/api/ai/chats?${sp.toString()}`, { cache: "no-store" });
    const data = (await res.json()) as { ok: boolean; chats?: AiChatListItem[]; message?: string };
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
  }, [finishInitialLoading, query, selectedChatId, showArchived]);

  const loadChat = useCallback(async (chatId: string) => {
    const res = await fetch(`/api/ai/chats/${chatId}`, { cache: "no-store" });
    const data = (await res.json()) as {
      ok: boolean;
      chat?: { title?: string; assistant_rules?: string | null };
      messages?: AiChatMessage[];
      actions?: AiChatAction[];
      message?: string;
    };
    if (!res.ok || !data.ok) {
      setStatus(data.message ?? "Chat konnte nicht geladen werden.");
      return;
    }
    const nextTitle =
      typeof data.chat?.title === "string" && data.chat.title.trim() ? data.chat.title.trim() : null;
    if (nextTitle) {
      setChats((prev) =>
        prev.some((c) => c.id === chatId)
          ? prev.map((c) => (c.id === chatId ? { ...c, title: nextTitle } : c))
          : prev,
      );
    }
    setMessages((data.messages ?? []) as AiChatMessage[]);
    setActions((data.actions ?? []) as AiChatAction[]);
    const rules =
      typeof data.chat?.assistant_rules === "string" ? data.chat.assistant_rules : "";
    setChatAssistantRules(rules);
    lastPersistedAssistantRulesRef.current = rules;
  }, []);

  useEffect(() => {
    void loadChats();
  }, [loadChats]);

  useEffect(() => {
    if (!selectedChatId) return;
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
          if (res.ok && data.ok && selectedChatIdRef.current === chatIdForPatch) {
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
    const data = (await res.json()) as { ok: boolean; chat?: AiChatListItem; message?: string };
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

  async function onAddAttachments(files: FileList | null) {
    if (!files) return;
    const next: AttachmentDraft[] = [];
    for (const f of Array.from(files)) {
      const draft: AttachmentDraft = {
        fileName: f.name,
        mimeType: f.type || "application/octet-stream",
        sizeBytes: f.size,
      };
      if (f.type.startsWith("text/") || f.type.includes("json") || f.name.endsWith(".md")) {
        try {
          draft.textContent = (await f.text()).slice(0, 20000);
        } catch {
          // ignore text parse failures
        }
      }
      next.push(draft);
    }
    setAttachments((prev) => [...prev, ...next]);
  }

  async function sendPrompt() {
    await sendPromptInternal();
  }

  async function sendPromptInternal(forcedPrompt?: string) {
    const promptText = (forcedPrompt ?? prompt).trim();
    if (!promptText) return;
    const outgoingAttachments = [...attachments];
    let targetChatId = selectedChatId;
    if (!targetChatId) {
      const res = await fetch("/api/ai/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as { ok: boolean; chat?: AiChatListItem; message?: string };
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
        metadata: {},
        created_at: new Date().toISOString(),
      },
    ]);
    if (!forcedPrompt) {
      setPrompt("");
      setAttachments([]);
    }

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
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        setStatus(data?.message ?? "Nachricht konnte nicht gesendet werden.");
        setIsBusy(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const evt of events) {
          const eventMatch = evt.match(/^event:\s*(.+)$/m);
          const dataMatch = evt.match(/^data:\s*(.+)$/m);
          if (!eventMatch || !dataMatch) continue;
          const eventName = eventMatch[1]?.trim();
          const payload = JSON.parse(dataMatch[1] ?? "{}") as Record<string, unknown>;
          if (eventName === "status") {
            const nextStatus =
              typeof payload.message === "string" && payload.message.trim()
                ? payload.message.trim()
                : null;
            if (nextStatus) setThinkingStatus(nextStatus);
          }
          if (eventName === "error") {
            setStatus(String(payload.message ?? "Streaming error."));
            setThinkingStatus(null);
          }
          if (eventName === "done") {
            setThinkingStatus(null);
          }
        }
      }
      await loadChats();
      await loadChat(targetChatId);
    } catch {
      setStatus("Nachricht konnte nicht gesendet werden.");
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

  async function maybeTriggerAutoFixForFailedAction(actionId: string, failureMessage: string) {
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
      typeof (relatedAction.proposal_json as { kind?: unknown }).kind === "string"
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
      proposalSource?.proposal_json != null ? countSurveyDeletesInProposal(proposalSource.proposal_json) : 0;
    if (deleteCount > 1) {
      const confirmed = window.confirm(`${deleteCount} Umfragen löschen — wirklich?`);
      if (!confirmed) return;
    }
    setPendingActionId(actionId);
    const res = await fetch(`/api/ai/chats/${selectedChatId}/actions/${actionId}/apply`, {
      method: "POST",
    });
    const data = (await res.json()) as { ok: boolean; message: string; navigateTo?: string | null };
    setStatus(data.message);
    if (!data.ok) {
      await maybeTriggerAutoFixForFailedAction(actionId, data.message);
    }
    if (data.ok && autoNavigate && data.navigateTo) router.push(data.navigateTo);
    if (data.ok) router.refresh();
    await loadChat(selectedChatId);
    await loadChats();
    setPendingActionId(null);
  }

  async function revertAction(actionId: string) {
    if (!selectedChatId) return;
    setPendingActionId(actionId);
    const res = await fetch(`/api/ai/chats/${selectedChatId}/actions/${actionId}/revert`, {
      method: "POST",
    });
    const data = (await res.json()) as { ok: boolean; message: string };
    setStatus(data.message);
    if (data.ok) router.refresh();
    await loadChat(selectedChatId);
    await loadChats();
    setPendingActionId(null);
  }

  async function rejectAction(actionId: string) {
    if (!selectedChatId) return;
    setPendingActionId(actionId);
    const res = await fetch(`/api/ai/chats/${selectedChatId}/actions/${actionId}/reject`, {
      method: "POST",
    });
    const data = (await res.json()) as { ok: boolean; message: string };
    setStatus(data.message);
    await loadChat(selectedChatId);
    await loadChats();
    setPendingActionId(null);
  }

  return (
    <div
      ref={shellRef}
      className={`grid h-full min-h-0 overflow-hidden rounded-2xl border border-border/70 bg-background shadow-xl overscroll-contain ${
        sidebarCollapsed ? "grid-cols-[54px_minmax(0,1fr)]" : "grid-cols-[280px_minmax(0,1fr)]"
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
                  document.getElementById("survey-ai-settings")?.scrollIntoView({ behavior: "smooth" });
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

      <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-transparent">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-card/85 px-4 py-3 backdrop-blur">
          <div>
            <p className="text-sm font-semibold">{headerChatTitle ?? "Survey KI"}</p>
            <p className="text-xs text-secondary">{contextSummary}</p>
            {status ? <p className="mt-1 text-xs text-secondary">{status}</p> : null}
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
                  document.getElementById("survey-ai-settings")?.scrollIntoView({ behavior: "smooth" });
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
          <div className="relative z-0 flex h-full min-h-0 flex-col">
            <div
              ref={messagesViewportRef}
              className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background p-4"
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

            <div className="shrink-0 bg-transparent p-3">
              <div className="mx-auto w-full max-w-4xl">
                <div className="rounded-[28px] border border-border bg-card p-2 shadow-xl">
                  {attachments.length > 0 ? (
                    <div className="flex flex-wrap gap-2 px-2 pb-2">
                      {attachments.map((a, i) => (
                        <span
                          key={`${a.fileName}-${i}`}
                          className="rounded border border-border bg-muted px-2 py-1 text-xs text-secondary"
                        >
                          {a.fileName}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="flex items-center gap-2 px-1">
                    <div className="flex items-center gap-1">
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          void onAddAttachments(e.currentTarget.files);
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
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (!isBusy) {
                            void sendPrompt();
                          }
                        }
                      }}
                      placeholder="Nachricht an den KI-Assistenten…"
                      className="min-h-[40px] max-h-[120px] flex-1 resize-none border-0 bg-transparent px-1 py-2.5 leading-5 text-foreground placeholder:text-secondary shadow-none focus-visible:ring-0"
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
                  <p id="chat-context-panel-title" className="text-sm font-semibold">
                    Chat-Kontext
                  </p>
                  <p className="text-xs text-secondary">
                    Zusätzliche Anweisungen nur für diesen Chat. Ergänzt die globalen Regeln unter
                    Einstellungen und speichert automatisch.
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
                  placeholder='z. B. „Nur Ordner XY“ oder „Antworten in Stichpunkten“'
                  className="min-h-[220px] flex-1 resize-none border border-input bg-muted text-foreground placeholder:text-muted-foreground shadow-sm text-sm leading-relaxed focus-visible:ring-1 focus-visible:ring-ring"
                  aria-label="Chat-Kontext"
                />
                <p className="mt-2 shrink-0 text-right text-[11px] text-secondary">
                  {chatAssistantRules.length}/{SURVEY_AI_MAX_ASSISTANT_RULES_CHARS}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

