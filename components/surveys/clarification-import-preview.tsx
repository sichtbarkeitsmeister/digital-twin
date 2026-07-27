"use client";

import type { SurveyClarificationImportPreview } from "@/lib/dt/survey-clarifications";
import { cn } from "@/lib/utils";

function kindLabel(kind: SurveyClarificationImportPreview["facts"][number]["kind"]): string {
  if (kind === "remark") return "Bemerkung";
  if (kind === "follow_up") return "Nachfrage";
  return "Antwort";
}

function scopeHint(scope: SurveyClarificationImportPreview["scope"], factCount: number): string {
  if (scope === "focused" && factCount > 0) {
    return `Gezielter Ausschnitt (${factCount} ${factCount === 1 ? "Eintrag" : "Einträge"}) — genau diese Inhalte gehen bei Freigabe an die KI.`;
  }
  if (scope === "full_survey") {
    return "Kein einzelnes passendes Feld gefunden — bitte Inhalt selbst angeben statt den ganzen Fragebogen zu übernehmen.";
  }
  return "Kein passendes Feld in der Quell-Umfrage gefunden — bitte Inhalt selbst angeben oder Freigabe verweigern.";
}

export function ClarificationImportPreview(props: {
  preview: SurveyClarificationImportPreview | null;
  className?: string;
  /** Compact styling for the create-agent modal. */
  compact?: boolean;
}) {
  if (!props.preview) return null;

  const { preview } = props;

  return (
    <div
      className={cn(
        "grid gap-2 rounded-lg border border-dashed p-3",
        props.compact
          ? "border-sbkm-navy/15 bg-sbkm-navy/[0.03] dark:border-white/15 dark:bg-white/[0.03]"
          : "border-border bg-muted/30",
        props.className,
      )}
    >
      <div className="grid gap-0.5">
        <p
          className={cn(
            "font-semibold",
            props.compact
              ? "text-xs text-sbkm-navy dark:text-white"
              : "text-xs text-primary",
          )}
        >
          Vorschau: Was übernommen wird
        </p>
        <p
          className={cn(
            props.compact
              ? "text-[11px] text-sbkm-ink-600 dark:text-white/45"
              : "text-xs text-muted-foreground",
          )}
        >
          {scopeHint(preview.scope, preview.facts.length)}
        </p>
      </div>

      {preview.facts.length === 0 ? (
        <p
          className={cn(
            props.compact
              ? "text-xs text-red-600 dark:text-red-400"
              : "text-sm text-destructive",
          )}
        >
          Kein Inhalt zum Übernehmen gefunden — bitte selbst angeben oder Freigabe
          verweigern.
        </p>
      ) : (
        <ul className="grid gap-2">
          {preview.facts.map((fact, idx) => (
            <li key={`${fact.fieldTitle}-${fact.kind}-${idx}`} className="grid gap-0.5">
              <p
                className={cn(
                  "font-medium",
                  props.compact
                    ? "text-xs text-sbkm-navy dark:text-white"
                    : "text-xs text-primary",
                )}
              >
                {fact.fieldTitle}
                <span
                  className={cn(
                    "ml-1 font-normal",
                    props.compact
                      ? "text-sbkm-ink-600/70 dark:text-white/40"
                      : "text-muted-foreground",
                  )}
                >
                  ({kindLabel(fact.kind)})
                </span>
              </p>
              <p
                className={cn(
                  "whitespace-pre-wrap",
                  props.compact
                    ? "text-xs text-sbkm-ink-600 dark:text-white/55"
                    : "text-sm text-secondary",
                )}
              >
                {fact.value}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
