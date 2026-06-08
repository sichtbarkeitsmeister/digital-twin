"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { DtChatMessage, type DtChatMessageItem } from "@/components/dt/chat/dt-chat-message";
import { DtChatThinking } from "@/components/dt/chat/dt-chat-thinking";
import { cn } from "@/components/dt/cn";
import type { DtStoredAttachment } from "@/lib/dt/client-attachments";

import type { DtSeoChatTaskProposal, DtSeoTaskProposalMatchRow } from "@/lib/dt/seo/chat-task-proposals";

const SCROLL_BOTTOM_THRESHOLD = 96;

export function DtChatThread(props: {
  messages: DtChatMessageItem[];
  isThinking: boolean;
  agentName: string;
  emptyHint?: string;
  teamMode?: boolean;
  authorLabels?: Record<string, string>;
  suggestedFollowUps?: string[];
  onSuggestedFollowUp?: (text: string) => void;
  attachmentsByMessageId?: Map<string, DtStoredAttachment[]>;
  onImageClick?: (src: string) => void;
  seoTasks?: DtSeoTaskProposalMatchRow[];
  onSaveTaskProposal?: (
    messageId: string,
    proposal: DtSeoChatTaskProposal,
    index: number,
  ) => Promise<{ ok?: boolean; message?: string }>;
  onSaveAllTaskProposals?: (
    messageId: string,
    proposals: DtSeoChatTaskProposal[],
  ) => Promise<{ ok?: boolean; message?: string }>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  const visible = props.messages.filter((m) => m.role !== "system");

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    stickToBottomRef.current = true;
    setShowJumpToBottom(false);
  }, []);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom <= SCROLL_BOTTOM_THRESHOLD;
    stickToBottomRef.current = nearBottom;
    setShowJumpToBottom(!nearBottom && visible.length > 0);
  }, [visible.length]);

  useEffect(() => {
    if (stickToBottomRef.current) {
      scrollToBottom(props.isThinking ? "auto" : "smooth");
    }
  }, [props.messages.length, props.isThinking, scrollToBottom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (stickToBottomRef.current) {
        el.scrollTop = el.scrollHeight;
      } else {
        updateScrollState();
      }
    });

    observer.observe(el.firstElementChild ?? el);
    return () => observer.disconnect();
  }, [updateScrollState, visible.length]);

  const lastAssistantId = useMemo(() => {
    for (let i = visible.length - 1; i >= 0; i--) {
      if (visible[i]?.role === "assistant") return visible[i]!.id;
    }
    return null;
  }, [visible]);

  const showFollowUps =
    !props.isThinking &&
    lastAssistantId != null &&
    (props.suggestedFollowUps?.length ?? 0) > 0 &&
    Boolean(props.onSuggestedFollowUp);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        ref={scrollRef}
        onScroll={updateScrollState}
        className="scrollbar-subtle flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain px-4 py-6 sm:px-6"
      >
        {visible.length === 0 && !props.isThinking ? (
          <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-3 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sbkm-mint/25 text-sbkm-navy shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:text-white">
              <Sparkles className="h-6 w-6" aria-hidden />
            </div>
            <p className="text-lg font-semibold tracking-tight text-sbkm-navy dark:text-white">
              {props.agentName}
            </p>
            <p className="max-w-md text-sm text-sbkm-ink-600 dark:text-white/65">
              {props.emptyHint ??
                "Stelle eine Frage oder wähle einen Schnelltest — dein DigitalTwin antwortet in diesem Chat."}
            </p>
            {(props.suggestedFollowUps?.length ?? 0) > 0 && props.onSuggestedFollowUp ? (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: 0.08 }}
                className="mt-2 flex max-w-lg flex-wrap justify-center gap-2"
              >
                {props.suggestedFollowUps!.slice(0, 4).map((label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => props.onSuggestedFollowUp!(label)}
                    className="rounded-pill border border-sbkm-navy/12 bg-white/75 px-3 py-1.5 text-xs font-semibold text-sbkm-navy transition duration-150 hover:border-sbkm-mint/40 hover:bg-sbkm-mint/12 active:scale-[0.98] dark:border-white/12 dark:bg-white/5 dark:text-white"
                  >
                    {label}
                  </button>
                ))}
              </motion.div>
            ) : null}
          </div>
        ) : (
          <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4">
            {visible.map((m, i) => (
              <DtChatMessage
                key={m.id}
                message={m}
                index={i}
                showAuthor={props.teamMode && m.role === "user"}
                authorLabel={
                  m.author_user_id
                    ? (props.authorLabels?.[m.author_user_id] ?? "Nutzer")
                    : null
                }
                storedAttachments={props.attachmentsByMessageId?.get(m.id)}
                onImageClick={props.onImageClick}
                seoTasks={props.seoTasks}
                onSaveTaskProposal={
                  m.role === "assistant" && props.onSaveTaskProposal
                    ? (proposal, index) => props.onSaveTaskProposal!(m.id, proposal, index)
                    : undefined
                }
                onSaveAllTaskProposals={
                  m.role === "assistant" && props.onSaveAllTaskProposals
                    ? (proposals) => props.onSaveAllTaskProposals!(m.id, proposals)
                    : undefined
                }
              />
            ))}
            {props.isThinking ? <DtChatThinking /> : null}
            {showFollowUps ? (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="flex flex-wrap gap-2 pt-1"
                aria-label="Vorschläge für die nächste Nachricht"
              >
                <span className="w-full text-xs font-semibold text-sbkm-ink-500 dark:text-white/45">
                  Als Nächstes
                </span>
                {props.suggestedFollowUps!.slice(0, 3).map((label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => props.onSuggestedFollowUp!(label)}
                    className="rounded-pill border border-sbkm-navy/12 bg-white/75 px-3 py-1.5 text-xs font-semibold text-sbkm-navy transition duration-150 hover:border-sbkm-mint/40 hover:bg-sbkm-mint/12 active:scale-[0.98] dark:border-white/12 dark:bg-white/5 dark:text-white"
                  >
                    {label}
                  </button>
                ))}
              </motion.div>
            ) : null}
          </div>
        )}
      </div>

      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-white/55 to-transparent dark:from-sbkm-ink-900/40"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-10 bg-gradient-to-t from-white/70 to-transparent dark:from-sbkm-ink-900/55"
        aria-hidden
      />

      <AnimatePresence>
        {showJumpToBottom ? (
          <motion.button
            type="button"
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.18 }}
            onClick={() => scrollToBottom()}
            className={cn(
              "absolute bottom-4 left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-pill border border-sbkm-navy/12 bg-white/95 px-3 py-1.5 text-xs font-semibold text-sbkm-navy shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(46,46,80,0.12)] backdrop-blur-sm transition duration-150 hover:border-sbkm-mint/40 hover:bg-sbkm-mint/10 active:scale-[0.98] dark:border-white/12 dark:bg-sbkm-ink-900/90 dark:text-white",
            )}
          >
            <ArrowDown className="size-3.5" aria-hidden />
            Neueste Nachrichten
          </motion.button>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
