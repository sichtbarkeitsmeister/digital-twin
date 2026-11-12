"use client";

import { AlertTriangle, Loader2, Lock } from "lucide-react";

import { cn } from "@/components/dt/cn";
import { DtAgentStatusToggle } from "@/components/dt/agents/dt-agent-status-toggle";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { CONTENT_SKIP_LOCKED_REASONS, CONTENT_STEPS, isContentSkippableStepKey } from "@/lib/dt/content/pipeline/steps";
import { CONTENT_SKIP_NOTE, contentSkipWarnings, type ContentBulkSteps } from "@/lib/dt/content/presentation";

/**
 * „Schritte“ in the Texte dashboard, under the Standard-Zielgruppe: the same switches as in the
 * page window, for all ticked pages at once. Untouched (`value` null) every page keeps its own
 * setting; once a switch was moved, the choice is written to the ticked pages when „Texte
 * erstellen“ starts them (or at once with „Jetzt anwenden“). The page window keeps its own block.
 */
export function DtContentBulkStepsPanel(props: {
  value: ContentBulkSteps | null;
  onChange: (next: ContentBulkSteps | null) => void;
  selectedCount: number;
  /** Writing the choice to the ticked pages: page n of total. */
  progress: { done: number; total: number } | null;
  disabled?: boolean;
  onApply: () => void;
}) {
  const { value, progress } = props;
  const skip = value?.skip_steps ?? [];
  const reviewStop = value?.review_stop ?? true;
  const disabled = Boolean(props.disabled) || progress != null;

  return (
    <div className="grid gap-2.5">
      <div className="grid gap-0.5">
        <h2 className="text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">Schritte</h2>
        <p className="text-xs text-sbkm-ink-600 dark:text-white/60">Für die angehakten Seiten: welche Schritte laufen sollen.</p>
      </div>
      {/* Two columns from sm up, read downwards: 1–5 left, 6–10 right. */}
      <ul className="grid gap-x-10 gap-y-1.5 sm:grid-flow-col sm:grid-cols-2 sm:grid-rows-5">
        {CONTENT_STEPS.map((s) => {
          const key = s.key;
          const off = isContentSkippableStepKey(key) && skip.includes(key);
          return (
            <li key={key} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-4 shrink-0 text-right tabular-nums text-sbkm-ink-500 dark:text-white/40">{s.step}</span>
                <span className={cn("truncate", off ? "text-sbkm-ink-500 line-through dark:text-white/40" : "text-sbkm-navy dark:text-white/85")}>
                  {s.name}
                </span>
              </span>
              {isContentSkippableStepKey(key) ? (
                <DtAgentStatusToggle
                  compact
                  enabled={!off}
                  disabled={disabled}
                  onChange={(run) =>
                    props.onChange({
                      review_stop: reviewStop,
                      skip_steps: run ? skip.filter((k) => k !== key) : [...skip.filter((k) => k !== key), key],
                    })
                  }
                  label={off ? `${s.name} wieder einschalten` : `${s.name} überspringen`}
                />
              ) : (
                <span
                  className="inline-flex shrink-0 items-center gap-1 text-[11px] text-sbkm-ink-500 dark:text-white/45"
                  title={key === "analyse" ? CONTENT_SKIP_LOCKED_REASONS.analyse : CONTENT_SKIP_LOCKED_REASONS.endabnahme}
                >
                  <Lock className="size-3" aria-hidden />
                  läuft immer
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between gap-3 border-t border-sbkm-navy/8 pt-2.5 text-xs dark:border-white/8 sm:justify-start">
        <span className="text-sbkm-navy dark:text-white/85" title="Die Seite wartet vor der Watermark Entfernung, bis jemand den Text durchgesehen hat.">
          Vor der Watermark zur Durchsicht anhalten
        </span>
        <DtAgentStatusToggle
          compact
          enabled={reviewStop}
          disabled={disabled}
          onChange={(on) => props.onChange({ skip_steps: skip, review_stop: on })}
          label={reviewStop ? "Ohne Durchsicht durchlaufen" : "Vor der Watermark anhalten"}
        />
      </div>
      {contentSkipWarnings(skip).map((warning) => (
        <p key={warning} className="flex gap-1.5 text-[11px] leading-snug text-orange-700 dark:text-orange-300">
          <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
          {warning}
        </p>
      ))}
      {skip.includes("seo") ? (
        <p className="text-[11px] leading-snug text-sbkm-ink-500 dark:text-white/45">
          SEO wird nur bei Seiten mit vorhandenem Text übersprungen (von der Website oder aus einer Word-Datei); bei allen anderen läuft SEO trotzdem.
        </p>
      ) : null}
      <p className="text-[11px] leading-snug text-sbkm-ink-500 dark:text-white/45">{CONTENT_SKIP_NOTE}</p>
      {value ? (
        <div className="grid gap-1.5 rounded-lg border border-sbkm-mint/50 bg-sbkm-mint/10 px-2.5 py-2 text-[11px] leading-snug text-sbkm-navy dark:border-sbkm-mint/30 dark:text-white/85">
          <p>
            Gilt beim Klick auf „Texte erstellen“ für alle angehakten Seiten und ersetzt deren eigene Einstellung. Im Seitenfenster lässt sie sich danach je Seite ändern.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <DtPillButton
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-[11px]"
              disabled={disabled || props.selectedCount === 0}
              onClick={props.onApply}
              title="Die Auswahl sofort in die angehakten Seiten schreiben, ohne sie zu starten."
            >
              Jetzt anwenden ({props.selectedCount})
            </DtPillButton>
            <button
              type="button"
              disabled={disabled}
              onClick={() => props.onChange(null)}
              className="rounded-pill font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 disabled:opacity-50"
            >
              Verwerfen
            </button>
            {progress ? (
              <span className="inline-flex items-center gap-1 text-sky-700 dark:text-sky-300">
                <Loader2 className="size-3 animate-spin" aria-hidden />
                Seite {Math.min(progress.done + 1, progress.total)} von {progress.total} …
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-[11px] leading-snug text-sbkm-ink-500 dark:text-white/45">
          Nicht verändert: Jede Seite behält ihre eigene Einstellung aus dem Seitenfenster. Sobald hier ein Regler umgelegt wird, gilt die Auswahl für alle angehakten Seiten.
        </p>
      )}
    </div>
  );
}
