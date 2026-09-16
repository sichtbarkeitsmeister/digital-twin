"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { cn } from "@/components/dt/cn";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import {
  isDtMultimodalImageMime,
  isDtTextLikeMime,
  normalizeDtMime,
} from "@/lib/dt/attachments-shared";

export type DtChatPreviewFile = {
  url: string;
  fileName: string;
  mimeType: string;
};

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

function wrapHtmlPreview(html: string): string {
  const trimmed = html.trim();
  if (/<html[\s>]/i.test(trimmed)) return trimmed;
  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;margin:24px;line-height:1.5;color:#1b1b32}</style></head><body>${trimmed}</body></html>`;
}

export function DtChatFilePreview(props: {
  file: DtChatPreviewFile | null;
  onClose: () => void;
  className?: string;
}) {
  const mime = normalizeDtMime(props.file?.mimeType ?? "");
  const isImage = props.file ? isDtMultimodalImageMime(mime) : false;
  const isPdf = mime === "application/pdf" || (props.file?.fileName.toLowerCase().endsWith(".pdf") ?? false);
  const isHtml =
    mime === "text/html" ||
    (props.file?.fileName.toLowerCase().endsWith(".html") ?? false) ||
    (props.file?.fileName.toLowerCase().endsWith(".htm") ?? false);
  const isText = props.file
    ? isDtTextLikeMime(mime, props.file.fileName) && !isHtml
    : false;

  const [textBody, setTextBody] = useState<string | null>(null);
  const [htmlBody, setHtmlBody] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!props.file) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.file, props.onClose]);

  useEffect(() => {
    setTextBody(null);
    setHtmlBody(null);
    setLoadError(null);
    if (!props.file || isImage || isPdf) return;
    if (!isHtml && !isText) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(props.file!.url);
        const body = await res.text();
        if (cancelled) return;
        if (isHtml) setHtmlBody(wrapHtmlPreview(body));
        else setTextBody(body);
      } catch {
        if (!cancelled) setLoadError("Vorschau konnte nicht geladen werden.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.file, isHtml, isImage, isPdf, isText]);

  const htmlSrcDoc = useMemo(() => htmlBody, [htmlBody]);

  return (
    <AnimatePresence>
      {props.file ? (
        <motion.aside
          key={`${props.file.fileName}:${props.file.url}`}
          initial={{ opacity: 0, x: 28 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 28 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          role="complementary"
          aria-label={`Datei ${props.file.fileName}`}
          className={cn(
            "flex min-h-0 min-w-0 flex-col overflow-hidden bg-white shadow-[0_0_28px_rgba(46,46,80,0.14)] dark:bg-sbkm-navy",
            "absolute inset-0 z-30",
            "md:static md:inset-auto md:z-auto md:w-[48%] md:min-w-[20rem] md:max-w-[46rem] md:shrink-0 md:border-l md:border-sbkm-navy/10 md:shadow-none dark:md:border-white/10",
            props.className,
          )}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-sbkm-navy/10 px-3 py-2.5 dark:border-white/10 sm:px-4">
            <p className="min-w-0 truncate text-sm font-semibold text-sbkm-navy dark:text-white">
              {props.file.fileName}
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              <DtPillButton
                type="button"
                variant="outline"
                className="h-9 px-3 text-xs"
                disabled={downloading}
                onClick={() => {
                  setDownloading(true);
                  void downloadUrl(props.file!.url, props.file!.fileName).finally(() =>
                    setDownloading(false),
                  );
                }}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Herunterladen
              </DtPillButton>
              <button
                type="button"
                className="inline-grid h-9 w-9 place-items-center rounded-full text-sbkm-navy transition hover:bg-sbkm-navy/10 dark:text-white dark:hover:bg-white/10"
                aria-label="Datei schließen"
                onClick={props.onClose}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden bg-sbkm-mint/[0.06] dark:bg-black/20">
            {isImage ? (
              <div className="flex h-full items-center justify-center overflow-auto p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={props.file.url}
                  alt={props.file.fileName}
                  className="max-h-full max-w-full rounded-xl object-contain"
                />
              </div>
            ) : isPdf ? (
              <iframe
                title={props.file.fileName}
                src={props.file.url}
                className="h-full w-full border-0 bg-white"
              />
            ) : isHtml && htmlSrcDoc ? (
              <iframe
                title={props.file.fileName}
                sandbox="allow-same-origin"
                srcDoc={htmlSrcDoc}
                className="h-full w-full border-0 bg-white"
              />
            ) : isText && textBody != null ? (
              <pre className="h-full overflow-auto whitespace-pre-wrap p-4 text-xs text-sbkm-navy dark:text-white">
                {textBody}
              </pre>
            ) : loadError ? (
              <p className="p-6 text-sm text-sbkm-ink-600 dark:text-white/70">{loadError}</p>
            ) : isHtml || isText ? (
              <p className="p-6 text-sm text-sbkm-ink-600 dark:text-white/70">Vorschau wird geladen…</p>
            ) : (
              <p className="p-6 text-sm text-sbkm-ink-600 dark:text-white/70">
                Diese Datei hat keine Live-Vorschau. Bitte herunterladen.
              </p>
            )}
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
