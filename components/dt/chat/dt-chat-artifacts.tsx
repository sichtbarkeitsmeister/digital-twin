"use client";

import { useCallback, useMemo, useState } from "react";
import { Download, ExternalLink, Eye, EyeOff, FileCode, FileText } from "lucide-react";

import { cn } from "@/components/dt/cn";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import {
  dtChatArtifactByteLength,
  isDtChatHtmlMime,
  type DtChatArtifact,
} from "@/lib/dt/chat-artifacts";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function mimeLabel(mimeType: string): string {
  if (isDtChatHtmlMime(mimeType)) return "HTML-Dokument";
  if (mimeType === "text/markdown") return "Markdown";
  if (mimeType === "text/csv") return "CSV";
  if (mimeType === "application/json") return "JSON";
  if (mimeType === "text/css") return "CSS";
  if (mimeType === "application/xml") return "XML";
  return "Textdatei";
}

function downloadArtifact(artifact: DtChatArtifact) {
  const blob = new Blob([artifact.content], {
    type: `${artifact.mimeType};charset=utf-8`,
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = artifact.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

function openArtifactInNewTab(artifact: DtChatArtifact) {
  const blob = new Blob([artifact.content], {
    type: `${artifact.mimeType};charset=utf-8`,
  });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function ArtifactCard(props: { artifact: DtChatArtifact }) {
  const { artifact } = props;
  const html = isDtChatHtmlMime(artifact.mimeType);
  const [preview, setPreview] = useState(false);
  const bytes = useMemo(
    () => dtChatArtifactByteLength(artifact.content),
    [artifact.content],
  );
  const srcDoc = useMemo(() => artifact.content, [artifact.content]);
  const Icon = html ? FileCode : FileText;

  const onDownload = useCallback(() => downloadArtifact(artifact), [artifact]);
  const onOpen = useCallback(() => openArtifactInNewTab(artifact), [artifact]);

  return (
    <div className="overflow-hidden rounded-xl border border-sbkm-navy/12 bg-white/80 dark:border-white/12 dark:bg-white/5">
      <div className="flex flex-wrap items-start justify-between gap-2 px-3 py-2.5">
        <div className="flex min-w-0 items-start gap-2">
          <Icon
            className="mt-0.5 size-4 shrink-0 text-sbkm-navy/70 dark:text-white/70"
            aria-hidden
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-sbkm-navy dark:text-white">
              {artifact.filename}
            </p>
            <p className="text-[11px] text-sbkm-navy/55 dark:text-white/50">
              {mimeLabel(artifact.mimeType)} · {formatBytes(bytes)}
              {artifact.title ? ` · ${artifact.title}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {html ? (
            <DtPillButton
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-2.5 text-[11px]"
              onClick={() => setPreview((v) => !v)}
            >
              {preview ? (
                <EyeOff className="size-3.5" aria-hidden />
              ) : (
                <Eye className="size-3.5" aria-hidden />
              )}
              {preview ? "Vorschau aus" : "Vorschau"}
            </DtPillButton>
          ) : null}
          {html ? (
            <DtPillButton
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-2.5 text-[11px]"
              onClick={onOpen}
            >
              <ExternalLink className="size-3.5" aria-hidden />
              Neuer Tab
            </DtPillButton>
          ) : null}
          <DtPillButton
            type="button"
            size="sm"
            className="h-8 px-2.5 text-[11px]"
            onClick={onDownload}
          >
            <Download className="size-3.5" aria-hidden />
            Herunterladen
          </DtPillButton>
        </div>
      </div>
      {html && preview ? (
        <iframe
          title={artifact.title || artifact.filename}
          sandbox="allow-scripts allow-forms allow-modals"
          srcDoc={srcDoc}
          className="block h-[min(52dvh,520px)] w-full border-0 border-t border-sbkm-navy/10 bg-white dark:border-white/10"
        />
      ) : null}
    </div>
  );
}

export function DtChatArtifacts(props: { artifacts: DtChatArtifact[] }) {
  if (props.artifacts.length === 0) return null;
  return (
    <div className={cn("mt-3 flex flex-col gap-2")}>
      {props.artifacts.map((artifact, index) => (
        <ArtifactCard key={`${artifact.filename}-${index}`} artifact={artifact} />
      ))}
    </div>
  );
}
