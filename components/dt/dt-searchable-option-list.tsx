"use client";

import { useMemo, useState } from "react";
import { Check, ClipboardList, Search } from "lucide-react";

import { cn } from "@/components/dt/cn";

export type DtSearchableOption = {
  value: string;
  label: string;
  description?: string;
  keywords?: string;
};

export function DtSearchableOptionList(props: {
  options: DtSearchableOption[];
  value: string;
  onValueChange: (value: string) => void;
  label?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  noResultsMessage?: string;
  loading?: boolean;
  disabled?: boolean;
  maxListHeight?: string;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return props.options;
    return props.options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.description?.toLowerCase().includes(q) ||
        o.keywords?.toLowerCase().includes(q),
    );
  }, [props.options, query]);

  const maxHeight = props.maxListHeight ?? "max-h-52";

  return (
    <div className="grid min-w-0 gap-2">
      {props.label ? (
        <span className="text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/50">
          {props.label}
        </span>
      ) : null}

      {props.loading ? (
        <div className="grid gap-2" aria-busy="true" aria-label="Optionen werden geladen">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-xl border border-sbkm-navy/8 bg-sbkm-navy/5 dark:border-white/8 dark:bg-white/5"
            />
          ))}
        </div>
      ) : props.options.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-sbkm-navy/15 px-4 py-8 text-center dark:border-white/15">
          <ClipboardList className="size-8 text-sbkm-ink-400 dark:text-white/30" aria-hidden />
          <p className="text-sm text-sbkm-ink-600 dark:text-white/55">
            {props.emptyMessage ?? "Keine Einträge verfügbar."}
          </p>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-sbkm-ink-400 dark:text-white/40"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              disabled={props.disabled}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={props.searchPlaceholder ?? "Suchen …"}
              className="h-10 w-full rounded-pill border border-sbkm-navy/15 bg-white/80 py-2 pl-9 pr-3 text-sm text-sbkm-navy outline-none transition duration-150 placeholder:text-sbkm-ink-400 focus-visible:border-sbkm-mint/45 focus-visible:ring-2 focus-visible:ring-sbkm-mint/30 dark:border-white/15 dark:bg-white/5 dark:text-white dark:placeholder:text-white/35"
            />
          </div>

          <div
            className={cn(
              "min-h-[8rem] overflow-hidden rounded-xl border border-sbkm-navy/10 bg-white/40 dark:border-white/10 dark:bg-white/[0.05]",
              "before:pointer-events-none before:block before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/30 before:to-transparent dark:before:via-white/10",
            )}
          >
            <ul
              role="listbox"
              aria-label={props.label ?? "Auswahl"}
              className={cn("scrollbar-subtle overflow-y-auto overscroll-contain p-1.5", maxHeight)}
            >
              {filtered.length === 0 ? (
                <li className="px-3 py-6 text-center text-sm text-sbkm-ink-600 dark:text-white/55">
                  {props.noResultsMessage ?? "Keine Treffer für deine Suche."}
                </li>
              ) : (
                filtered.map((opt) => {
                  const selected = opt.value === props.value;
                  return (
                    <li key={opt.value}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        disabled={props.disabled}
                        onClick={() => props.onValueChange(opt.value)}
                        className={cn(
                          "flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors duration-150",
                          "hover:bg-sbkm-mint/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/40",
                          "dark:hover:bg-white/8",
                          selected &&
                            "bg-sbkm-mint/15 ring-1 ring-sbkm-mint/25 dark:bg-sbkm-mint/20 dark:ring-sbkm-mint/30",
                          props.disabled && "cursor-not-allowed opacity-50",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold leading-snug text-sbkm-navy dark:text-white">
                            {opt.label}
                          </span>
                          {opt.description ? (
                            <span className="mt-0.5 block text-xs text-sbkm-ink-600 dark:text-white/50">
                              {opt.description}
                            </span>
                          ) : null}
                        </span>
                        {selected ? (
                          <Check className="mt-0.5 size-4 shrink-0 text-sbkm-mint" aria-hidden />
                        ) : (
                          <span className="mt-0.5 size-4 shrink-0" aria-hidden />
                        )}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>

          <p className="text-xs tabular-nums text-sbkm-ink-500 dark:text-white/40">
            {filtered.length} von {props.options.length}{" "}
            {props.options.length === 1 ? "Umfrage" : "Umfragen"}
            {query.trim() ? " (gefiltert)" : ""}
          </p>
        </>
      )}
    </div>
  );
}
