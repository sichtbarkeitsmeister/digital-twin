"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

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

  if (!props.file) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-sbkm-navy/80 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-label={`Vorschau ${props.file.fileName}`}
        onClick={props.onClose}
      >
        <button
          type="button"
          className="absolute right-4 top-4 rounded-full bg-white/90 p-2 text-sbkm-navy shadow-dt hover:bg-white"
          aria-label="Schließen"
          onClick={props.onClose}
        >
          <X className="h-5 w-5" />
        </button>
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.2 }}
          className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-dt-lg dark:bg-sbkm-navy"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-3 border-b border-sbkm-navy/10 px-4 py-3 dark:border-white/10">
            <p className="min-w-0 truncate text-sm font-semibold text-sbkm-navy dark:text-white">
              {props.file.fileName}
            </p>
            <DtPillButton
              type="button"
              variant="outline"
              className="h-9 shrink-0 px-3 text-xs"
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
          </div>
          <div className="min-h-[40vh] flex-1 overflow-auto bg-sbkm-mint/[0.06] p-3 dark:bg-black/20">
            {isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={props.file.url}
                alt={props.file.fileName}
                className="mx-auto max-h-[75vh] max-w-full rounded-xl object-contain"
              />
            ) : isPdf ? (
              <iframe
                title={props.file.fileName}
                src={props.file.url}
                className="h-[75vh] w-full rounded-xl border-0 bg-white"
              />
            ) : isHtml && htmlSrcDoc ? (
              <iframe
                title={props.file.fileName}
                sandbox="allow-same-origin"
                srcDoc={htmlSrcDoc}
                className="h-[75vh] w-full rounded-xl border-0 bg-white"
              />
            ) : isText && textBody != null ? (
              <pre className="max-h-[75vh] overflow-auto whitespace-pre-wrap rounded-xl bg-white p-4 text-xs text-sbkm-navy dark:bg-white/5 dark:text-white">
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
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
