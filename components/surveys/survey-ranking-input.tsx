"use client";

import * as React from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";

import {
  addCustomRankingItem,
  coerceRankingState,
  encodeRankingDragKey,
  reorderRankingItems,
  removeCustomRankingItem,
  setCustomRankingLabel,
  toRankingPayload,
  togglePresetInRanking,
  type RankingAnswerPayload,
} from "@/lib/surveys/ranking-answer";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

type Props = {
  fieldId: string;
  presetLabels: string[];
  value: unknown;
  onChange: (next: RankingAnswerPayload) => void;
  disabled?: boolean;
  /** Wenn false, kein Button „Eigene Option“; Standard wie in der Umfrage-Definition (true). */
  allowCustomEntries?: boolean;
};

export function SurveyRankingInput({
  fieldId,
  presetLabels,
  value,
  onChange,
  disabled,
  allowCustomEntries = true,
}: Props) {
  const [dragState, setDragState] = React.useState<{
    fieldId: string;
    key: string;
  } | null>(null);

  const state = React.useMemo(() => coerceRankingState(value, presetLabels), [value, presetLabels]);

  function commit(next: RankingAnswerPayload) {
    onChange(toRankingPayload(next));
  }

  function setRankingPosition(fromIndex: number, toIndex: number) {
    const nextItems = reorderRankingItems(state.items, fromIndex, toIndex);
    commit({ ...state, items: nextItems });
  }

  const excludedInSurveyOrder = React.useMemo(() => {
    const included = new Set<string>();
    for (const it of state.items) {
      if (it.kind === "preset") included.add(it.label);
    }
    return presetLabels.filter((l) => !included.has(l));
  }, [state.items, presetLabels]);

  return (
    <div className="grid w-full min-w-0 max-w-full gap-4 overflow-x-hidden">
      <p className="text-sm text-secondary lg:text-xs">
        Aktiviere pro Option die Checkbox, um sie in die Rangliste aufzunehmen. Reihenfolge per Ziehen oder
        Positionswahl — oben zuerst.
      </p>

      {state.items.length > 0 ? (
        <div className="grid gap-2">
          <p className="text-base font-medium lg:text-sm">Rangliste</p>
          <ul className="grid w-full min-w-0 list-none gap-2 p-0" role="list">
            {state.items.map((item, idx) => {
              const dragKey = encodeRankingDragKey(item);
              const rowLabel = item.kind === "preset" ? item.label : item.label.trim() || "Eigene Option";
              return (
                <li key={dragKey} className="min-w-0">
                  <div
                    draggable={!disabled}
                    onDragStart={(e) => {
                      if (disabled) return;
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", dragKey);
                      setDragState({ fieldId, key: dragKey });
                    }}
                    onDragOver={(e) => {
                      if (disabled) return;
                      e.preventDefault();
                      if (!dragState || dragState.fieldId !== fieldId) return;
                      const fromIndex = state.items.findIndex((i) => encodeRankingDragKey(i) === dragState.key);
                      if (fromIndex < 0 || fromIndex === idx) return;
                      setRankingPosition(fromIndex, idx);
                    }}
                    onDrop={(e) => {
                      if (disabled) return;
                      e.preventDefault();
                      setDragState(null);
                    }}
                    onDragEnd={() => setDragState(null)}
                    className={cn(
                      "flex w-full max-w-full flex-col gap-2 rounded-lg border px-2.5 py-2.5 text-base transition-colors lg:rounded-md lg:px-3 lg:py-2 lg:text-sm",
                      dragState?.fieldId === fieldId && dragState.key === dragKey
                        ? "border-primary bg-primary/10 opacity-80"
                        : "border-input bg-background",
                      disabled && "opacity-70",
                    )}
                  >
                    <div className="grid gap-2 md:hidden">
                      <div className="flex min-w-0 items-start gap-2">
                        <div className="flex h-9 w-8 shrink-0 items-center justify-center">
                          {item.kind === "preset" ? (
                            <Checkbox
                              checked
                              disabled={disabled}
                              aria-label={`${item.label} aus Rangliste entfernen`}
                              onCheckedChange={(next) => {
                                if (next !== false) return;
                                commit(togglePresetInRanking(state, item.label, false, presetLabels));
                              }}
                            />
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={disabled}
                              className="h-9 w-9 shrink-0 text-secondary hover:text-destructive"
                              aria-label="Eigene Option entfernen"
                              onClick={() => commit(removeCustomRankingItem(state, item.id, presetLabels))}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>

                        {item.kind === "preset" ? (
                          <span className="min-w-0 flex-1 break-words font-medium leading-snug">{item.label}</span>
                        ) : (
                          <Input
                            value={item.label}
                            disabled={disabled}
                            placeholder="Eigene Option beschriften…"
                            aria-label={`Text für eigene Option ${idx + 1}`}
                            onChange={(e) =>
                              commit(setCustomRankingLabel(state, item.id, e.target.value, presetLabels))
                            }
                            className="h-10 min-w-0 w-full flex-1 text-base"
                          />
                        )}
                      </div>

                      <div className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-dashed px-2.5 py-2">
                        <span className="min-w-0 flex-1 break-words text-xs text-secondary">
                          Position in Rangliste
                        </span>
                        <label className="sr-only" htmlFor={`${fieldId}_rank_${dragKey}`}>
                          Rang für {rowLabel}
                        </label>
                        <select
                          id={`${fieldId}_rank_${dragKey}`}
                          aria-label={`Rang für ${rowLabel}`}
                          value={idx + 1}
                          disabled={disabled}
                          onChange={(e) => {
                            const toIndex = Number.parseInt(e.target.value, 10) - 1;
                            if (!Number.isInteger(toIndex)) return;
                            setRankingPosition(idx, toIndex);
                          }}
                          className="h-10 w-20 shrink-0 rounded-md border border-border/90 bg-card px-2 text-base shadow-sm ring-1 ring-border/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-70"
                        >
                          {state.items.map((_, rankIndex) => (
                            <option key={`${fieldId}_opt_${rankIndex}`} value={rankIndex + 1}>
                              {rankIndex + 1}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="hidden min-w-0 grid-cols-[auto_1fr_auto] items-center gap-2 md:grid">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center">
                        {item.kind === "preset" ? (
                          <Checkbox
                            checked
                            disabled={disabled}
                            aria-label={`${item.label} aus Rangliste entfernen`}
                            onCheckedChange={(next) => {
                              if (next !== false) return;
                              commit(togglePresetInRanking(state, item.label, false, presetLabels));
                            }}
                          />
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={disabled}
                            className="h-9 w-9 shrink-0 text-secondary hover:text-destructive lg:h-9 lg:w-9"
                            aria-label="Eigene Option entfernen"
                            onClick={() => commit(removeCustomRankingItem(state, item.id, presetLabels))}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>

                      {item.kind === "preset" ? (
                        <span className="min-w-0 break-words font-medium leading-snug">{item.label}</span>
                      ) : (
                        <Input
                          value={item.label}
                          disabled={disabled}
                          placeholder="Eigene Option beschriften…"
                          aria-label={`Text für eigene Option ${idx + 1}`}
                          onChange={(e) =>
                            commit(setCustomRankingLabel(state, item.id, e.target.value, presetLabels))
                          }
                          className="h-10 min-w-0 w-full text-base lg:h-9 lg:text-sm"
                        />
                      )}

                      <div className="flex items-center justify-end gap-2">
                        <span className="hidden text-xs text-secondary md:inline">Ziehen zum Sortieren</span>
                        <GripVertical
                          className={cn(
                            "hidden h-4 w-4 shrink-0 text-secondary md:inline-block",
                            disabled ? "cursor-not-allowed" : "cursor-grab",
                          )}
                          aria-hidden
                        />
                        <label className="sr-only" htmlFor={`${fieldId}_rank_${dragKey}_desktop`}>
                          Rang für {rowLabel}
                        </label>
                        <select
                          id={`${fieldId}_rank_${dragKey}_desktop`}
                          aria-label={`Rang für ${rowLabel}`}
                          value={idx + 1}
                          disabled={disabled}
                          onChange={(e) => {
                            const toIndex = Number.parseInt(e.target.value, 10) - 1;
                            if (!Number.isInteger(toIndex)) return;
                            setRankingPosition(idx, toIndex);
                          }}
                          className="h-9 w-14 shrink-0 rounded-md border border-border/90 bg-card px-2 text-sm shadow-sm ring-1 ring-border/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-70"
                        >
                          {state.items.map((_, rankIndex) => (
                            <option key={`${fieldId}_opt_desktop_${rankIndex}`} value={rankIndex + 1}>
                              {rankIndex + 1}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="rounded-md border border-dashed px-2.5 py-4 text-center text-sm text-secondary lg:px-3">
          Noch nichts in der Rangliste. Aktiviere unten Optionen per Checkbox.
        </p>
      )}

      {excludedInSurveyOrder.length > 0 ? (
        <div className="grid gap-2">
          <p className="text-base font-medium text-secondary lg:text-sm">Nicht in der Rangliste</p>
          <ul className="grid w-full list-none gap-2 p-0" role="list">
            {excludedInSurveyOrder.map((label) => (
              <li key={`${fieldId}_ex_${label}`}>
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md border border-dashed px-2.5 py-2.5 text-base transition-colors hover:bg-accent/50 lg:px-3 lg:py-2 lg:text-sm",
                    disabled && "cursor-not-allowed opacity-70",
                  )}
                >
                  <Checkbox
                    checked={false}
                    disabled={disabled}
                    aria-label={`${label} in die Rangliste aufnehmen`}
                    onCheckedChange={(next) => {
                      if (next === true) {
                        commit(togglePresetInRanking(state, label, true, presetLabels));
                      }
                    }}
                  />
                  <span className="min-w-0 break-words text-secondary">{label}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {allowCustomEntries ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className="h-auto min-h-11 w-full justify-center px-3 py-2 text-center text-base leading-snug whitespace-normal break-words md:h-9 md:min-h-0 md:w-auto md:whitespace-nowrap md:py-0 md:text-sm"
          onClick={() => commit(addCustomRankingItem(state, presetLabels))}
        >
          <Plus className="mr-2 h-4 w-4" aria-hidden />
          Andere / eigene Option hinzufügen
        </Button>
      ) : null}
    </div>
  );
}
