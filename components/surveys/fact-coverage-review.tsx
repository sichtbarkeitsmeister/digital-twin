"use client";

import { useMemo, useState } from "react";
import { Check, PencilLine, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  formatFactForPromptInsertion,
  type SurveyFactCoverageSummary,
} from "@/lib/dt/survey-facts";
import { cn } from "@/lib/utils";

type CoverageItem = SurveyFactCoverageSummary["missing"][number] & {
  status: "missing" | "weak";
};

export function FactCoverageReview(props: {
  factCoverage: SurveyFactCoverageSummary;
  acceptedFactIds: Set<string>;
  onAccept: (factId: string) => void;
  onInsertIntoPrompt: (factId: string, insertion: string) => void;
  className?: string;
}) {
  const items = useMemo((): CoverageItem[] => {
    const missing = props.factCoverage.missing.map((m) => ({
      ...m,
      status: "missing" as const,
      valueText: m.valueText ?? m.valuePreview,
    }));
    const weak = props.factCoverage.weak.map((m) => ({
      ...m,
      status: "weak" as const,
      valueText: m.valueText ?? m.valuePreview,
    }));
    return [...missing, ...weak].filter((i) => !props.acceptedFactIds.has(i.factId));
  }, [props.factCoverage, props.acceptedFactIds]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftById, setDraftById] = useState<Record<string, string>>({});

  if (items.length === 0) {
    return (
      <p className="text-sm text-secondary">
        Keine offenen Lücken mehr — alle fehlenden/unsicheren Facts sind übernommen oder als
        „passt“ markiert.
      </p>
    );
  }

  return (
    <div className={cn("grid gap-3", props.className)}>
      <p className="text-xs text-muted-foreground">
        Pro Fact: „Passt so“ akzeptiert die Heuristik (z.&nbsp;B. Paraphrase). „Anpassen“ setzt den
        Umfrage-Inhalt in den Prompt ein — du kannst den Text vorher editieren.
      </p>
      {items.map((item) => {
        const isEditing = editingId === item.factId;
        const draft =
          draftById[item.factId] ??
          formatFactForPromptInsertion({
            fieldTitle: item.fieldTitle,
            kind: item.kind,
            valueText: item.valueText,
          }).trim();

        return (
          <div
            key={`${item.status}-${item.factId}`}
            className="grid gap-2 rounded-xl border border-border p-3"
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {item.status === "missing" ? "fehlt" : "unsicher"}
              </span>
              <span className="text-sm font-semibold text-primary">{item.factId}</span>
              <span className="text-sm text-secondary">{item.fieldTitle}</span>
            </div>

            <p className="whitespace-pre-wrap text-sm text-secondary">{item.valueText}</p>

            {item.status === "weak" && item.matchedBy ? (
              <p className="text-xs text-muted-foreground">
                Heuristik-Treffer (unvollständig): „{item.matchedBy}“
              </p>
            ) : null}

            {isEditing ? (
              <div className="grid gap-2">
                <Label htmlFor={`draft-${item.factId}`}>Text für den Prompt</Label>
                <Textarea
                  id={`draft-${item.factId}`}
                  value={draft}
                  onChange={(e) =>
                    setDraftById((prev) => ({ ...prev, [item.factId]: e.target.value }))
                  }
                  rows={5}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      const text = draft.trim();
                      if (!text) return;
                      props.onInsertIntoPrompt(item.factId, `\n\n${text}\n`);
                      setEditingId(null);
                    }}
                  >
                    <Check className="size-4" aria-hidden />
                    In Prompt übernehmen
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setEditingId(null)}
                  >
                    <X className="size-4" aria-hidden />
                    Abbrechen
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => props.onAccept(item.factId)}
                >
                  <Check className="size-4" aria-hidden />
                  Passt so
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDraftById((prev) => ({
                      ...prev,
                      [item.factId]:
                        prev[item.factId] ??
                        formatFactForPromptInsertion({
                          fieldTitle: item.fieldTitle,
                          kind: item.kind,
                          valueText: item.valueText,
                        }).trim(),
                    }));
                    setEditingId(item.factId);
                  }}
                >
                  <PencilLine className="size-4" aria-hidden />
                  Anpassen
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
