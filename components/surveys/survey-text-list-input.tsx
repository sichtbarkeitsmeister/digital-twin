"use client";

import { Plus, X } from "lucide-react";

import { SurveyOpenAnswerField } from "@/components/surveys/survey-open-answer-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { SurveyOption } from "@/lib/surveys/types";
import {
  addTextListExtraEntry,
  coerceTextListState,
  removeTextListExtraEntry,
  setTextListEntryValue,
} from "@/lib/surveys/text-list-answer";

export function SurveyTextListInput(props: {
  fieldId: string;
  options: SurveyOption[];
  value: unknown;
  onChange: (next: unknown) => void;
  disabled?: boolean;
  placeholder?: string;
  allowExtraEntries?: boolean;
  required?: boolean;
  addEntryLabel?: string;
}) {
  const optionIds = props.options.map((o) => o.id);
  const state = coerceTextListState(props.value, optionIds);
  const promptById = new Map(props.options.map((o) => [o.id, o.label] as const));
  const addLabel = props.addEntryLabel?.trim() || "Weitere Eingabe hinzufügen";

  return (
    <div className="grid gap-3">
      {state.entries.map((entry, index) => {
        const prompt = promptById.get(entry.id);
        const isPromptSlot = prompt !== undefined;
        const customPrompt = isPromptSlot ? prompt.trim() : "";
        const label = customPrompt || String(index + 1);
        return (
          <div key={entry.id} className="grid gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label
                htmlFor={`${props.fieldId}_${entry.id}`}
                className="text-sm font-medium text-foreground"
              >
                {label}
                {props.required && isPromptSlot ? (
                  <span className="text-destructive"> *</span>
                ) : null}
              </Label>
              {!isPromptSlot && props.allowExtraEntries !== false ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  disabled={props.disabled}
                  aria-label="Eingabe entfernen"
                  onClick={() =>
                    props.onChange(
                      removeTextListExtraEntry(props.value, optionIds, entry.id),
                    )
                  }
                >
                  <X className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
            <SurveyOpenAnswerField
              id={`${props.fieldId}_${entry.id}`}
              value={entry.value}
              disabled={props.disabled}
              placeholder={props.placeholder ?? "Antwort eingeben"}
              onChange={(e) =>
                props.onChange(
                  setTextListEntryValue(
                    props.value,
                    optionIds,
                    entry.id,
                    e.target.value,
                  ),
                )
              }
            />
          </div>
        );
      })}

      {props.allowExtraEntries !== false ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={props.disabled}
          className="h-11 w-full justify-center text-base lg:h-9 lg:w-auto lg:text-sm"
          onClick={() =>
            props.onChange(addTextListExtraEntry(props.value, optionIds))
          }
        >
          <Plus className="mr-2 h-4 w-4" />
          {addLabel}
        </Button>
      ) : null}
    </div>
  );
}
