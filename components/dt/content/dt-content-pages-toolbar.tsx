"use client";

import { Search, X } from "lucide-react";

import { cn } from "@/components/dt/cn";
import { DtInput, DtInputWrap } from "@/components/dt/dt-field";
import {
  CONTENT_STATE_META,
  EMPTY_CONTENT_PAGE_FILTER,
  countContentPagesByState,
  isContentPageFilterActive,
  type ContentPageFilter,
  type ContentStateTone,
} from "@/lib/dt/content/presentation";
import type { ContentPageState, ContentPageSummary } from "@/lib/dt/content/types";

const STATE_ORDER: ContentPageState[] = ["nicht_begonnen", "laeuft", "in_arbeit", "braucht_sie", "fertig"];

const chipOn: Record<ContentStateTone, string> = {
  grey: "border-sbkm-navy bg-sbkm-navy text-white dark:border-white/70 dark:bg-white/20 dark:text-white",
  blue: "border-sky-600 bg-sky-100 text-sky-900 dark:border-sky-400/60 dark:bg-sky-500/20 dark:text-sky-100",
  yellow: "border-yellow-600 bg-yellow-100 text-yellow-900 dark:border-yellow-400/60 dark:bg-yellow-400/20 dark:text-yellow-100",
  orange: "border-orange-500 bg-orange-500 text-white dark:border-orange-400 dark:bg-orange-500",
  green: "border-emerald-600 bg-emerald-100 text-emerald-900 dark:border-emerald-400/60 dark:bg-emerald-500/20 dark:text-emerald-100",
};

const chipOff =
  "border-sbkm-navy/15 bg-white/60 text-sbkm-ink-600 hover:border-sbkm-navy/40 hover:text-sbkm-navy dark:border-white/15 dark:bg-white/[0.04] dark:text-white/60 dark:hover:border-white/40 dark:hover:text-white";

/**
 * Search (name, path, live URL, keyword) and a multi-select status filter for the pages table.
 * Pure client-side: the overview already holds every page of the organisation.
 */
export function DtContentPagesToolbar(props: {
  pages: ContentPageSummary[];
  visibleCount: number;
  filter: ContentPageFilter;
  onChange: (next: ContentPageFilter) => void;
}) {
  const { filter, onChange } = props;
  const counts = countContentPagesByState(props.pages);
  const active = isContentPageFilterActive(filter);
  const total = props.pages.length;

  function toggleState(state: ContentPageState) {
    const states = filter.states.includes(state)
      ? filter.states.filter((s) => s !== state)
      : [...filter.states, state];
    onChange({ ...filter, states });
  }

  return (
    <div className="flex flex-col gap-2.5 border-b border-sbkm-navy/8 px-4 py-3 dark:border-white/8 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
      <DtInputWrap
        icon={<Search className="size-4" aria-hidden />}
        className="lg:w-80"
        trailing={
          filter.query ? (
            <button
              type="button"
              onClick={() => onChange({ ...filter, query: "" })}
              className="mr-2 inline-flex size-7 items-center justify-center rounded-md text-sbkm-ink-500 hover:bg-sbkm-navy/[0.06] hover:text-sbkm-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 dark:hover:bg-white/10 dark:hover:text-white"
              aria-label="Suche leeren"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          ) : null
        }
      >
        <DtInput
          type="search"
          value={filter.query}
          onChange={(event) => onChange({ ...filter, query: event.target.value })}
          placeholder="Seite oder Link suchen …"
          aria-label="Seiten nach Name oder Link durchsuchen"
          autoComplete="off"
          className="py-2"
        />
      </DtInputWrap>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Nach Status filtern">
        {STATE_ORDER.map((state) => {
          const on = filter.states.includes(state);
          const n = counts[state];
          return (
            <button
              key={state}
              type="button"
              aria-pressed={on}
              disabled={n === 0 && !on}
              onClick={() => toggleState(state)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-[11px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 disabled:cursor-not-allowed disabled:opacity-40",
                on ? chipOn[CONTENT_STATE_META[state].tone] : chipOff,
              )}
              title={on ? "Status abwählen" : "Nur Seiten mit diesem Status zeigen (mehrere kombinierbar)"}
            >
              {CONTENT_STATE_META[state].label}
              <span className="tabular-nums opacity-70">{n}</span>
            </button>
          );
        })}
        <span className="ml-1 text-xs tabular-nums text-sbkm-ink-500 dark:text-white/45">
          {active ? `${props.visibleCount} von ${total}` : total} {total === 1 ? "Seite" : "Seiten"}
        </span>
        {active ? (
          <button
            type="button"
            onClick={() => onChange(EMPTY_CONTENT_PAGE_FILTER)}
            className="ml-1 text-xs font-semibold text-sbkm-navy underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 dark:text-sbkm-mint"
          >
            Filter zurücksetzen
          </button>
        ) : null}
      </div>
    </div>
  );
}
