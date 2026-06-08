"use client";

import { FileImage, FileType, X } from "lucide-react";

import { cn } from "@/components/dt/cn";
import type { DtAttachmentDraft } from "@/lib/dt/client-attachments";
import {
  isDtMultimodalImageMime,
  normalizeDtMime,
} from "@/lib/dt/attachments-shared";

export function DtAttachmentChips(props: {
  attachments: DtAttachmentDraft[];
  onRemove: (index: number) => void;
  disabled?: boolean;
}) {
  if (props.attachments.length === 0) return null;

  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {props.attachments.map((a, i) => {
        const m = normalizeDtMime(a.mimeType);
        const showThumb = Boolean(a.previewObjectUrl) && isDtMultimodalImageMime(m);
        const Icon = m === "application/pdf" ? FileType : FileImage;
        return (
          <div
            key={`${a.fileName}-${i}`}
            className={cn(
              "relative flex max-w-[200px] items-center gap-2 rounded-xl border border-sbkm-navy/12 bg-white/80 py-1.5 pl-1.5 pr-7 text-xs shadow-sm",
              "dark:border-white/12 dark:bg-white/5",
            )}
          >
            {showThumb && a.previewObjectUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={a.previewObjectUrl}
                alt=""
                className="h-10 w-10 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sbkm-mint/15">
                <Icon className="h-5 w-5 text-sbkm-navy dark:text-white/70" aria-hidden />
              </span>
            )}
            <span
              className="min-w-0 truncate font-medium text-sbkm-navy dark:text-white"
              title={a.fileName}
            >
              {a.fileName}
            </span>
            <button
              type="button"
              disabled={props.disabled}
              className="absolute right-1 top-1 rounded-md p-0.5 text-sbkm-ink-500 hover:bg-sbkm-navy/10 hover:text-sbkm-navy disabled:opacity-50 dark:hover:bg-white/10"
              aria-label={`Anhang „${a.fileName}“ entfernen`}
              onClick={() => props.onRemove(i)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
