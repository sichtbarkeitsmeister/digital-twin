"use client";

import { useEffect, useMemo, useRef } from "react";
import { Sparkles } from "lucide-react";
import { motion } from "framer-motion";

import { DtChatMessage, type DtChatMessageItem } from "@/components/dt/chat/dt-chat-message";
import { DtChatThinking } from "@/components/dt/chat/dt-chat-thinking";
import type { DtStoredAttachment } from "@/lib/dt/client-attachments";

import type { DtSeoChatTaskProposal, DtSeoTaskProposalMatchRow } from "@/lib/dt/seo/chat-task-proposals";

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
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [props.messages.length, props.isThinking]);

  const visible = props.messages.filter((m) => m.role !== "system");

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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="scrollbar-subtle flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain px-4 py-6 sm:px-6">
        {visible.length === 0 && !props.isThinking ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-8 text-center">
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
            <div ref={bottomRef} className="h-1 shrink-0" />
          </div>
        )}
      </div>
    </div>
  );
}
