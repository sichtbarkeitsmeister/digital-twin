"use client";

import { useState } from "react";
import { Copy, Download } from "lucide-react";
import { toast } from "sonner";

import { DtPillButton } from "@/components/dt/dt-pill-button";
import type { CmsFields } from "@/lib/dt/seo/grounding-design/snippet";

/**
 * The two download formats of a Grounding Page: „Als HTML-Datei“ (the full standalone page
 * with the design CSS) and „Für CMS (Snippet)“ (only the content in <div class="grounding-page">
 * plus JSON-LD, by default without CSS), and what goes into the CMS fields.
 */

const LABEL_CLASS = "text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/50";

function CopyRow(props: { label: string; value: string | null; hint?: string }) {
  async function copy() {
    if (!props.value) return;
    try {
      await navigator.clipboard.writeText(props.value);
      toast.success(`${props.label} kopiert.`);
    } catch {
      toast.error("Kopieren nicht möglich – bitte von Hand markieren.");
    }
  }
  return (
    <div className="grid gap-1 sm:grid-cols-[minmax(0,10rem)_1fr_auto] sm:items-start">
      <span className="text-xs font-semibold text-sbkm-navy dark:text-white">{props.label}</span>
      <span className="min-w-0 break-words text-xs text-sbkm-navy dark:text-white/85">
        {props.value ?? "—"}
        {props.hint ? <span className="block text-sbkm-ink-600 dark:text-white/50">{props.hint}</span> : null}
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        disabled={!props.value}
        className="inline-flex w-fit items-center gap-1 rounded-pill border border-sbkm-navy/15 px-2 py-0.5 text-[11px] font-semibold text-sbkm-navy hover:bg-sbkm-navy/5 disabled:opacity-40 dark:border-white/15 dark:text-white"
        aria-label={`${props.label} kopieren`}
      >
        <Copy className="size-3" aria-hidden />
        Kopieren
      </button>
    </div>
  );
}

export function DtSeoGroundingDownloads(props: {
  /** Download of the full page. */
  htmlHref: string;
  /** Download of the CMS snippet; `css` adds the design scoped to .grounding-page. */
  snippetHref: (css: boolean) => string;
  /** Extra links next to the two formats (e.g. llms.txt). */
  extra?: React.ReactNode;
  cmsFields: CmsFields | null;
}) {
  const [withCss, setWithCss] = useState(false);
  const fields = props.cmsFields;
  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid content-start gap-1.5 rounded-xl border border-sbkm-navy/10 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.04]">
          <DtPillButton asChild size="sm" variant="outline" className="w-fit gap-1.5">
            <a href={props.htmlHref}>
              <Download className="size-4" aria-hidden />
              Als HTML-Datei
            </a>
          </DtPillButton>
          <p className="text-xs text-sbkm-ink-600 dark:text-white/55">
            Die vollständige Seite mit dem Design der Website. Zum Hochladen als eigene Datei unter der Grounding-URL.
          </p>
        </div>
        <div className="grid content-start gap-1.5 rounded-xl border border-sbkm-navy/10 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.04]">
          <DtPillButton asChild size="sm" variant="outline" className="w-fit gap-1.5">
            <a href={props.snippetHref(withCss)}>
              <Download className="size-4" aria-hidden />
              Für CMS (Snippet)
            </a>
          </DtPillButton>
          <label className="flex items-center gap-2 text-xs text-sbkm-navy dark:text-white">
            <input type="checkbox" className="size-3.5 accent-sbkm-navy" checked={withCss} onChange={(e) => setWithCss(e.target.checked)} />
            Design mitliefern
          </label>
          <p className="text-xs text-sbkm-ink-600 dark:text-white/55">
            Nur der Inhalt in <code className="text-[0.95em]">&lt;div class=&quot;grounding-page&quot;&gt;</code> plus JSON-LD, ohne &lt;html&gt;,
            &lt;head&gt; und &lt;body&gt;. Ohne Haken gestaltet das Theme des CMS die Seite; mit Haken kommt das Design-CSS mit, begrenzt auf
            .grounding-page. In WordPress als Block „Individuelles HTML“ einfügen.
          </p>
        </div>
      </div>
      {props.extra ? <div className="flex flex-wrap gap-2">{props.extra}</div> : null}
      {fields ? (
        <div className="grid gap-2 rounded-xl border border-sbkm-navy/10 p-3 dark:border-white/10">
          <p className={LABEL_CLASS}>Felder im CMS (für das Snippet)</p>
          <CopyRow label="Seitentitel (SEO)" value={fields.title} />
          <CopyRow label="Meta-Description" value={fields.metaDescription} />
          <CopyRow label="Kanonische URL" value={fields.canonicalUrl} />
          <CopyRow label="Slug" value={fields.slug} hint={fields.path && fields.path !== `/${fields.slug}/` ? `Pfad: ${fields.path}` : undefined} />
          {fields.h1 ? (
            <p className="text-xs text-sbkm-ink-600 dark:text-white/55">
              Die Seite hat genau eine H1 („{fields.h1}“). Zeigt das Theme den Seitentitel ebenfalls als Überschrift, den Seitentitel im CMS
              ausblenden, sonst stehen zwei H1 auf der Seite.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
