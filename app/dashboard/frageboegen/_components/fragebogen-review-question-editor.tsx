"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  SURVEY_FIELD_TYPE_LABELS,
  SURVEY_FIELD_TYPES,
  applyReviewQuestionType,
  type ReviewQuestionItem,
} from "@/lib/surveys/fragebogen-review-draft";
import type { SurveyFieldType } from "@/lib/surveys/types";

function sourceBadge(source: string) {
  if (source === "organisation") return "Organisation";
  if (source === "website") return "Website";
  if (source === "crawl") return "Crawl";
  if (source === "ai") return "KI";
  if (source === "meeting") return "Kundengespräch";
  return "Leer";
}

function needsOptions(type: SurveyFieldType) {
  return (
    type === "text_list" ||
    type === "radio" ||
    type === "checkbox" ||
    type === "ranking"
  );
}

function minOptions(type: SurveyFieldType) {
  return type === "ranking" ? 2 : 1;
}

export function FragebogenReviewQuestionEditor(props: {
  question: ReviewQuestionItem;
  index: number;
  total: number;
  onChange: (patch: Partial<ReviewQuestionItem>) => void;
  onReplace: (next: ReviewQuestionItem) => void;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
}) {
  const q = props.question;
  const optionMin = minOptions(q.type);

  function addOption() {
    props.onChange({
      options: [
        ...q.options,
        {
          id: `opt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
          label: q.type === "text_list" ? "" : `Option ${q.options.length + 1}`,
        },
      ],
    });
  }

  function updateOption(optionId: string, label: string) {
    props.onChange({
      options: q.options.map((opt) => (opt.id === optionId ? { ...opt, label } : opt)),
    });
  }

  function removeOption(optionId: string) {
    if (q.options.length <= optionMin) return;
    props.onChange({ options: q.options.filter((opt) => opt.id !== optionId) });
  }

  return (
    <Card className="border-sbkm-navy/10">
      <CardContent className="grid gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={q.kind === "core" ? "default" : "secondary"}>
              {q.kind === "core" ? "Kernfrage" : "Zusatzfrage"}
            </Badge>
            <Badge variant="outline">{sourceBadge(q.answerSource)}</Badge>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => props.onMove(-1)}
              disabled={props.index === 0}
              aria-label="Frage nach oben"
            >
              <ArrowUp className="size-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => props.onMove(1)}
              disabled={props.index === props.total - 1}
              aria-label="Frage nach unten"
            >
              <ArrowDown className="size-4" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-red-700"
              onClick={props.onRemove}
            >
              <Trash2 className="size-3.5" aria-hidden />
              Entfernen
            </Button>
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor={`title-${q.id}`}>Fragetitel</Label>
          <Input
            id={`title-${q.id}`}
            value={q.title}
            onChange={(e) => props.onChange({ title: e.target.value })}
            placeholder="Frage formulieren…"
            className="font-medium"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor={`desc-${q.id}`}>Beschreibung (optional)</Label>
          <Textarea
            id={`desc-${q.id}`}
            value={q.description}
            rows={2}
            placeholder="Hinweis für die ausfüllende Person"
            onChange={(e) => props.onChange({ description: e.target.value })}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="grid gap-2">
            <Label htmlFor={`type-${q.id}`}>Typ</Label>
            <Select
              id={`type-${q.id}`}
              value={q.type}
              onChange={(e) =>
                props.onReplace(
                  applyReviewQuestionType(q, e.target.value as SurveyFieldType),
                )
              }
            >
              {SURVEY_FIELD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {SURVEY_FIELD_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <Checkbox
              checked={q.required}
              onCheckedChange={(checked) =>
                props.onChange({ required: Boolean(checked) })
              }
            />
            Pflichtfeld
          </label>
        </div>

        {q.type === "rating" ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor={`scale-min-${q.id}`}>Skala von</Label>
              <Input
                id={`scale-min-${q.id}`}
                type="number"
                value={q.scaleMin ?? 1}
                onChange={(e) =>
                  props.onChange({ scaleMin: Number.parseInt(e.target.value, 10) || 1 })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`scale-max-${q.id}`}>bis</Label>
              <Input
                id={`scale-max-${q.id}`}
                type="number"
                value={q.scaleMax ?? 5}
                onChange={(e) =>
                  props.onChange({ scaleMax: Number.parseInt(e.target.value, 10) || 5 })
                }
              />
            </div>
          </div>
        ) : null}

        {needsOptions(q.type) ? (
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label>{q.type === "text_list" ? "Leere Antwortfelder" : "Optionen"}</Label>
              <Button type="button" size="sm" variant="outline" onClick={addOption}>
                <Plus className="mr-2 size-4" />
                {q.type === "text_list" ? "Feld" : "Option"}
              </Button>
            </div>
            {q.options.map((opt) => (
              <div key={opt.id} className="flex items-center gap-2">
                <Input
                  value={opt.label}
                  onChange={(e) => updateOption(opt.id, e.target.value)}
                  placeholder={q.type === "text_list" ? "optionales Label, sonst Nummer" : "Option"}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => removeOption(opt.id)}
                  disabled={q.options.length <= optionMin}
                  aria-label="Option entfernen"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            {q.type === "text_list" ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={q.allowExtraEntries !== false}
                  onCheckedChange={(checked) =>
                    props.onChange({ allowExtraEntries: Boolean(checked) })
                  }
                />
                Zusätzliche freie Eingaben erlauben
              </label>
            ) : q.type === "ranking" ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={q.allowCustomEntries !== false}
                  onCheckedChange={(checked) =>
                    props.onChange({ allowCustomEntries: Boolean(checked) })
                  }
                />
                Eigene Ranking-Optionen erlauben
              </label>
            ) : (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={
                    q.type === "radio"
                      ? q.allowOtherOption === true
                      : q.allowOtherOption !== false
                  }
                  onCheckedChange={(checked) =>
                    props.onChange({ allowOtherOption: Boolean(checked) })
                  }
                />
                Andere-Option erlauben
              </label>
            )}
          </div>
        ) : null}

        {q.type === "text" || q.type === "radio" ? (
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={`answer-${q.id}`}>Antwort-Vorschlag</Label>
              {q.answer.trim() ? (
                <button
                  type="button"
                  className="text-xs font-medium text-secondary underline-offset-2 hover:underline"
                  onClick={() =>
                    props.onChange({
                      answer: "",
                      answerSource: "none",
                      answerNote: "Manuell geleert",
                    })
                  }
                >
                  Antwort leeren (veraltet)
                </button>
              ) : null}
            </div>
            <Textarea
              id={`answer-${q.id}`}
              value={q.answer}
              rows={2}
              placeholder="Noch keine Vorausfüllung — später im Fragebogen ausfüllen"
              onChange={(e) =>
                props.onChange({
                  answer: e.target.value,
                  answerSource: e.target.value.trim()
                    ? q.answerSource === "none"
                      ? "ai"
                      : q.answerSource
                    : "none",
                  answerNote:
                    e.target.value.trim() && q.answerSource === "none"
                      ? "Manuell ergänzt"
                      : q.answerNote,
                })
              }
            />
            {q.answerNote ? <p className="text-xs text-secondary">{q.answerNote}</p> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
