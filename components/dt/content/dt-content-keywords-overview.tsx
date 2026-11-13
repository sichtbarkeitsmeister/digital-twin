"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Download, KeyRound, Link2, Loader2, Search } from "lucide-react";
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

type OverviewFilter = "alle" | KeywordStatus | "doppelt" | "verlinkung";

const FILTERS: Array<{ key: OverviewFilter; label: string; warn?: boolean }> = [
  { key: "alle", label: "Alle" },
  { key: "doppelt", label: "Gleiches Hauptkeyword", warn: true },
  { key: "fehlt", label: STATUS_LABELS.fehlt, warn: true },
  { key: "auffaellig", label: "Auffällig", warn: true },
  { key: "einteilen", label: STATUS_LABELS.einteilen, warn: true },
  { key: "lauf", label: "Nur Hauptkeyword", warn: true },
  { key: "struktur", label: STATUS_LABELS.struktur },
  { key: "analyse", label: STATUS_LABELS.analyse },
  { key: "manuell", label: STATUS_LABELS.manuell },
  { key: "ohne", label: STATUS_LABELS.ohne },
  { key: "kein_text", label: "Ohne Text" },
  { key: "verlinkung", label: "Verlinkung möglich" },
];

/** The Nebenkeywords as typed (one per line, commas and semicolons also separate) → clean lines. */
export function normalizeKeywordLines(text: string): string[] {
  return text.split(/[\n,;]+/).map((k) => k.trim()).filter(Boolean);
}

type Draft = { main: string; secondary: string };

function withoutKey(drafts: Record<string, Draft>, key: string): Record<string, Draft> {
  const next = { ...drafts };
  delete next[key];
  return next;
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** The table as CSV (semicolon and BOM, so German Excel opens it right). */
export function keywordsCsv(
  pages: readonly ContentPageSummary[],
  conflicts: ReadonlyMap<string, readonly KeywordConflict[]> = new Map(),
): string {
  // Konflikt: the same main keyword on two pages. Verlinkung: a main keyword that another page carries as a Nebenkeyword (fine, they link).
  const rows = [["Seite", "Pfad", "Hauptkeyword", "Nebenkeywords", "Status", "Herkunft", "Hinweis", "Konflikt", "Verlinkung möglich"]];
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
      (conflicts.get(p.slug) ?? []).filter((c) => c.kind === "haupt_haupt").map(describeKeywordConflict).join(" | "),
      (conflicts.get(p.slug) ?? []).filter((c) => c.kind !== "haupt_haupt").map(describeKeywordConflict).join(" | "),
    ]);
  }
  return `﻿${rows.map((r) => r.map(csvCell).join(";")).join("\r\n")}`;
}

/**
 * „Keywords-Übersicht“: every page with its Hauptkeyword, Nebenkeywords and where they come from
 * (Seitenstruktur, Vorschlag des Zwillings, von Hand), and which pages still have none or a list
 * without main/secondary assignment. Pages without a search goal (Kontakt, Impressum …) say why.
 *
 * Only the same main keyword on two pages is a conflict (red; orange when only very similar): they
 * compete and lead to duplicate content. A main keyword that another page carries as a Nebenkeyword
 * is fine, the pages link to each other with it; it is marked in blue as a hint, not as a problem.
 *
 * Main and Nebenkeywords are fields in the table: click in, type, leave the field (or Enter,
 * Ctrl+Enter in the Nebenkeywords) and it is saved; Escape takes the change back.
 * Reads the overview the workspace already has: no request of its own besides saving.
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
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  // What was saved last, until the reloaded overview shows it: a field typed right after a save must not
  // start from the old values still in `props.pages` (that would send the old main keyword along).
  const [saved, setSaved] = useState<Record<string, Draft>>({});
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  const counts = useMemo(() => {
    const out = new Map<KeywordStatus, number>();
    for (const p of props.pages) out.set(keywordStatus(p), (out.get(keywordStatus(p)) ?? 0) + 1);
    return out;
  }, [props.pages]);
  const { clashes, overlaps } = useMemo(() => {
    const all = findKeywordConflicts(props.pages.map((p) => ({ slug: p.slug, name: p.name, main: p.main_keyword, secondary: p.secondary_keywords })));
    const clash = new Map<string, KeywordConflict[]>();
    const overlap = new Map<string, KeywordConflict[]>();
    for (const [slug, list] of all) {
      const c = list.filter((x) => x.kind === "haupt_haupt");
      const o = list.filter((x) => x.kind !== "haupt_haupt");
      if (c.length > 0) clash.set(slug, c);
      if (o.length > 0) overlap.set(slug, o);
    }
    return { clashes: clash, overlaps: overlap };
  }, [props.pages]);
  const allConflicts = useMemo(() => {
    const out = new Map<string, readonly KeywordConflict[]>();
    for (const p of props.pages) {
      const list = [...(clashes.get(p.slug) ?? []), ...(overlaps.get(p.slug) ?? [])];
      if (list.length > 0) out.set(p.slug, list);
    }
    return out;
  }, [props.pages, clashes, overlaps]);
  const open_ = (counts.get("fehlt") ?? 0) + (counts.get("auffaellig") ?? 0) + (counts.get("einteilen") ?? 0) + (counts.get("lauf") ?? 0);

  const stored = (p: ContentPageSummary): Draft => saved[p.slug] ?? { main: p.main_keyword ?? "", secondary: p.secondary_keywords.join("\n") };
  const valueOf = (p: ContentPageSummary): Draft => drafts[p.slug] ?? stored(p);
  const isDirty = (p: ContentPageSummary, d: Draft) => {
    const base = stored(p);
    return d.main.trim() !== base.main.trim() || normalizeKeywordLines(d.secondary).join("\n") !== normalizeKeywordLines(base.secondary).join("\n");
  };

  // The reloaded overview shows what was saved: the remembered values are no longer needed.
  useEffect(() => {
    setSaved((prev) => {
      const keys = Object.keys(prev);
      if (keys.length === 0) return prev;
      const next: Record<string, Draft> = {};
      for (const slug of keys) {
        const p = props.pages.find((x) => x.slug === slug);
        const d = prev[slug]!;
        const shown = p ? { main: p.main_keyword ?? "", secondary: p.secondary_keywords.join("\n") } : null;
        if (!shown || shown.main.trim() !== d.main.trim() || normalizeKeywordLines(shown.secondary).join("\n") !== normalizeKeywordLines(d.secondary).join("\n")) next[slug] = d;
      }
      return Object.keys(next).length === keys.length ? prev : next;
    });
  }, [props.pages]);

  function revert(slug: string) {
    // The ref first: the blur that follows Escape reads it before React has rendered the new state.
    draftsRef.current = withoutKey(draftsRef.current, slug);
    setDrafts((d) => withoutKey(d, slug));
    setFailed((f) => new Set([...f].filter((x) => x !== slug)));
  }

  /** Leaving a field: saves the page's keywords when they changed. A change typed during a save is saved right after it. */
  async function commit(p: ContentPageSummary) {
    const snapshot = draftsRef.current[p.slug];
    if (!snapshot || !isDirty(p, snapshot) || saving.has(p.slug)) return;
    setSaving((s) => new Set(s).add(p.slug));
    const res = await contentApi(`/api/dt/content/pages/${encodeURIComponent(p.slug)}`, {
      method: "PATCH",
      body: { organisationId: props.organisationId, keywords: { main: snapshot.main, secondary: normalizeKeywordLines(snapshot.secondary) } },
    });
    setSaving((s) => new Set([...s].filter((x) => x !== p.slug)));
    if (!res.ok) {
      setFailed((f) => new Set(f).add(p.slug));
      toast.error(res.message, { duration: 12_000 });
      return;
    }
    setFailed((f) => new Set([...f].filter((x) => x !== p.slug)));
    setSaved((s) => ({ ...s, [p.slug]: snapshot }));
    window.setTimeout(() => setSaved((s) => withoutKey(s, p.slug)), 20_000);
    // Only what was saved leaves the drafts; text typed meanwhile stays.
    setDrafts((d) => {
      const now = d[p.slug];
      return now && now.main === snapshot.main && now.secondary === snapshot.secondary ? withoutKey(d, p.slug) : d;
    });
    props.onChanged();
    // Typed while this save ran (its blur found the save busy): save that now.
    const rest = draftsRef.current[p.slug];
    if (rest && (rest.main !== snapshot.main || rest.secondary !== snapshot.secondary)) window.setTimeout(() => void commit(p), 0);
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return props.pages.filter((p) => {
      if (filter === "doppelt" ? !clashes.has(p.slug) : filter === "verlinkung" ? !overlaps.has(p.slug) : filter !== "alle" && keywordStatus(p) !== filter) return false;
      if (!q) return true;
      return [p.name, p.path ?? "", p.main_keyword ?? "", ...p.secondary_keywords].some((t) => t.toLowerCase().includes(q));
    });
  }, [props.pages, filter, query, clashes, overlaps]);

  function download() {
    const blob = new Blob([keywordsCsv(visible, allConflicts)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "keywords-uebersicht.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const fieldClass =
    "w-full rounded-dt border bg-transparent px-1.5 py-1 text-xs text-sbkm-navy outline-none transition placeholder:text-sbkm-ink-500/70 hover:border-sbkm-navy/20 focus-visible:border-sbkm-mint/50 focus-visible:bg-white/80 focus-visible:ring-2 focus-visible:ring-sbkm-mint/30 disabled:opacity-60 dark:text-white dark:focus-visible:bg-white/10";

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
            {props.pages.length === 0 ? "noch keine Seiten" : `${props.pages.length - open_} von ${props.pages.length} Seiten fertig`}
          </span>
          {open_ > 0 ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-orange-700 dark:text-orange-300">
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
              {open_} offen
            </span>
          ) : null}
          {clashes.size > 0 ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 dark:text-red-300">
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
              {clashes.size} {clashes.size === 1 ? "Seite" : "Seiten"} mit gleichem Hauptkeyword
            </span>
          ) : null}
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-sbkm-ink-500 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <div className="grid gap-3 border-t border-sbkm-navy/8 px-4 py-4 dark:border-white/8 sm:px-5">
          {clashes.size > 0 ? (
            <p className="rounded-dt border border-red-300/60 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-900 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">
              {clashes.size} {clashes.size === 1 ? "Seite hat" : "Seiten haben"} dasselbe oder ein sehr ähnliches Hauptkeyword wie eine andere Seite. Seiten, die auf dasselbe Hauptkeyword zielen, konkurrieren und führen leicht zu doppeltem Inhalt: Bitte pro Hauptkeyword nur eine Seite festlegen. Filter „Gleiches Hauptkeyword“, dann direkt in der Tabelle ein spezifischeres Hauptkeyword eintragen.
            </p>
          ) : null}
          <p className="text-[11px] leading-snug text-sbkm-ink-500 dark:text-white/45">
            Felder anklicken und tippen: Gespeichert wird beim Verlassen des Feldes (Enter oder Strg+Enter, Esc nimmt zurück). Steht ein Hauptkeyword bei einer anderen Seite als Nebenkeyword, ist das in Ordnung (die Seiten verlinken sich), es ist blau markiert.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.filter((f) => f.key === "alle" || (f.key === "doppelt" ? clashes.size > 0 : f.key === "verlinkung" ? overlaps.size > 0 : (counts.get(f.key) ?? 0) > 0)).map((f) => {
              const n = f.key === "alle" ? props.pages.length : f.key === "doppelt" ? clashes.size : f.key === "verlinkung" ? overlaps.size : (counts.get(f.key) ?? 0);
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
                      : f.key === "doppelt"
                        ? "border-red-300/70 bg-red-50 text-red-800 dark:border-red-400/40 dark:bg-red-400/10 dark:text-red-200"
                        : f.key === "verlinkung"
                          ? "border-sky-300/70 bg-sky-50 text-sky-800 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-200"
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
                  <th className="w-[20%] px-3 py-2 font-semibold">Hauptkeyword</th>
                  <th className="w-[32%] px-3 py-2 font-semibold">Nebenkeywords</th>
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
                    const pageClashes = clashes.get(p.slug) ?? [];
                    const pageOverlaps = overlaps.get(p.slug) ?? [];
                    const exact = pageClashes.some((c) => c.level === "gleich");
                    const draft = valueOf(p);
                    const dirty = isDirty(p, draft);
                    const busy = saving.has(p.slug);
                    const bad = failed.has(p.slug);
                    const border = bad ? "border-red-400" : dirty ? "border-amber-400/80" : pageClashes.length > 0 ? (exact ? "border-red-300/80 bg-red-50/60 dark:bg-red-400/10" : "border-orange-300/80 bg-orange-50/60 dark:bg-orange-400/10") : "border-transparent";
                    const lines = Math.max(2, draft.secondary.split("\n").length);
                    return (
                      <tr key={p.slug} className="border-t border-sbkm-navy/8 align-top dark:border-white/8">
                        <td className="px-3 py-2.5">
                          <button type="button" className="text-left font-semibold text-sbkm-navy hover:underline dark:text-white" onClick={() => props.onOpen(p)}>
                            {p.name}
                          </button>
                          {p.path ? <div className="truncate font-mono text-[11px] text-sbkm-ink-500 dark:text-white/40">{p.path}</div> : null}
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={draft.main}
                            maxLength={120}
                            disabled={busy}
                            placeholder="Hauptkeyword eintragen …"
                            aria-label={`Hauptkeyword von ${p.name}`}
                            title={pageClashes.length > 0 ? pageClashes.map(describeKeywordConflict).join("\n") : undefined}
                            onChange={(e) => setDrafts((d) => ({ ...d, [p.slug]: { ...valueOf(p), main: e.target.value } }))}
                            onBlur={() => void commit(p)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                              if (e.key === "Escape") {
                                revert(p.slug);
                                e.currentTarget.blur();
                              }
                            }}
                            className={cn(fieldClass, border, "h-7", pageClashes.length > 0 && "font-semibold")}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <textarea
                            value={draft.secondary}
                            rows={lines}
                            disabled={busy}
                            placeholder="Nebenkeywords, eines pro Zeile …"
                            aria-label={`Nebenkeywords von ${p.name}`}
                            onChange={(e) => setDrafts((d) => ({ ...d, [p.slug]: { ...valueOf(p), secondary: e.target.value } }))}
                            onBlur={() => void commit(p)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) e.currentTarget.blur();
                              if (e.key === "Escape") {
                                revert(p.slug);
                                e.currentTarget.blur();
                              }
                            }}
                            className={cn(fieldClass, dirty ? "border-amber-400/80" : bad ? "border-red-400" : "border-transparent", "resize-y leading-snug [field-sizing:content]")}
                          />
                          {busy ? (
                            <span className="inline-flex items-center gap-1 px-1.5 text-[11px] text-sky-700 dark:text-sky-300">
                              <Loader2 className="size-3 animate-spin" aria-hidden />
                              Speichert …
                            </span>
                          ) : dirty ? (
                            <span className="px-1.5 text-[11px] text-amber-700 dark:text-amber-300">{bad ? "Nicht gespeichert – bitte prüfen" : "Noch nicht gespeichert (Feld verlassen)"}</span>
                          ) : null}
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
                          {pageClashes.slice(0, 4).map((c, i) => (
                            <div
                              key={`c${i}`}
                              className={cn(
                                "mt-0.5 flex max-w-[20rem] items-start gap-1 text-[11px] font-medium leading-snug",
                                c.level === "gleich" ? "text-red-700 dark:text-red-300" : "text-orange-700 dark:text-orange-300",
                              )}
                            >
                              <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
                              {describeKeywordConflict(c)}
                            </div>
                          ))}
                          {pageOverlaps.slice(0, 3).map((c, i) => (
                            <div key={`o${i}`} className="mt-0.5 flex max-w-[20rem] items-start gap-1 text-[11px] leading-snug text-sky-700 dark:text-sky-300">
                              <Link2 className="mt-px size-3 shrink-0" aria-hidden />
                              {describeKeywordConflict(c)}
                            </div>
                          ))}
                          {pageOverlaps.length > 3 ? <div className="mt-0.5 text-[11px] text-sky-700 dark:text-sky-300">… und {pageOverlaps.length - 3} weitere</div> : null}
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
