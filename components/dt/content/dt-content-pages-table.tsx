"use client";

import { ArrowRight, FileText } from "lucide-react";

import { cn } from "@/components/dt/cn";
import { DtContentStatusBadge } from "@/components/dt/content/dt-content-status-badge";
import { formatContentDate } from "@/lib/dt/content/presentation";
import type { ContentPageSummary } from "@/lib/dt/content/types";

const checkboxClass =
  "size-4 shrink-0 cursor-pointer rounded border-sbkm-navy/30 accent-sbkm-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 disabled:cursor-not-allowed disabled:opacity-40 dark:accent-sbkm-mint";

export function isContentPageSelectable(page: ContentPageSummary): boolean {
  return page.state !== "laeuft";
}

export function DtContentPagesTable(props: {
  pages: ContentPageSummary[];
  selected: Set<string>;
  onToggle: (slug: string) => void;
  onToggleAll: (checked: boolean) => void;
  onOpen: (page: ContentPageSummary) => void;
}) {
  const selectable = props.pages.filter(isContentPageSelectable);
  const allSelected =
    selectable.length > 0 && selectable.every((p) => props.selected.has(p.slug));
  const someSelected = selectable.some((p) => props.selected.has(p.slug));

  if (props.pages.length === 0) {
    return (
      <div className="grid gap-2 rounded-dt border border-dashed border-sbkm-navy/15 px-4 py-10 text-center dark:border-white/15">
        <FileText className="mx-auto size-5 text-sbkm-ink-500" aria-hidden />
        <p className="text-sm font-semibold text-sbkm-navy dark:text-white">Noch keine Seiten</p>
        <p className="mx-auto max-w-sm text-xs text-sbkm-ink-600 dark:text-white/60">
          Seiten oben eintragen, oder unter SEO → Struktur eine Webseitenstruktur hochladen.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto scrollbar-subtle">
      <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-sbkm-ink-500 dark:text-white/45">
            <th className="w-10 border-b border-sbkm-navy/10 px-3 py-2.5 dark:border-white/10">
              <input
                type="checkbox"
                className={checkboxClass}
                aria-label="Alle Seiten auswählen"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected && !allSelected;
                }}
                disabled={selectable.length === 0}
                onChange={(e) => props.onToggleAll(e.target.checked)}
              />
            </th>
            <th className="border-b border-sbkm-navy/10 px-3 py-2.5 dark:border-white/10">Seite</th>
            <th className="border-b border-sbkm-navy/10 px-3 py-2.5 dark:border-white/10">Status</th>
            <th className="border-b border-sbkm-navy/10 px-3 py-2.5 text-right dark:border-white/10">Kosten</th>
            <th className="border-b border-sbkm-navy/10 px-3 py-2.5 text-right dark:border-white/10">Fragen</th>
            <th className="border-b border-sbkm-navy/10 px-3 py-2.5 dark:border-white/10">Zuletzt</th>
            <th className="border-b border-sbkm-navy/10 px-3 py-2.5 dark:border-white/10">
              <span className="sr-only">Öffnen</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {props.pages.map((page) => {
            const checked = props.selected.has(page.slug);
            const canSelect = isContentPageSelectable(page);
            const needsYou = page.state === "braucht_sie";
            return (
              <tr
                key={page.slug}
                className={cn(
                  "group transition-colors duration-150",
                  needsYou
                    ? "bg-orange-50/70 hover:bg-orange-50 dark:bg-orange-500/[0.07] dark:hover:bg-orange-500/[0.11]"
                    : "hover:bg-sbkm-navy/[0.03] dark:hover:bg-white/[0.03]",
                  checked && !needsYou && "bg-sbkm-mint/[0.08] dark:bg-sbkm-mint/[0.05]",
                )}
              >
                <td className="border-b border-sbkm-navy/8 px-3 py-3 align-middle dark:border-white/8">
                  <input
                    type="checkbox"
                    className={checkboxClass}
                    aria-label={`${page.name} auswählen`}
                    checked={checked}
                    disabled={!canSelect}
                    title={canSelect ? undefined : "Läuft gerade"}
                    onChange={() => props.onToggle(page.slug)}
                  />
                </td>
                <td className="border-b border-sbkm-navy/8 px-3 py-3 align-middle dark:border-white/8">
                  <div
                    className="grid min-w-0 gap-0.5"
                    style={{ paddingLeft: `${Math.min(Math.max(page.level, 0), 4) * 14}px` }}
                  >
                    <button
                      type="button"
                      onClick={() => props.onOpen(page)}
                      className="w-fit text-left font-semibold text-sbkm-navy underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 dark:text-white"
                    >
                      {page.name}
                    </button>
                    {page.main_keyword ? (
                      <span className="truncate text-xs text-sbkm-ink-500 dark:text-white/45">
                        {page.main_keyword}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="border-b border-sbkm-navy/8 px-3 py-3 align-middle dark:border-white/8">
                  <div className="grid gap-1">
                    <DtContentStatusBadge state={page.state} released={page.released} className="w-fit" />
                    {page.detail && (page.state === "laeuft" || needsYou || page.state === "in_arbeit") ? (
                      <span
                        className={cn(
                          "text-xs",
                          needsYou
                            ? "font-semibold text-orange-700 dark:text-orange-300"
                            : "text-sbkm-ink-600 dark:text-white/60",
                        )}
                      >
                        {page.detail}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="border-b border-sbkm-navy/8 px-3 py-3 text-right align-middle tabular-nums text-sbkm-ink-600 dark:border-white/8 dark:text-white/70">
                  {page.cost_eur > 0 ? page.cost : "—"}
                </td>
                <td className="border-b border-sbkm-navy/8 px-3 py-3 text-right align-middle tabular-nums dark:border-white/8">
                  {page.questions > 0 ? (
                    <span className="inline-flex min-w-6 justify-center rounded-pill bg-orange-100 px-2 py-0.5 text-xs font-bold text-orange-800 dark:bg-orange-500/15 dark:text-orange-200">
                      {page.questions}
                    </span>
                  ) : (
                    <span className="text-sbkm-ink-500 dark:text-white/40">0</span>
                  )}
                </td>
                <td className="whitespace-nowrap border-b border-sbkm-navy/8 px-3 py-3 align-middle text-xs text-sbkm-ink-600 dark:border-white/8 dark:text-white/60">
                  {formatContentDate(page.updated_at)}
                </td>
                <td className="border-b border-sbkm-navy/8 px-3 py-3 text-right align-middle dark:border-white/8">
                  <button
                    type="button"
                    onClick={() => props.onOpen(page)}
                    className="inline-flex h-8 items-center gap-1 rounded-pill px-3 text-xs font-semibold text-sbkm-navy transition-colors hover:bg-sbkm-navy/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 dark:text-white dark:hover:bg-white/10"
                  >
                    Öffnen
                    <ArrowRight className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
