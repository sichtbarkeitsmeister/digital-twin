"use client";

import { useCallback, useMemo, useState } from "react";
import { ExternalLink, Maximize2, Minimize2 } from "lucide-react";

import { DtPillButton } from "@/components/dt/dt-pill-button";
import { cn } from "@/components/dt/cn";

function wrapHtmlDocument(fragment: string): string {
  const trimmed = fragment.trim();
  if (/<html[\s>]/i.test(trimmed)) return trimmed;
  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank" rel="noopener noreferrer"></head><body style="margin:0;padding:16px;font-family:'Poppins',-apple-system,sans-serif;">${trimmed}</body></html>`;
}

export function DtSeoReportHtmlViewer(props: {
  html: string;
  title?: string;
  /** Compact layout for use inside modals — no toolbar, shorter iframe */
  embedded?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const srcDoc = useMemo(() => wrapHtmlDocument(props.html), [props.html]);

  const openInNewTab = useCallback(() => {
    const blob = new Blob([srcDoc], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, [srcDoc]);

  if (props.embedded) {
    return (
      <div className="overflow-hidden rounded-xl border border-sbkm-navy/12 bg-white dark:border-white/10">
        <iframe
          title={props.title ?? "SEO-Report"}
          sandbox="allow-same-origin"
          srcDoc={srcDoc}
          className="block h-[min(52dvh,520px)] w-full border-0 bg-white"
        />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-dt-lg border border-sbkm-navy/12 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sbkm-navy/10 bg-sbkm-navy/[0.04] px-4 py-2.5">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-sbkm-navy/75">
            Report-Vorschau
          </p>
          <p className="text-xs text-sbkm-navy/55">
            Im Report scrollen oder in neuem Tab öffnen
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <DtPillButton
            type="button"
            variant="outline"
            className="h-9 px-3 text-xs text-sbkm-navy active:scale-[0.98] transition-transform duration-150"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <>
                <Minimize2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Verkleinern
              </>
            ) : (
              <>
                <Maximize2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Vergrößern
              </>
            )}
          </DtPillButton>
          <DtPillButton
            type="button"
            className="h-9 px-3 text-xs active:scale-[0.98] transition-transform duration-150"
            onClick={openInNewTab}
          >
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            In neuem Tab öffnen
          </DtPillButton>
        </div>
      </div>
      <iframe
        title={props.title ?? "SEO-Report"}
        sandbox="allow-same-origin"
        srcDoc={srcDoc}
        className={cn(
          "block w-full border-0 bg-white",
          expanded ? "min-h-[calc(100vh-12rem)]" : "min-h-[min(720px,calc(100vh-16rem))]",
        )}
      />
    </div>
  );
}
