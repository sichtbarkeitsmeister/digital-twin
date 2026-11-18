"use client";

import { ChevronDown } from "lucide-react";

import type { ContentReview } from "@/lib/dt/content/types";

const detailsClass = "group rounded-dt border border-sbkm-navy/10 bg-white dark:border-white/10 dark:bg-white/[0.05]";
const summaryClass =
  "flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-sbkm-ink-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 dark:text-white/55";

/**
 * „Hero-Kandidaten“ and „Belegliste“ in the page window: what the SEO step compared before it
 * chose the Hero-Überschrift, and where the Faktencheck found each factual statement backed.
 * For the release: unbacked statements come first and open the list. Renders nothing before the
 * steps have run (and for pages written before these lists existed).
 */
export function DtContentEvidence(props: { evidence: ContentReview["evidence"]; /** Heading of each Abschnitt by id, for the list. */ sectionNames?: Record<string, string> }) {
  const { hero_kandidaten: hero, belegliste } = props.evidence;
  if (hero.length === 0 && belegliste.length === 0) return null;
  const open = belegliste.filter((b) => !b.belegt);
  const sorted = [...open, ...belegliste.filter((b) => b.belegt)];
  return (
    <>
      {hero.length > 0 ? (
        <details className={detailsClass}>
          <summary className={summaryClass}>
            Hero-Kandidaten ({hero.length})
            <ChevronDown className="size-4 transition-transform duration-150 group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="grid gap-2 border-t border-sbkm-navy/8 px-4 py-3 text-xs leading-relaxed dark:border-white/8">
            {hero.map((k) => (
              <li key={k.text} className="grid gap-0.5">
                <span className={k.gewaehlt ? "font-semibold text-sbkm-navy dark:text-white" : "text-sbkm-ink-600 line-through decoration-sbkm-ink-500/40 dark:text-white/55"}>
                  {k.text}
                  {k.gewaehlt ? (
                    <span className="ml-1.5 rounded-pill bg-emerald-100 px-1.5 py-px text-[10px] font-semibold text-emerald-800 no-underline dark:bg-emerald-500/15 dark:text-emerald-200">gewählt</span>
                  ) : null}
                </span>
                {k.grund ? <span className="text-sbkm-ink-600 dark:text-white/60">{k.gewaehlt ? "Warum: " : "Verworfen: "}{k.grund}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {belegliste.length > 0 ? (
        <details className={detailsClass} open={open.length > 0}>
          <summary className={summaryClass}>
            <span>
              Belegliste ({belegliste.length})
              {open.length > 0 ? <span className="ml-1.5 normal-case tracking-normal text-red-700 dark:text-red-300">{open.length} ohne Beleg</span> : null}
            </span>
            <ChevronDown className="size-4 transition-transform duration-150 group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="grid gap-2.5 border-t border-sbkm-navy/8 px-4 py-3 text-xs leading-relaxed dark:border-white/8">
            {sorted.map((b, i) => (
              <li key={`${i}-${b.zitat.slice(0, 40)}`} className="grid gap-0.5">
                <span className="text-sbkm-navy dark:text-white">„{b.zitat}“</span>
                <span className={b.belegt ? "text-sbkm-ink-600 dark:text-white/60" : "font-semibold text-red-700 dark:text-red-300"}>
                  {b.belegt ? "Beleg: " : "Ohne Beleg: "}
                  {b.beleg}
                </span>
                {b.block_id ? <span className="text-[11px] text-sbkm-ink-500 dark:text-white/45">Abschnitt: {props.sectionNames?.[b.block_id] ?? b.block_id}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
