"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Download, KeyRound, Loader2, Pencil, Search } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/components/dt/cn";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { contentApi } from "@/components/dt/content/content-api";
import { describeKeywordConflict, findKeywordConflicts, type KeywordConflict } from "@/lib/dt/content/keyword-compare";
import { contentKeywordOriginLabel, type ContentPageSummary } from "@/lib/dt/content/types";

const cardClass =
  "relative overflow-hidden rounded-dt-lg border border-sbkm-navy/10 bg-white/55 shadow-dt backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.05]";

/** What a page's keywords are, for the filter and the badge: one status per page. */
export type KeywordStatus = "fehlt" | "auffaellig" | "einteilen" | "struktur" | "analyse" | "manuell" | "lauf" | "ohne" | "kein_text";

export function keywordStatus(page: Pick<ContentPageSummary, "keyword_source" | "keyword_todo">): KeywordStatus {
  if (page.keyword_todo === "einteilen") return "einteilen";
  // The Seitenstruktur's entry is no keyword (a column header …): the page has none that counts.
  if (page.keyword_todo === "suchen" && page.keyword_source === "struktur") return "auffaellig";
  if (page.keyword_todo === "suchen") return page.keyword_source === "lauf" ? "lauf" : "fehlt";
  if (page.keyword_source) return page.keyword_source;
  return "kein_text";
}

const STATUS_LABELS: Record<KeywordStatus, string> = {
  fehlt: "Ohne Keywords",
  auffaellig: "Auffälliges Keyword aus der Seitenstruktur",
  einteilen: "Noch nicht eingeteilt",
  struktur: "Aus der Seitenstruktur",
  analyse: "Vorschlag des Zwillings",
  manuell: "Von Hand",
  lauf: "Nur Hauptkeyword aus dem Textlauf",
  ohne: "Kein Suchziel",
  kein_text: "Bekommt keinen Text",
};

type OverviewFilter = "alle" | KeywordStatus | "doppelt";

const FILTERS: Array<{ key: OverviewFilter; label: string; warn?: boolean }> = [
  { key: "alle", label: "Alle" },
  { key: "doppelt", label: "Doppelt oder ähnlich", warn: true },
  { key: "fehlt", label: STATUS_LABELS.fehlt, warn: true },
  { key: "auffaellig", label: "Auffällig", warn: true },
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
export function keywordsCsv(pages: readonly ContentPageSummary[], conflicts: ReadonlyMap<string, readonly KeywordConflict[]> = new Map()): string {
  const rows = [["Seite", "Pfad", "Hauptkeyword", "Nebenkeywords", "Status", "Herkunft", "Hinweis", "Konflikt"]];
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
      (conflicts.get(p.slug) ?? []).map(describeKeywordConflict).join(" | "),
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
export function DtContentKeywordsOverview(props: {
  organisationId: string;
  pages: readonly ContentPageSummary[];
  onOpen: (page: ContentPageSummary) => void;
  /** After a keyword was changed here: the workspace reloads its overview. */
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<OverviewFilter>("alle");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ slug: string; main: string; secondary: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const counts = useMemo(() => {
    const out = new Map<KeywordStatus, number>();
    for (const p of props.pages) out.set(keywordStatus(p), (out.get(keywordStatus(p)) ?? 0) + 1);
    return out;
  }, [props.pages]);
  // Pages that compete with another page for a keyword: the same or a very similar main keyword,
  // or a main keyword that another page carries as a Nebenkeyword (duplicate content, cannibalisation).
  const conflicts = useMemo(
    () => findKeywordConflicts(props.pages.map((p) => ({ slug: p.slug, name: p.name, main: p.main_keyword, secondary: p.secondary_keywords }))),
    [props.pages],
  );
  const mainClashes = useMemo(() => [...conflicts.values()].filter((list) => list.some((c) => c.kind === "haupt_haupt")).length, [conflicts]);
  const open_ = (counts.get("fehlt") ?? 0) + (counts.get("auffaellig") ?? 0) + (counts.get("einteilen") ?? 0) + (counts.get("lauf") ?? 0);

  async function save() {
    if (!editing) return;
    setSaving(true);
    const res = await contentApi(`/api/dt/content/pages/${encodeURIComponent(editing.slug)}`, {
      method: "PATCH",
      body: {
        organisationId: props.organisationId,
        keywords: { main: editing.main, secondary: editing.secondary.split(/[\n,;]+/).map((k) => k.trim()).filter(Boolean) },
      },
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message, { duration: 12_000 });
      return;
    }
    toast.success(editing.main.trim() ? "Keywords gespeichert – gilt ab dem nächsten Schritt." : "Keywords entfernt.");
    setEditing(null);
    props.onChanged();
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return props.pages.filter((p) => {
      if (filter === "doppelt" ? !conflicts.has(p.slug) : filter !== "alle" && keywordStatus(p) !== filter) return false;
      if (!q) return true;
      return [p.name, p.path ?? "", p.main_keyword ?? "", ...p.secondary_keywords].some((t) => t.toLowerCase().includes(q));
    });
  }, [props.pages, filter, query, conflicts]);

  function download() {
    const blob = new Blob([keywordsCsv(visible, conflicts)], { type: "text/csv;charset=utf-8" });
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
          {conflicts.size > 0 ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 dark:text-red-300">
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
              {conflicts.size} {conflicts.size === 1 ? "Seite" : "Seiten"} mit doppelten oder ähnlichen Keywords
            </span>
          ) : null}
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-sbkm-ink-500 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <div className="grid gap-3 border-t border-sbkm-navy/8 px-4 py-4 dark:border-white/8 sm:px-5">
          {conflicts.size > 0 ? (
            <p className="rounded-dt border border-red-300/60 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-900 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">
              {mainClashes > 0 ? `${mainClashes} ${mainClashes === 1 ? "Seite hat" : "Seiten haben"} dasselbe oder ein sehr ähnliches Hauptkeyword wie eine andere Seite. ` : ""}
              Seiten, die auf dasselbe Keyword zielen, konkurrieren miteinander und führen leicht zu doppeltem Inhalt. Bitte pro Keyword eine Seite festlegen: Filter „Doppelt oder ähnlich“, dann bei einer der Seiten mit „Ändern“ ein spezifischeres Hauptkeyword eintragen. Verglichen wird unabhängig von Schreibweise, Wortstellung und Getrennt-/Zusammenschreibung.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.filter((f) => f.key === "alle" || (f.key === "doppelt" ? conflicts.size > 0 : (counts.get(f.key) ?? 0) > 0)).map((f) => {
              const n = f.key === "alle" ? props.pages.length : f.key === "doppelt" ? conflicts.size : (counts.get(f.key) ?? 0);
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
                    const warn = status === "fehlt" || status === "auffaellig" || status === "einteilen" || status === "lauf";
                    const pageConflicts = conflicts.get(p.slug) ?? [];
                    const isEditing = editing?.slug === p.slug;
                    return (
                      <tr key={p.slug} className="border-t border-sbkm-navy/8 align-top dark:border-white/8">
                        <td className="px-3 py-2.5">
                          <button type="button" className="text-left font-semibold text-sbkm-navy hover:underline dark:text-white" onClick={() => props.onOpen(p)}>
                            {p.name}
                          </button>
                          {p.path ? <div className="truncate font-mono text-[11px] text-sbkm-ink-500 dark:text-white/40">{p.path}</div> : null}
                          {!isEditing ? (
                            <button
                              type="button"
                              className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-sbkm-ink-600 hover:text-sbkm-navy dark:text-white/60 dark:hover:text-white"
                              onClick={() => setEditing({ slug: p.slug, main: p.main_keyword ?? "", secondary: p.secondary_keywords.join("\n") })}
                            >
                              <Pencil className="size-3" aria-hidden />
                              Ändern
                            </button>
                          ) : null}
                        </td>
                        {isEditing && editing ? (
                          <td colSpan={2} className="px-3 py-2.5">
                            <div className="grid gap-1.5">
                              <label className="text-[11px] text-sbkm-ink-600 dark:text-white/60" htmlFor={`kw-main-${p.slug}`}>
                                Hauptkeyword (leer lassen = Keywords entfernen)
                              </label>
                              <input
                                id={`kw-main-${p.slug}`}
                                type="text"
                                value={editing.main}
                                maxLength={120}
                                disabled={saving}
                                onChange={(e) => setEditing({ ...editing, main: e.target.value })}
                                className="h-8 w-full rounded-dt border border-sbkm-navy/15 bg-white/80 px-2.5 text-xs text-sbkm-navy outline-none focus-visible:border-sbkm-mint/40 focus-visible:ring-2 focus-visible:ring-sbkm-mint/30 dark:border-white/15 dark:bg-white/10 dark:text-white"
                              />
                              <label className="text-[11px] text-sbkm-ink-600 dark:text-white/60" htmlFor={`kw-secondary-${p.slug}`}>
                                Nebenkeywords, eines pro Zeile
                              </label>
                              <textarea
                                id={`kw-secondary-${p.slug}`}
                                value={editing.secondary}
                                disabled={saving}
                                onChange={(e) => setEditing({ ...editing, secondary: e.target.value })}
                                className="min-h-[72px] w-full resize-y rounded-dt border border-sbkm-navy/15 bg-white/80 px-2.5 py-1.5 text-xs text-sbkm-navy outline-none focus-visible:border-sbkm-mint/40 focus-visible:ring-2 focus-visible:ring-sbkm-mint/30 dark:border-white/15 dark:bg-white/10 dark:text-white"
                              />
                              <div className="flex flex-wrap items-center gap-2">
                                <DtPillButton type="button" size="sm" className="h-7 px-3 text-xs" disabled={saving} onClick={() => void save()}>
                                  {saving ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
                                  Speichern
                                </DtPillButton>
                                <DtPillButton type="button" size="sm" variant="ghost" className="h-7 px-3 text-xs" disabled={saving} onClick={() => setEditing(null)}>
                                  Abbrechen
                                </DtPillButton>
                                <span className="text-[11px] text-sbkm-ink-500 dark:text-white/45">Gilt ab dem nächsten Schritt. Ein Hauptkeyword gibt es nur einmal.</span>
                              </div>
                            </div>
                          </td>
                        ) : (
                          <>
                            <td className="px-3 py-2.5 text-sbkm-navy dark:text-white">{p.main_keyword ?? <span className="text-sbkm-ink-500 dark:text-white/40">–</span>}</td>
                            <td className="max-w-[22rem] px-3 py-2.5 text-sbkm-ink-600 dark:text-white/65" title={p.secondary_keywords.join(", ")}>
                              {p.secondary_keywords.length > 0 ? p.secondary_keywords.join(", ") : <span className="text-sbkm-ink-500 dark:text-white/40">–</span>}
                            </td>
                          </>
                        )}
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
                          {pageConflicts.slice(0, 4).map((c, i) => (
                            <div key={i} className="mt-0.5 flex max-w-[20rem] items-start gap-1 text-[11px] font-medium leading-snug text-red-700 dark:text-red-300">
                              <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
                              {describeKeywordConflict(c)}
                            </div>
                          ))}
                          {pageConflicts.length > 4 ? <div className="mt-0.5 text-[11px] text-red-700 dark:text-red-300">… und {pageConflicts.length - 4} weitere</div> : null}
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
