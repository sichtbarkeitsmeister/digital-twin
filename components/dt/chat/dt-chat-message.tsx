"use client";

import { useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { Download, FileImage, FileSpreadsheet, FileText, FileType } from "lucide-react";

import { DtChatMarkdown } from "@/components/dt/chat/dt-chat-markdown";
import { DtSeoChatTaskProposals } from "@/components/dt/seo/dt-seo-chat-task-proposals";
import { cn } from "@/components/dt/cn";
import type { DtChatPreviewFile } from "@/components/dt/chat/dt-chat-file-preview";
import type { DtStoredAttachment } from "@/lib/dt/client-attachments";
import {
  isDtExcelMime,
  isDtMultimodalImageMime,
  isDtPreviewableMime,
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

type FileCardItem = {
  fileName: string;
  mimeNorm: string;
  url?: string | null;
  created?: boolean;
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

function ghostCreatedFiles(md: Record<string, unknown> | undefined) {
  const raw = md?.created_files;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const o = entry as Record<string, unknown>;
      const fileName = typeof o.fileName === "string" ? o.fileName : "";
      const mimeType = typeof o.mimeType === "string" ? o.mimeType : "";
      const dataBase64 = typeof o.dataBase64 === "string" ? o.dataBase64 : "";
      if (!fileName || !dataBase64) return null;
      return { fileName, mimeType, dataBase64 };
    })
    .filter((v): v is NonNullable<typeof v> => v != null);
}

function fileIcon(mimeNorm: string) {
  if (isDtMultimodalImageMime(mimeNorm)) return FileImage;
  if (mimeNorm === "application/pdf") return FileType;
  if (isDtExcelMime(mimeNorm)) return FileSpreadsheet;
  return FileText;
}

async function downloadUrl(url: string, fileName: string) {
  const res = await fetch(url);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2_000);
}

function AttachmentRow(props: {
  isUser: boolean;
  items: FileCardItem[];
  onPreview?: (file: DtChatPreviewFile) => void;
}) {
  if (props.items.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {props.items.map((item, idx) => {
        const isImg = isDtMultimodalImageMime(item.mimeNorm);
        const Icon = fileIcon(item.mimeNorm);
        const previewable =
          Boolean(item.url) &&
          (isImg || isDtPreviewableMime(item.mimeNorm, item.fileName) || item.created);
        return (
          <div
            key={`${item.fileName}-${idx}`}
            className={cn(
              "flex max-w-[240px] items-start gap-2 rounded-xl border p-2 text-left",
              props.isUser
                ? "border-white/25 bg-white/10 text-white"
                : "border-sbkm-navy/12 bg-white/60 text-sbkm-navy dark:border-white/12 dark:bg-white/5 dark:text-white",
            )}
          >
            <button
              type="button"
              disabled={!previewable}
              onClick={() => {
                if (!item.url || !props.onPreview) return;
                props.onPreview({
                  url: item.url,
                  fileName: item.fileName,
                  mimeType: item.mimeNorm,
                });
              }}
              className={cn(
                "flex min-w-0 flex-1 items-start gap-2 text-left",
                previewable && "cursor-zoom-in",
                !previewable && "cursor-default",
              )}
            >
              {isImg && item.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.url}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <span
                  className={cn(
                    "flex h-14 w-14 shrink-0 items-center justify-center rounded-lg",
                    props.isUser ? "bg-white/15" : "bg-sbkm-mint/20",
                  )}
                >
                  <Icon className="h-6 w-6 opacity-80" aria-hidden />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium" title={item.fileName}>
                  {item.fileName}
                </span>
                {item.created ? (
                  <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide opacity-70">
                    Öffnen · Download
                  </span>
                ) : previewable ? (
                  <span className="mt-0.5 block text-[10px] opacity-70">Ansehen</span>
                ) : null}
              </span>
            </button>
            {item.url ? (
              <button
                type="button"
                className={cn(
                  "mt-0.5 rounded-md p-1 opacity-80 hover:opacity-100",
                  props.isUser ? "hover:bg-white/15" : "hover:bg-sbkm-navy/10 dark:hover:bg-white/10",
                )}
                aria-label={`${item.fileName} herunterladen`}
                onClick={() => void downloadUrl(item.url!, item.fileName)}
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
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
  onPreviewFile?: (file: DtChatPreviewFile) => void;
  /** @deprecated use onPreviewFile */
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
  const isAdminReply = props.message.metadata?.admin_reply === true;
  const metaItems = metadataAttachments(props.message.metadata);
  const ghostFiles = ghostCreatedFiles(props.message.metadata);
  const ghostPayload = ghostFiles
    .map((a) => `${a.fileName}:${a.mimeType}:${a.dataBase64.length}`)
    .join("|");
  const ghostUrls = useMemo(() => {
    return ghostCreatedFiles(props.message.metadata).map((a) => {
      const bin = Uint8Array.from(atob(a.dataBase64), (c) => c.charCodeAt(0));
      const blob = new Blob([bin], { type: a.mimeType || "application/octet-stream" });
      return URL.createObjectURL(blob);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recreate only when payload changes
  }, [props.message.id, ghostPayload]);

  useEffect(() => {
    return () => {
      for (const url of ghostUrls) URL.revokeObjectURL(url);
    };
  }, [ghostUrls]);

  const storedItems: FileCardItem[] = (props.storedAttachments ?? []).map((row) => {
    const mimeNorm = normalizeDtMime(row.mime_type);
    return {
      fileName: row.file_name,
      mimeNorm,
      url: row.signed_url ?? null,
      created: !isUser || row.source === "created",
    };
  });
  const draftItems: FileCardItem[] = metaItems.map((a) => ({
    fileName: a.fileName,
    mimeNorm: normalizeDtMime(a.mimeType),
    url: a.previewUrl ?? null,
    created: false,
  }));
  const ghostItems: FileCardItem[] = ghostFiles.map((a, i) => ({
    fileName: a.fileName,
    mimeNorm: normalizeDtMime(a.mimeType),
    url: ghostUrls[i] ?? null,
    created: true,
  }));
  const attachItems =
    storedItems.length > 0 ? storedItems : isUser ? draftItems : [...draftItems, ...ghostItems];

  const onPreview = (file: DtChatPreviewFile) => {
    if (props.onPreviewFile) {
      props.onPreviewFile(file);
      return;
    }
    if (isDtMultimodalImageMime(file.mimeType)) props.onImageClick?.(file.url);
  };

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
          "max-w-[min(720px,92%)] min-w-0 overflow-hidden break-words rounded-2xl px-4 py-3 text-[15px] leading-relaxed shadow-sm",
          isUser
            ? "bg-sbkm-navy text-white shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_20px_rgba(46,46,80,0.12)]"
            : "border border-sbkm-navy/10 bg-white/80 text-sbkm-navy dark:border-white/10 dark:bg-white/[0.08] dark:text-white",
          !isUser &&
            "[&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:max-w-full",
        )}
      >
        {props.showAuthor && isUser && props.authorLabel ? (
          <p className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/70">
            <span>
              {props.authorLabel} ·{" "}
              {new Date(props.message.created_at).toLocaleTimeString("de-DE", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {isAdminReply ? (
              <span className="rounded-pill bg-sbkm-mint/25 px-1.5 py-0.5 text-[10px] font-bold normal-case tracking-normal text-sbkm-mint">
                Admin
              </span>
            ) : null}
          </p>
        ) : null}
        {isUser ? (
          <p className="whitespace-pre-wrap">{displayContent}</p>
        ) : (
          <DtChatMarkdown content={displayContent} />
        )}
        <AttachmentRow isUser={isUser} items={attachItems} onPreview={onPreview} />
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
