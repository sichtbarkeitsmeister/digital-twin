"use client";

/**
 * „Zielgruppen“ in the page window: each Zielgruppen avatar of the organisation with three levels
 * (Primär · Sekundär · Aus). A page without any gets the DigitalTwin's suggestion when it opens;
 * the editor confirms it or moves a switch (both store it as confirmed). Changes apply from the
 * next step that runs.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/components/dt/cn";
import { contentApi } from "@/components/dt/content/content-api";
import type { ContentPagePatchResult, ContentReview } from "@/lib/dt/content/types";
import {
  CONTENT_ZIELGRUPPEN_MIGRATION_FILE,
  hasContentZielgruppen,
  withZielgruppeLevel,
  zielgruppeLevel,
  type ContentZielgruppeLevel,
} from "@/lib/dt/content/zielgruppen";

export type ContentZielgruppeOption = { id: string; name: string; role: string | null };

const LEVELS: Array<{ level: ContentZielgruppeLevel; label: string }> = [
  { level: "primary", label: "Primär" },
  { level: "secondary", label: "Sekundär" },
  { level: "off", label: "Aus" },
];

const smallButton =
  "rounded-pill border border-sbkm-navy/15 bg-white px-2.5 py-1 text-[11px] font-semibold text-sbkm-navy transition-colors hover:border-sbkm-navy/40 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:bg-white/[0.06] dark:text-white";

export function DtContentZielgruppenPanel(props: {
  organisationId: string;
  pageBase: string;
  review: ContentReview;
  options: readonly ContentZielgruppeOption[];
  disabled: boolean;
  onReview: (review: ContentReview) => void;
}) {
  const { organisationId, pageBase, review, options, disabled, onReview } = props;
  const z = review.zielgruppen;
  const [busy, setBusy] = useState<"suggest" | "save" | null>(null);
  const asked = useRef<string | null>(null);

  async function suggest(force: boolean) {
    setBusy("suggest");
    const res = await contentApi<{ review: ContentReview }>(`${pageBase}/zielgruppen`, { method: "POST", body: { organisationId, force } });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    onReview(res.data.review);
  }

  async function save(primary: string[], secondary: string[], message: string) {
    setBusy("save");
    const res = await contentApi<ContentPagePatchResult>(pageBase, { method: "PATCH", body: { organisationId, zielgruppen: { primary, secondary } } });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    onReview(res.data.review);
    toast.success(message);
  }

  // A page without Zielgruppen gets the suggestion once when it opens (a few cents).
  useEffect(() => {
    if (!z || hasContentZielgruppen(z) || options.length === 0 || asked.current === pageBase || disabled) return;
    asked.current = pageBase;
    void suggest(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per page
  }, [pageBase, z, options.length, disabled]);

  if (!z) {
    return (
      <p className="text-[11px] leading-snug text-sbkm-ink-500 dark:text-white/45">
        Zielgruppen je Seite: Die Datenbank kennt sie noch nicht ({CONTENT_ZIELGRUPPEN_MIGRATION_FILE}). Bis dahin gilt die Standard-Zielgruppe oben in Texte.
      </p>
    );
  }
  if (options.length === 0) {
    return <p className="text-[11px] leading-snug text-sbkm-ink-500 dark:text-white/45">Für diese Organisation gibt es keine Zielgruppen-Avatare.</p>;
  }

  const own = hasContentZielgruppen(z);
  const off = Boolean(busy) || disabled;
  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <p className="text-xs font-semibold text-sbkm-navy dark:text-white">Zielgruppen</p>
        {busy === "suggest" ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-sky-700 dark:text-sky-300">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            Zwilling schlägt vor …
          </span>
        ) : own ? (
          <span
            className={cn(
              "rounded-pill px-2 py-0.5 text-[10px] font-bold",
              z.status === "bestaetigt"
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200"
                : "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200",
            )}
          >
            {z.status === "bestaetigt" ? "Festgelegt" : "Vorschlag des Zwillings"}
          </span>
        ) : null}
      </div>
      <ul className="grid min-w-0 gap-2">
        {options.map((o) => {
          const level = zielgruppeLevel(z, o.id);
          const reason = level !== "off" ? z.reasons[o.id] : undefined;
          return (
            <li key={o.id} className="grid min-w-0 gap-1">
              {/* Name and role wrap; the switch drops below them when the column is narrow. */}
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <span className="min-w-0 flex-1 basis-40 break-words text-xs text-sbkm-navy dark:text-white/85">
                  <span className="font-semibold">{o.name}</span>
                  {o.role ? <span className="block text-[11px] leading-snug text-sbkm-ink-500 dark:text-white/45">{o.role}</span> : null}
                </span>
                <div className="flex shrink-0 overflow-hidden rounded-pill border border-sbkm-navy/15 dark:border-white/15" role="group" aria-label={`Zielgruppe ${o.name}`}>
                  {LEVELS.map((l) => (
                    <button
                      key={l.level}
                      type="button"
                      disabled={off}
                      aria-pressed={level === l.level}
                      onClick={() => {
                        if (level === l.level) return;
                        const next = withZielgruppeLevel(z, o.id, l.level);
                        void save(next.primary, next.secondary, next.primary.length === 0 ? "Keine primäre Zielgruppe mehr: es gilt die Standard-Zielgruppe." : "Zielgruppen gespeichert – gilt ab dem nächsten Schritt.");
                      }}
                      className={cn(
                        "px-2 py-0.5 text-[10px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                        level === l.level
                          ? l.level === "primary"
                            ? "bg-emerald-600 text-white"
                            : l.level === "secondary"
                              ? "bg-sky-600 text-white"
                              : "bg-sbkm-navy/10 text-sbkm-navy dark:bg-white/15 dark:text-white"
                          : "bg-white text-sbkm-ink-600 hover:bg-sbkm-navy/5 dark:bg-transparent dark:text-white/60",
                      )}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
              {reason ? <p className="break-words text-[11px] leading-snug text-sbkm-ink-600 dark:text-white/55">{reason}</p> : null}
            </li>
          );
        })}
      </ul>
      {!own && busy !== "suggest" ? (
        <p className="text-[11px] leading-snug text-sbkm-ink-500 dark:text-white/45">Keine eigenen Zielgruppen: Es gilt die Standard-Zielgruppe oben in Texte.</p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {own && z.status !== "bestaetigt" ? (
          <button type="button" className={smallButton} disabled={off} onClick={() => void save(z.primary, z.secondary, "Zielgruppen bestätigt.")}>
            Bestätigen
          </button>
        ) : null}
        <button type="button" className={cn(smallButton, "inline-flex items-center gap-1")} disabled={off} onClick={() => void suggest(true)}>
          <Sparkles className="size-3" aria-hidden />
          {own ? "Neu vorschlagen" : "Vorschlagen lassen"}
        </button>
      </div>
      <p className="text-[11px] leading-snug text-sbkm-ink-500 dark:text-white/45">
        Primär: höchstens zwei, für sie wird geschrieben. Sekundär: höchstens drei, werden mitbedient. Gilt ab dem nächsten Schritt.
      </p>
    </div>
  );
}
