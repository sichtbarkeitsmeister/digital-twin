"use client";

import { Plus } from "lucide-react";

import {
  addCheckboxOtherEntry,
  displayedCheckboxPresetLabel,
  parseCheckboxOtherEntries,
  removeCheckboxOtherEntry,
  setCheckboxOtherEntryText,
  setCheckboxPresetLabel,
  setCheckboxPresetSelection,
} from "@/lib/surveys/other-option";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

type Props = {
  fieldId: string;
  options: Array<{ id: string; label: string }>;
  value: unknown;
  onChange: (next: string[]) => void;
  disabled?: boolean;
  allowOtherOption?: boolean;
  compact?: boolean;
};

export function SurveyCheckboxInput({
  fieldId,
  options,
  value,
  onChange,
  disabled,
  allowOtherOption = true,
  compact,
}: Props) {
  const presetLabels = options.map((opt) => opt.label);
  const state = parseCheckboxOtherEntries(value, presetLabels);
  const inputClass = compact
    ? "h-9 min-w-0 flex-1 text-sm"
    : "h-11 min-w-0 flex-1 text-base lg:h-9 lg:text-sm";

  return (
    <div className="grid gap-2" data-field-id={fieldId}>
      {options.map((opt) => {
        const checked = state.selectedPresets.has(opt.label);
        const label = displayedCheckboxPresetLabel(opt.label, state);
        return (
          <div
            key={opt.id}
            className={cn(
              "flex items-center gap-3 rounded-md border px-2.5 py-2.5 text-base shadow-sm transition-colors lg:px-3 lg:py-2 lg:text-sm",
              checked ? "border-primary bg-primary/5" : "border-input bg-background",
              disabled && "cursor-not-allowed opacity-70",
            )}
          >
            <Checkbox
              checked={checked}
              disabled={disabled}
              aria-label={label.trim() || opt.label || "Option"}
              onCheckedChange={(next) =>
                onChange(
                  setCheckboxPresetSelection(value, presetLabels, opt.label, Boolean(next)),
                )
              }
            />
            <Input
              value={label}
              disabled={disabled}
              placeholder="Bezeichnung anpassen…"
              className={inputClass}
              onChange={(e) =>
                onChange(setCheckboxPresetLabel(value, presetLabels, opt.label, e.target.value))
              }
            />
          </div>
        );
      })}

      {allowOtherOption
        ? state.otherEntries.map((entry, entryIdx) => (
            <div
              key={entry.id}
              className={cn(
                "flex items-center gap-3 rounded-md border px-3 py-2 text-sm shadow-sm",
                "border-primary bg-primary/5",
                disabled && "cursor-not-allowed opacity-70",
              )}
            >
              <Checkbox
                checked
                disabled={disabled}
                aria-label={`Eigene Option ${entryIdx + 1} entfernen`}
                onCheckedChange={(next) => {
                  if (next !== false) return;
                  onChange(removeCheckboxOtherEntry(value, presetLabels, entry.id));
                }}
              />
              <Input
                value={entry.text}
                disabled={disabled}
                placeholder={`Eigene Option ${entryIdx + 1}…`}
                className={inputClass}
                onChange={(e) =>
                  onChange(
                    setCheckboxOtherEntryText(value, presetLabels, entry.id, e.target.value),
                  )
                }
              />
            </div>
          ))
        : null}

      {allowOtherOption ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className={cn(
            "w-full justify-center",
            compact ? "h-9 text-sm sm:w-auto" : "h-11 text-base lg:h-9 lg:w-auto lg:text-sm",
          )}
          onClick={() => onChange(addCheckboxOtherEntry(value, presetLabels))}
        >
          <Plus className="mr-2 h-4 w-4" />
          Andere / eigene Option hinzufügen
        </Button>
      ) : null}
    </div>
  );
}
