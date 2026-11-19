"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/components/dt/cn";
import { markdownToHtml, markdownToPlainText } from "@/lib/shared/markdown-lite";

/**
 * „Kopieren“ under an answer: the whole answer goes to the clipboard formatted (real headings, lists,
 * tables with borders, bold) and as plain text for editors that take no formatting. Pasted into Word or
 * Google Docs it keeps its look.
 */
export function DtChatCopyButton(props: { markdown: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  async function copy() {
    const html = `<div>${markdownToHtml(props.markdown)}</div>`;
    const plain = markdownToPlainText(props.markdown);
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([plain], { type: "text/plain" }) }),
        ]);
      } else {
        await navigator.clipboard.writeText(plain);
      }
      setCopied(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Kopieren hat nicht geklappt. Bitte den Text markieren und mit Strg+C kopieren.");
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title="Ganze Antwort mit Formatierung kopieren (für Word, Google Docs, E-Mail)"
      aria-label="Antwort kopieren"
      data-no-copy
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-pill border border-sbkm-navy/12 bg-white/70 px-2.5 text-[11px] font-semibold text-sbkm-ink-600 transition hover:bg-sbkm-mint/20 active:scale-[0.98] dark:border-white/15 dark:bg-white/5 dark:text-white/70",
        props.className,
      )}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      {copied ? "Kopiert" : "Kopieren"}
    </button>
  );
}
