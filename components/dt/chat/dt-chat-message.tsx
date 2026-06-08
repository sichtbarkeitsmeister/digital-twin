"use client";

import { motion } from "framer-motion";
import { FileImage, FileText, FileType } from "lucide-react";

import { DtChatMarkdown } from "@/components/dt/chat/dt-chat-markdown";
import { DtSeoChatTaskProposals } from "@/components/dt/seo/dt-seo-chat-task-proposals";
import { cn } from "@/components/dt/cn";
import type { DtStoredAttachment } from "@/lib/dt/client-attachments";
import {
  isDtMultimodalImageMime,
  normalizeDtMime,
} from "@/lib/dt/attachments-shared";
import {
  extractDtSeoTaskProposalsFromMessage,
  matchSavedSeoTaskProposalIndexes,
  stripDtSeoTaskProposalBlocks,
  type DtSeoChatTaskProposal,
  type DtSeoTaskProposalMatchRow,
} from "@/lib/dt/seo/chat-task-proposals";

export type DtChatMessageItem = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: Record<string, unknown>;
  author_user_id?: string | null;
  created_at: string;
};

function metadataAttachments(md: Record<string, unknown> | undefined) {
  const raw = md?.attachments;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const o = entry as Record<string, unknown>;
      const fileName = typeof o.fileName === "string" ? o.fileName : "";
      const mimeType = typeof o.mimeType === "string" ? o.mimeType : "";
      const previewUrl = typeof o.previewUrl === "string" ? o.previewUrl : undefined;
      if (!fileName) return null;
      return { fileName, mimeType, previewUrl };
    })
    .filter((v): v is NonNullable<typeof v> => v != null);
}

function AttachmentRow(props: {
  isUser: boolean;
  items: Array<{
    fileName: string;
    mimeNorm: string;
    imageSrc?: string | null;
    onImageClick?: (src: string) => void;
  }>;
}) {
  if (props.items.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {props.items.map((item, idx) => {
        const isImg = isDtMultimodalImageMime(item.mimeNorm);
        const Icon = item.mimeNorm === "application/pdf" ? FileType : FileText;
        const clickable = isImg && item.imageSrc && item.onImageClick;
        return (
          <button
            key={`${item.fileName}-${idx}`}
            type="button"
            disabled={!clickable}
            onClick={() => {
              if (item.imageSrc && item.onImageClick) item.onImageClick(item.imageSrc);
            }}
            className={cn(
              "flex max-w-[200px] items-start gap-2 rounded-xl border p-2 text-left transition",
              props.isUser
                ? "border-white/25 bg-white/10 text-white"
                : "border-sbkm-navy/12 bg-white/60 text-sbkm-navy dark:border-white/12 dark:bg-white/5 dark:text-white",
              clickable && "cursor-zoom-in hover:border-sbkm-mint/60",
              !clickable && "cursor-default",
            )}
          >
            {isImg && item.imageSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.imageSrc}
                alt=""
                className="h-14 w-14 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-white/15">
                {isImg ? (
                  <FileImage className="h-6 w-6 opacity-70" aria-hidden />
                ) : (
                  <Icon className="h-6 w-6 opacity-70" aria-hidden />
                )}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-xs font-medium" title={item.fileName}>
              {item.fileName}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function DtChatMessage(props: {
  message: DtChatMessageItem;
  index: number;
  authorLabel?: string | null;
  showAuthor?: boolean;
  storedAttachments?: DtStoredAttachment[];
  onImageClick?: (src: string) => void;
  taskProposals?: DtSeoChatTaskProposal[];
  onSaveTaskProposal?: (
    proposal: DtSeoChatTaskProposal,
    index: number,
  ) => Promise<{ ok?: boolean; message?: string }>;
  onSaveAllTaskProposals?: (
    proposals: DtSeoChatTaskProposal[],
  ) => Promise<{ ok?: boolean; message?: string }>;
  seoTasks?: DtSeoTaskProposalMatchRow[];
}) {
  const isUser = props.message.role === "user";
  const metaItems = metadataAttachments(props.message.metadata);
  const storedItems = (props.storedAttachments ?? []).map((row) => {
    const mimeNorm = normalizeDtMime(row.mime_type);
    return {
      fileName: row.file_name,
      mimeNorm,
      imageSrc: isDtMultimodalImageMime(mimeNorm) ? row.signed_url : null,
      onImageClick: props.onImageClick,
    };
  });
  const draftItems = metaItems.map((a) => ({
    fileName: a.fileName,
    mimeNorm: normalizeDtMime(a.mimeType),
    imageSrc: a.previewUrl ?? null,
    onImageClick: props.onImageClick,
  }));
  const attachItems = storedItems.length > 0 ? storedItems : draftItems;

  const taskProposals =
    props.taskProposals ??
    (!isUser
      ? extractDtSeoTaskProposalsFromMessage({
          content: props.message.content,
          metadata: props.message.metadata,
        })
      : []);

  const displayContent = !isUser ? stripDtSeoTaskProposalBlocks(props.message.content) : props.message.content;

  const savedProposalIndexes =
    !isUser && taskProposals.length > 0
      ? matchSavedSeoTaskProposalIndexes({
          proposals: taskProposals,
          messageId: props.message.id,
          tasks: props.seoTasks ?? [],
        })
      : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: Math.min(props.index * 0.03, 0.15) }}
      className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[min(720px,92%)] rounded-2xl px-4 py-3 text-[15px] leading-relaxed shadow-sm",
          isUser
            ? "bg-sbkm-navy text-white shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_20px_rgba(46,46,80,0.12)]"
            : "border border-sbkm-navy/10 bg-white/80 text-sbkm-navy dark:border-white/10 dark:bg-white/[0.08] dark:text-white",
        )}
      >
        {props.showAuthor && isUser && props.authorLabel ? (
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-white/70">
            {props.authorLabel} ·{" "}
            {new Date(props.message.created_at).toLocaleTimeString("de-DE", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        ) : null}
        {isUser ? (
          <p className="whitespace-pre-wrap">{displayContent}</p>
        ) : (
          <DtChatMarkdown content={displayContent} />
        )}
        <AttachmentRow isUser={isUser} items={attachItems} />
        {!isUser && taskProposals.length > 0 && props.onSaveTaskProposal ? (
          <DtSeoChatTaskProposals
            proposals={taskProposals}
            initialSavedIndexes={savedProposalIndexes}
            onSave={props.onSaveTaskProposal}
            onSaveAll={props.onSaveAllTaskProposals}
          />
        ) : null}
      </div>
    </motion.div>
  );
}
