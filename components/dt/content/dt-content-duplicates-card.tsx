"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, CopyCheck, Loader2 } from "lucide-react";

import { cn } from "@/components/dt/cn";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { contentApi, contentQuery } from "@/components/dt/content/content-api";
import { duplicateSeverity, type DuplicatePair, type DuplicateReport } from "@/lib/dt/content/duplicates";

const cardClass =
  "relative overflow-hidden rounded-dt-lg border border-sbkm-navy/10 bg-white/55 shadow-dt backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.05]";

const SEVERITY_STYLE = {
  hoch: "border-red-300/70 bg-red-50 text-red-800 dark:border-red-400/40 dark:bg-red-400/10 dark:text-red-200",
  mittel: "border-orange-300/70 bg-orange-50 text-orange-800 dark:border-orange-400/40 dark:bg-orange-400/10 dark:text-orange-200",
  gering: "border-sbkm-navy/12 text-sbkm-ink-600 dark:border-white/15 dark:text-white/65",
} as const;

const SEVERITY_LABEL = { hoch: "Stark", mittel: "Mittel", gering: "Gering" } as const;
const SHOWN_STEP = 25;

const pct = (share: number) => `${Math.max(1, Math.round(share * 100))} %`;

/**
 * „Doppelte Inhalte“: compares the finished texts of all pages with each other and lists the pages
 * that repeat paragraphs, with the paragraphs side by side. Code only: no model, no cost. The
 * Endabnahme lists the same findings for each page it checks; this card shows them for the whole site
 * at any time, also for texts that were finished before a later one was written.
 */
export function DtContentDuplicatesCard(props: { organisationId: string; onOpen: (page: { slug: string; name: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<DuplicateReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"alle" | "hoch" | "mittel">("alle");
  const [shown, setShown] = useState(SHOWN_STEP);

  async function compare() {
    setBusy(true);
    setError(null);
    const res = await contentApi<DuplicateReport>(`/api/dt/content/duplicates?${contentQuery(props.organisationId)}`);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setReport(res.data);
    setShown(SHOWN_STEP);
    setOpen(true);
  }

  const pairs = (report?.pairs ?? []).filter((p) => {
    const severity = duplicateSeverity(p);
    return filter === "alle" || severity === filter || (filter === "mittel" && severity === "hoch");
  });
  const strong = (report?.pairs ?? []).filter((p) => duplicateSeverity(p) === "hoch").length;

  return (
    <section className={cardClass} aria-label="Doppelte Inhalte">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
        <button type="button" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <CopyCheck className="size-4 shrink-0 text-sbkm-mint" aria-hidden />
          <span className="text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">Doppelte Inhalte</span>
          {report ? (
            report.pairs.length === 0 ? (
              <span className="text-xs text-sbkm-ink-600 dark:text-white/60">keine gefunden · {report.pages} Texte verglichen</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 dark:text-red-300">
                <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                {report.pairs.length} {report.pairs.length === 1 ? "Seitenpaar" : "Seitenpaare"}
                {strong > 0 ? `, davon ${strong} stark` : ""}
              </span>
            )
          ) : (
            <span className="text-xs text-sbkm-ink-600 dark:text-white/60">Fertige Texte miteinander vergleichen</span>
          )}
        </button>
        <div className="flex items-center gap-2">
          <DtPillButton type="button" size="sm" variant="outline" className="h-8 px-3 text-xs" disabled={busy} onClick={() => void compare()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <CopyCheck className="size-3.5" aria-hidden />}
            {report ? "Neu vergleichen" : "Texte vergleichen"}
          </DtPillButton>
          <ChevronDown className={cn("size-4 shrink-0 text-sbkm-ink-500 transition-transform", open && "rotate-180")} aria-hidden />
        </div>
      </div>
      {open && (error || report) ? (
        <div className="grid gap-3 border-t border-sbkm-navy/8 px-4 py-4 dark:border-white/8 sm:px-5">
          {error ? <p className="text-xs text-red-700 dark:text-red-300">{error}</p> : null}
          {report && report.pairs.length === 0 ? (
            <p className="text-xs text-sbkm-ink-600 dark:text-white/60">
              Keine doppelten Absätze gefunden ({report.paragraphs} Absätze aus {report.pages} Texten verglichen).
            </p>
          ) : null}
          {report && report.pairs.length > 0 ? (
            <>
              <div className="flex flex-wrap gap-2">
                {(["alle", "hoch", "mittel"] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={filter === key}
                    onClick={() => {
                      setFilter(key);
                      setShown(SHOWN_STEP);
                    }}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition",
                      filter === key
                        ? "border-sbkm-navy bg-sbkm-navy text-white dark:border-white dark:bg-white dark:text-sbkm-navy"
                        : "border-sbkm-navy/12 text-sbkm-ink-600 hover:border-sbkm-navy/30 dark:border-white/15 dark:text-white/65",
                    )}
                  >
                    {key === "alle" ? "Alle" : key === "hoch" ? "Nur starke (ab 30 %)" : "Ab 10 %"}
                  </button>
                ))}
              </div>
              <ul className="grid gap-2">
                {pairs.slice(0, shown).map((pair) => (
                  <PairRow key={`${pair.a.slug}|${pair.b.slug}`} pair={pair} onOpen={props.onOpen} />
                ))}
              </ul>
              {pairs.length > shown ? (
                <DtPillButton type="button" size="sm" variant="outline" className="h-8 w-fit px-3 text-xs" onClick={() => setShown((n) => n + SHOWN_STEP)}>
                  Weitere anzeigen ({pairs.length - shown})
                </DtPillButton>
              ) : null}
            </>
          ) : null}
          {report && report.standardTexts.length > 0 ? (
            <details className="rounded-dt border border-sbkm-navy/8 bg-white/50 px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
              <summary className="cursor-pointer text-xs font-semibold text-sbkm-navy dark:text-white">
                Standardtexte, nicht mitgezählt ({report.standardTexts.length})
              </summary>
              <p className="mt-1 text-[11px] text-sbkm-ink-500 dark:text-white/45">Derselbe Absatz steht auf vier oder mehr Seiten, etwa ein Kontakthinweis. Das ist meist gewollt.</p>
              <ul className="mt-2 grid gap-2">
                {report.standardTexts.map((s, i) => (
                  <li key={i} className="text-xs text-sbkm-ink-600 dark:text-white/65">
                    „{s.text}“
                    <span className="block text-[11px] text-sbkm-ink-500 dark:text-white/45">auf {s.pages.length} Seiten: {s.pages.map((p) => p.name).join(", ")}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function PairRow(props: { pair: DuplicatePair; onOpen: (page: { slug: string; name: string }) => void }) {
  const { pair } = props;
  const severity = duplicateSeverity(pair);
  return (
    <li className="rounded-dt border border-sbkm-navy/10 bg-white/70 dark:border-white/10 dark:bg-white/[0.04]">
      <details>
        <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-xs">
          <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", SEVERITY_STYLE[severity])}>{SEVERITY_LABEL[severity]}</span>
          <span className="min-w-0 font-semibold text-sbkm-navy dark:text-white">
            {pair.a.name} <span className="font-normal text-sbkm-ink-500 dark:text-white/45">↔</span> {pair.b.name}
          </span>
          <span className="text-sbkm-ink-600 dark:text-white/60">
            {pair.matches.length} {pair.matches.length === 1 ? "Absatz" : "Absätze"} · {pct(pair.shareA)} von „{pair.a.name}“ · {pct(pair.shareB)} von „{pair.b.name}“
          </span>
        </summary>
        <div className="grid gap-3 border-t border-sbkm-navy/8 px-3 py-3 dark:border-white/8">
          <div className="flex flex-wrap gap-2">
            <DtPillButton type="button" size="sm" variant="outline" className="h-7 px-3 text-xs" onClick={() => props.onOpen({ slug: pair.a.slug, name: pair.a.name })}>
              „{pair.a.name}“ öffnen
            </DtPillButton>
            <DtPillButton type="button" size="sm" variant="outline" className="h-7 px-3 text-xs" onClick={() => props.onOpen({ slug: pair.b.slug, name: pair.b.name })}>
              „{pair.b.name}“ öffnen
            </DtPillButton>
          </div>
          {pair.matches.map((m, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-2">
              {([m.a, m.b] as const).map((side, k) => (
                <blockquote key={k} className="rounded-dt border border-sbkm-navy/8 bg-sbkm-canvas/60 px-3 py-2 text-xs leading-relaxed text-sbkm-navy dark:border-white/10 dark:bg-white/[0.04] dark:text-white">
                  <span className="mb-1 block text-[11px] font-semibold text-sbkm-ink-500 dark:text-white/45">
                    {side.name}
                    {side.heading ? ` · ${side.heading}` : ""}
                    {k === 1 ? ` · ${m.level === "gleich" ? "fast gleich" : "sehr ähnlich"} (${pct(m.similarity)})` : ""}
                  </span>
                  {side.text}
                </blockquote>
              ))}
            </div>
          ))}
        </div>
      </details>
    </li>
  );
}
