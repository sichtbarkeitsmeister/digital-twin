"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Download, KeyRound, Search } from "lucide-react";

import { cn } from "@/components/dt/cn";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { contentKeywordOriginLabel, type ContentPageSummary } from "@/lib/dt/content/types";

const cardClass =
  "relative overflow-hidden rounded-dt-lg border border-sbkm-navy/10 bg-white/55 shadow-dt backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.05]";

/** What a page's keywords are, for the filter and the badge: one status per page. */
export type KeywordStatus = "fehlt" | "einteilen" | "struktur" | "analyse" | "manuell" | "lauf" | "ohne" | "kein_text";

export function keywordStatus(page: Pick<ContentPageSummary, "keyword_source" | "keyword_todo">): KeywordStatus {
  if (page.keyword_todo === "einteilen") return "einteilen";
  if (page.keyword_todo === "suchen") return page.keyword_source === "lauf" ? "lauf" : "fehlt";
  if (page.keyword_source) return page.keyword_source;
  return "kein_text";
}

const STATUS_LABELS: Record<KeywordStatus, string> = {
  fehlt: "Ohne Keywords",
  einteilen: "Noch nicht eingeteilt",
  struktur: "Aus der Seitenstruktur",
  analyse: "Vorschlag des Zwillings",
  manuell: "Von Hand",
  lauf: "Nur Hauptkeyword aus dem Textlauf",
  ohne: "Kein Suchziel",
  kein_text: "Bekommt keinen Text",
};

const FILTERS: Array<{ key: "alle" | KeywordStatus; label: string; warn?: boolean }> = [
  { key: "alle", label: "Alle" },
  { key: "fehlt", label: STATUS_LABELS.fehlt, warn: true },
  { key: "einteilen", label: STATUS_LABELS.einteilen, warn: true },
  { key: "lauf", label: "Nur Hauptkeyword", warn: true },
  { key: "struktur", label: STATUS_LABELS.struktur },
  { key: "analyse", label: STATUS_LABELS.analyse },
  { key: "manuell", label: STATUS_LABELS.manuell },
  { key: "ohne", label: STATUS_LABELS.ohne },
  { key: "kein_text", label: "Ohne Text" },
];

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** The table as CSV (semicolon and BOM, so German Excel opens it right). */
export function keywordsCsv(pages: readonly ContentPageSummary[]): string {
  const rows = [["Seite", "Pfad", "Hauptkeyword", "Nebenkeywords", "Status", "Herkunft", "Hinweis"]];
  for (const p of pages) {
    const status = keywordStatus(p);
    rows.push([
      p.name,
      p.path ?? p.source_url ?? "",
      p.main_keyword ?? "",
      p.secondary_keywords.join(", "),
      STATUS_LABELS[status],
      p.keyword_source ? contentKeywordOriginLabel(p.keyword_source, p.keyword_sorted) : "",
      p.keyword_note ?? "",
    ]);
  }
  return `﻿${rows.map((r) => r.map(csvCell).join(";")).join("\r\n")}`;
}

/**
 * „Keywords-Übersicht“: every page with its Hauptkeyword, Nebenkeywords and where they come from
 * (Seitenstruktur, Vorschlag des Zwillings, von Hand), and which pages still have none or a list
 * without main/secondary assignment. Pages without a search goal (Kontakt, Impressum …) say why.
 * Reads the overview the workspace already has: no request of its own.
 */
export function DtContentKeywordsOverview(props: { pages: readonly ContentPageSummary[]; onOpen: (page: ContentPageSummary) => void }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"alle" | KeywordStatus>("alle");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    const out = new Map<KeywordStatus, number>();
    for (const p of props.pages) out.set(keywordStatus(p), (out.get(keywordStatus(p)) ?? 0) + 1);
    return out;
  }, [props.pages]);
  const open_ = (counts.get("fehlt") ?? 0) + (counts.get("einteilen") ?? 0) + (counts.get("lauf") ?? 0);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return props.pages.filter((p) => {
      if (filter !== "alle" && keywordStatus(p) !== filter) return false;
      if (!q) return true;
      return [p.name, p.path ?? "", p.main_keyword ?? "", ...p.secondary_keywords].some((t) => t.toLowerCase().includes(q));
    });
  }, [props.pages, filter, query]);

  function download() {
    const blob = new Blob([keywordsCsv(visible)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "keywords-uebersicht.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className={cardClass} aria-label="Keywords-Übersicht">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left sm:px-5"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <KeyRound className="size-4 shrink-0 text-sbkm-mint" aria-hidden />
          <span className="text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">Keywords-Übersicht</span>
          <span className="text-xs text-sbkm-ink-600 dark:text-white/60">
            {props.pages.length === 0
              ? "noch keine Seiten"
              : `${props.pages.length - open_} von ${props.pages.length} Seiten fertig`}
          </span>
          {open_ > 0 ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-orange-700 dark:text-orange-300">
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
              {open_} offen
            </span>
          ) : null}
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-sbkm-ink-500 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <div className="grid gap-3 border-t border-sbkm-navy/8 px-4 py-4 dark:border-white/8 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.filter((f) => f.key === "alle" || (counts.get(f.key) ?? 0) > 0).map((f) => {
              const n = f.key === "alle" ? props.pages.length : (counts.get(f.key) ?? 0);
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  aria-pressed={active}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition",
                    active
                      ? "border-sbkm-navy bg-sbkm-navy text-white dark:border-white dark:bg-white dark:text-sbkm-navy"
                      : f.warn
                        ? "border-orange-300/70 bg-orange-50 text-orange-800 dark:border-orange-400/40 dark:bg-orange-400/10 dark:text-orange-200"
                        : "border-sbkm-navy/12 text-sbkm-ink-600 hover:border-sbkm-navy/30 dark:border-white/15 dark:text-white/65",
                  )}
                >
                  {f.label} ({n})
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-[14rem] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-sbkm-ink-500" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Seite oder Keyword suchen …"
                aria-label="Keywords durchsuchen"
                className="h-8 w-full rounded-dt border border-sbkm-navy/15 bg-white/80 pl-8 pr-3 text-xs text-sbkm-navy outline-none focus-visible:border-sbkm-mint/40 focus-visible:ring-2 focus-visible:ring-sbkm-mint/30 dark:border-white/15 dark:bg-white/10 dark:text-white"
              />
            </label>
            <DtPillButton type="button" size="sm" variant="outline" className="h-8 px-3 text-xs" onClick={download} disabled={visible.length === 0}>
              <Download className="size-3.5" aria-hidden />
              Als CSV ({visible.length})
            </DtPillButton>
          </div>
          <div className="overflow-x-auto rounded-dt border border-sbkm-navy/8 dark:border-white/10">
            <table className="w-full min-w-[46rem] border-collapse text-left text-xs">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-sbkm-ink-500 dark:text-white/45">
                  <th className="px-3 py-2 font-semibold">Seite</th>
                  <th className="px-3 py-2 font-semibold">Hauptkeyword</th>
                  <th className="px-3 py-2 font-semibold">Nebenkeywords</th>
                  <th className="px-3 py-2 font-semibold">Herkunft</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-sbkm-ink-600 dark:text-white/60">
                      Keine Seite passt zum Filter.
                    </td>
                  </tr>
                ) : (
                  visible.map((p) => {
                    const status = keywordStatus(p);
                    const warn = status === "fehlt" || status === "einteilen" || status === "lauf";
                    return (
                      <tr key={p.slug} className="border-t border-sbkm-navy/8 align-top dark:border-white/8">
                        <td className="px-3 py-2.5">
                          <button type="button" className="text-left font-semibold text-sbkm-navy hover:underline dark:text-white" onClick={() => props.onOpen(p)}>
                            {p.name}
                          </button>
                          {p.path ? <div className="truncate font-mono text-[11px] text-sbkm-ink-500 dark:text-white/40">{p.path}</div> : null}
                        </td>
                        <td className="px-3 py-2.5 text-sbkm-navy dark:text-white">{p.main_keyword ?? <span className="text-sbkm-ink-500 dark:text-white/40">–</span>}</td>
                        <td className="max-w-[22rem] px-3 py-2.5 text-sbkm-ink-600 dark:text-white/65" title={p.secondary_keywords.join(", ")}>
                          {p.secondary_keywords.length > 0 ? p.secondary_keywords.join(", ") : <span className="text-sbkm-ink-500 dark:text-white/40">–</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 font-medium",
                              warn ? "text-orange-700 dark:text-orange-300" : "text-sbkm-ink-600 dark:text-white/65",
                            )}
                          >
                            {warn ? <AlertTriangle className="size-3 shrink-0" aria-hidden /> : null}
                            {warn || status === "ohne" || status === "kein_text"
                              ? STATUS_LABELS[status]
                              : p.keyword_source
                                ? contentKeywordOriginLabel(p.keyword_source, p.keyword_sorted)
                                : STATUS_LABELS[status]}
                          </span>
                          {p.keyword_note ? <div className="mt-0.5 max-w-[20rem] text-[11px] leading-snug text-sbkm-ink-500 dark:text-white/45">{p.keyword_note}</div> : null}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
