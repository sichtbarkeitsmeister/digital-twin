"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  Eye,
  Pencil,
  Plus,
  RefreshCcw,
  Trash2,
  Upload,
} from "lucide-react";

import type {
  Survey,
  SurveyField,
  SurveyFieldType,
  SurveyOption,
  SurveyStep,
} from "@/lib/surveys/types";
import { surveySchema } from "@/lib/surveys/schema";
import {
  clearDraftSurvey,
  loadDraftSurvey,
  saveDraftSurvey,
} from "@/lib/surveys/storage";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

import { SurveyProgress } from "@/app/dashboard/_components/surveys/survey-progress";

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function createDefaultSurvey(): Survey {
  return {
    version: 1,
    id: createId(),
    title: "",
    description: "",
    steps: [
      {
        id: createId(),
        title: "Step 1",
        description: "",
        fields: [],
      },
    ],
  };
}

function createDefaultField(type: SurveyFieldType): SurveyField {
  const base = {
    id: createId(),
    title: "",
    description: "",
    required: false,
  };
  if (type === "text") {
    return { ...base, type: "text", placeholder: "" };
  }
  if (type === "rating") {
    return { ...base, type: "rating", scale: { min: 1, max: 5 } };
  }
  const options: SurveyOption[] = [
    { id: createId(), label: "Option 1" },
  ];
  if (type === "radio") return { ...base, type: "radio", options };
  return { ...base, type: "checkbox", options };
}

function moveItem<T>(arr: T[], from: number, to: number) {
  if (from === to) return arr;
  const copy = [...arr];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item as T);
  return copy;
}

type PreviewAnswers = Record<string, unknown>;

export function SurveyBuilder() {
  const [mode, setMode] = React.useState<"edit" | "preview">("edit");
  const [survey, setSurvey] = React.useState<Survey>(() => createDefaultSurvey());
  const [currentStepIndex, setCurrentStepIndex] = React.useState(0);

  const [importJson, setImportJson] = React.useState("");
  const [exportJson, setExportJson] = React.useState("");
  const [status, setStatus] = React.useState<{ kind: "ok" | "error"; message: string } | null>(null);

  const [previewStepIndex, setPreviewStepIndex] = React.useState(0);
  const [previewAnswers, setPreviewAnswers] = React.useState<PreviewAnswers>({});

  // Initial load
  React.useEffect(() => {
    const draft = loadDraftSurvey();
    if (draft) {
      setSurvey(draft);
      setCurrentStepIndex(0);
      setStatus({ kind: "ok", message: "Draft loaded from local storage." });
    }
  }, []);

  // Autosave (debounced)
  React.useEffect(() => {
    const handle = window.setTimeout(() => {
      saveDraftSurvey(survey);
    }, 400);
    return () => window.clearTimeout(handle);
  }, [survey]);

  // Keep indices safe when steps change
  React.useEffect(() => {
    setCurrentStepIndex((idx) => Math.min(Math.max(idx, 0), Math.max(survey.steps.length - 1, 0)));
    setPreviewStepIndex((idx) => Math.min(Math.max(idx, 0), Math.max(survey.steps.length - 1, 0)));
  }, [survey.steps.length]);

  const steps = survey.steps;
  const currentStep = steps[currentStepIndex] ?? steps[0];

  function updateSurvey(patch: Partial<Survey>) {
    setSurvey((s) => ({ ...s, ...patch }));
  }

  function updateStep(stepId: string, patch: Partial<SurveyStep>) {
    setSurvey((s) => ({
      ...s,
      steps: s.steps.map((st) => (st.id === stepId ? { ...st, ...patch } : st)),
    }));
  }

  function addStep() {
    setSurvey((s) => {
      const nextIndex = s.steps.length + 1;
      const newStep: SurveyStep = {
        id: createId(),
        title: `Step ${nextIndex}`,
        description: "",
        fields: [],
      };
      return { ...s, steps: [...s.steps, newStep] };
    });
    setCurrentStepIndex(steps.length);
    setStatus(null);
  }

  function removeStep(stepId: string) {
    setSurvey((s) => {
      if (s.steps.length <= 1) return s;
      const nextSteps = s.steps.filter((st) => st.id !== stepId);
      return { ...s, steps: nextSteps.length ? nextSteps : s.steps };
    });
    setStatus(null);
  }

  function moveStep(stepIndex: number, dir: -1 | 1) {
    setSurvey((s) => {
      const to = stepIndex + dir;
      if (to < 0 || to >= s.steps.length) return s;
      return { ...s, steps: moveItem(s.steps, stepIndex, to) };
    });
    setCurrentStepIndex((idx) => {
      if (idx === stepIndex) return idx + dir;
      if (idx === stepIndex + dir) return idx - dir;
      return idx;
    });
  }

  function addField(stepId: string, type: SurveyFieldType) {
    const field = createDefaultField(type);
    setSurvey((s) => ({
      ...s,
      steps: s.steps.map((st) =>
        st.id === stepId ? { ...st, fields: [...st.fields, field] } : st,
      ),
    }));
    setStatus(null);
  }

  function updateField(stepId: string, fieldId: string, patch: Partial<SurveyField>) {
    setSurvey((s) => ({
      ...s,
      steps: s.steps.map((st) => {
        if (st.id !== stepId) return st;
        return {
          ...st,
          fields: st.fields.map((f) => (f.id === fieldId ? ({ ...f, ...patch } as SurveyField) : f)),
        };
      }),
    }));
  }

  function removeField(stepId: string, fieldId: string) {
    setSurvey((s) => ({
      ...s,
      steps: s.steps.map((st) =>
        st.id === stepId ? { ...st, fields: st.fields.filter((f) => f.id !== fieldId) } : st,
      ),
    }));
  }

  function moveField(stepId: string, fieldIndex: number, dir: -1 | 1) {
    setSurvey((s) => ({
      ...s,
      steps: s.steps.map((st) => {
        if (st.id !== stepId) return st;
        const to = fieldIndex + dir;
        if (to < 0 || to >= st.fields.length) return st;
        return { ...st, fields: moveItem(st.fields, fieldIndex, to) };
      }),
    }));
  }

  function updateOption(stepId: string, fieldId: string, optionId: string, patch: Partial<SurveyOption>) {
    setSurvey((s) => ({
      ...s,
      steps: s.steps.map((st) => {
        if (st.id !== stepId) return st;
        return {
          ...st,
          fields: st.fields.map((f) => {
            if (f.id !== fieldId) return f;
            if (f.type !== "radio" && f.type !== "checkbox") return f;
            return {
              ...f,
              options: f.options.map((o) => (o.id === optionId ? { ...o, ...patch } : o)),
            };
          }),
        };
      }),
    }));
  }

  function addOption(stepId: string, fieldId: string) {
    setSurvey((s) => ({
      ...s,
      steps: s.steps.map((st) => {
        if (st.id !== stepId) return st;
        return {
          ...st,
          fields: st.fields.map((f) => {
            if (f.id !== fieldId) return f;
            if (f.type !== "radio" && f.type !== "checkbox") return f;
            const nextNum = f.options.length + 1;
            return {
              ...f,
              options: [...f.options, { id: createId(), label: `Option ${nextNum}` }],
            };
          }),
        };
      }),
    }));
  }

  function removeOption(stepId: string, fieldId: string, optionId: string) {
    setSurvey((s) => ({
      ...s,
      steps: s.steps.map((st) => {
        if (st.id !== stepId) return st;
        return {
          ...st,
          fields: st.fields.map((f) => {
            if (f.id !== fieldId) return f;
            if (f.type !== "radio" && f.type !== "checkbox") return f;
            if (f.options.length <= 1) return f;
            return {
              ...f,
              options: f.options.filter((o) => o.id !== optionId),
            };
          }),
        };
      }),
    }));
  }

  function enterPreview() {
    setMode("preview");
    setPreviewStepIndex(currentStepIndex);
    setStatus(null);
  }

  function exitPreview() {
    setMode("edit");
    setCurrentStepIndex(previewStepIndex);
    setStatus(null);
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus({ kind: "ok", message: "Copied to clipboard." });
    } catch {
      setStatus({ kind: "error", message: "Could not copy to clipboard." });
    }
  }

  function downloadJson(filename: string, text: string) {
    try {
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setStatus({ kind: "error", message: "Could not download JSON." });
    }
  }

  function exportSurvey() {
    const json = JSON.stringify(survey, null, 2);
    setExportJson(json);
    setStatus({ kind: "ok", message: "Export prepared below." });
  }

  function importSurveyFromText(text: string) {
    try {
      const parsedJson: unknown = JSON.parse(text);
      const parsed = surveySchema.safeParse(parsedJson);
      if (!parsed.success) {
        const msg = parsed.error.issues[0]?.message ?? "Invalid survey JSON.";
        setStatus({ kind: "error", message: msg });
        return;
      }
      setSurvey(parsed.data as Survey);
      setCurrentStepIndex(0);
      setPreviewAnswers({});
      setStatus({ kind: "ok", message: "Imported survey JSON." });
    } catch {
      setStatus({ kind: "error", message: "Invalid JSON (parse error)." });
    }
  }

  function resetDraft() {
    clearDraftSurvey();
    setSurvey(createDefaultSurvey());
    setCurrentStepIndex(0);
    setPreviewAnswers({});
    setImportJson("");
    setExportJson("");
    setStatus({ kind: "ok", message: "Draft reset." });
  }

  return (
    <div className="grid gap-6">
      {mode === "edit" ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="grid gap-1">
            <p className="text-sm text-secondary">
              <Link
                href="/dashboard/members"
                prefetch
                className="hover:text-primary transition-colors"
              >
                ← Back to dashboard
              </Link>
            </p>
            <h1 className="text-3xl font-bold tracking-tight">Survey builder</h1>
            <p className="text-secondary">
              Create flexible multi-step surveys. Draft is stored locally.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/dashboard/members" prefetch>
              Done
            </Link>
          </Button>
        </div>
      ) : null}

      {status ? (
        <div className={cn("text-sm", status.kind === "ok" ? "text-secondary" : "text-red-400")}>
          {status.message}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {mode === "edit" ? (
          <>
            <Button onClick={enterPreview} variant="secondary">
              <Eye className="mr-2 h-4 w-4" />
              Preview
            </Button>
            <Button onClick={exportSurvey} variant="outline">
              <Download className="mr-2 h-4 w-4" />
              Export JSON
            </Button>
            <Button
              onClick={() => {
                if (!importJson.trim()) {
                  setStatus({ kind: "error", message: "Paste JSON in the import box first." });
                  return;
                }
                importSurveyFromText(importJson);
              }}
              variant="outline"
            >
              <Upload className="mr-2 h-4 w-4" />
              Import JSON
            </Button>
            <Button onClick={resetDraft} variant="ghost">
              <RefreshCcw className="mr-2 h-4 w-4" />
              Reset draft
            </Button>
          </>
        ) : null}
      </div>

      {mode === "edit" ? (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Survey</CardTitle>
              <CardDescription>Title/description and steps.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="survey_title">Title</Label>
                <Input
                  id="survey_title"
                  value={survey.title}
                  onChange={(e) => updateSurvey({ title: e.target.value })}
                  placeholder="e.g. Customer onboarding survey"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="survey_desc">Description</Label>
                <Textarea
                  id="survey_desc"
                  value={survey.description}
                  onChange={(e) => updateSurvey({ description: e.target.value })}
                  placeholder="Optional short description…"
                />
              </div>

              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">Steps</p>
                <Button onClick={addStep} size="sm" variant="outline">
                  <Plus className="mr-2 h-4 w-4" />
                  Add step
                </Button>
              </div>

              <div className="grid gap-2">
                {steps.map((st, idx) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => setCurrentStepIndex(idx)}
                    className={cn(
                      "w-full text-left rounded-lg border px-3 py-2 transition-colors",
                      idx === currentStepIndex ? "bg-accent" : "hover:bg-accent/50",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="grid gap-0.5">
                        <p className="text-sm font-medium">{st.title || `Step ${idx + 1}`}</p>
                        {st.description ? (
                          <p className="text-xs text-secondary line-clamp-2">{st.description}</p>
                        ) : (
                          <p className="text-xs text-secondary">No description</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            moveStep(idx, -1);
                          }}
                          disabled={idx === 0}
                          aria-label="Move step up"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            moveStep(idx, 1);
                          }}
                          disabled={idx === steps.length - 1}
                          aria-label="Move step down"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            removeStep(st.id);
                          }}
                          disabled={steps.length <= 1}
                          aria-label="Delete step"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <Card className="border-dashed">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Import / Export</CardTitle>
                  <CardDescription>Paste JSON, or export the current draft.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="survey_import">Import JSON</Label>
                    <Textarea
                      id="survey_import"
                      value={importJson}
                      onChange={(e) => setImportJson(e.target.value)}
                      placeholder='Paste survey JSON here (must include "version": 1)…'
                      className="font-mono text-xs"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (!importJson.trim()) {
                            setStatus({ kind: "error", message: "Paste JSON first." });
                            return;
                          }
                          importSurveyFromText(importJson);
                        }}
                      >
                        <Upload className="mr-2 h-4 w-4" />
                        Import
                      </Button>
                      <label className="inline-flex items-center gap-2 text-sm text-secondary cursor-pointer">
                        <input
                          type="file"
                          accept="application/json"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const text = await file.text();
                            setImportJson(text);
                            importSurveyFromText(text);
                            e.currentTarget.value = "";
                          }}
                        />
                        <span className="inline-flex items-center gap-2">
                          <Upload className="h-4 w-4" />
                          Import from file
                        </span>
                      </label>
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="survey_export">Export JSON</Label>
                    <Textarea
                      id="survey_export"
                      value={exportJson}
                      onChange={(e) => setExportJson(e.target.value)}
                      placeholder="Click “Export JSON” above to populate this…"
                      className="font-mono text-xs"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const json = exportJson.trim() ? exportJson : JSON.stringify(survey, null, 2);
                          copyText(json);
                        }}
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        Copy
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const json = exportJson.trim() ? exportJson : JSON.stringify(survey, null, 2);
                          downloadJson(`survey-${survey.id}.json`, json);
                        }}
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </CardContent>
          </Card>

          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>{currentStep?.title || `Step ${currentStepIndex + 1}`}</CardTitle>
                <CardDescription>Edit step title, description and fields.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="step_title">Step title</Label>
                  <Input
                    id="step_title"
                    value={currentStep?.title ?? ""}
                    onChange={(e) => updateStep(currentStep.id, { title: e.target.value })}
                    placeholder={`Step ${currentStepIndex + 1}`}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="step_desc">Step description</Label>
                  <Textarea
                    id="step_desc"
                    value={currentStep?.description ?? ""}
                    onChange={(e) => updateStep(currentStep.id, { description: e.target.value })}
                    placeholder="Optional step description…"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Fields</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                      defaultValue="text"
                      onChange={(e) => {
                        const type = e.target.value as SurveyFieldType;
                        addField(currentStep.id, type);
                        e.currentTarget.value = "text";
                      }}
                    >
                      <option value="text">Add text input</option>
                      <option value="radio">Add radio</option>
                      <option value="checkbox">Add multi checkbox</option>
                      <option value="rating">Add 1–5 rating</option>
                    </select>
                  </div>
                </div>

                {currentStep.fields.length === 0 ? (
                  <p className="text-sm text-secondary">
                    No fields yet. Add one using the dropdown above.
                  </p>
                ) : (
                  <div className="grid gap-3">
                    {currentStep.fields.map((field, fieldIndex) => (
                      <Card key={field.id}>
                        <CardHeader className="pb-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="grid gap-1">
                              <CardTitle className="text-base">
                                {field.title || "Untitled field"}
                              </CardTitle>
                              <CardDescription>
                                Type: <span className="font-medium">{field.type}</span>
                                {field.required ? " · required" : ""}
                              </CardDescription>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                onClick={() => moveField(currentStep.id, fieldIndex, -1)}
                                disabled={fieldIndex === 0}
                                aria-label="Move field up"
                              >
                                <ArrowUp className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                onClick={() => moveField(currentStep.id, fieldIndex, 1)}
                                disabled={fieldIndex === currentStep.fields.length - 1}
                                aria-label="Move field down"
                              >
                                <ArrowDown className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                onClick={() => removeField(currentStep.id, field.id)}
                                aria-label="Delete field"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="grid gap-4">
                          <div className="grid gap-2">
                            <Label>Field title</Label>
                            <Input
                              value={field.title}
                              onChange={(e) => updateField(currentStep.id, field.id, { title: e.target.value })}
                              placeholder="Question title"
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label>Field description</Label>
                            <Textarea
                              value={field.description}
                              onChange={(e) =>
                                updateField(currentStep.id, field.id, { description: e.target.value })
                              }
                              placeholder="Optional hint / description…"
                            />
                          </div>
                          <label className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={field.required}
                              onCheckedChange={(checked) =>
                                updateField(currentStep.id, field.id, { required: Boolean(checked) })
                              }
                            />
                            Required
                          </label>

                          {field.type === "text" ? (
                            <div className="grid gap-2">
                              <Label>Placeholder</Label>
                              <Input
                                value={field.placeholder}
                                onChange={(e) =>
                                  updateField(currentStep.id, field.id, { placeholder: e.target.value })
                                }
                                placeholder="e.g. Your answer…"
                              />
                            </div>
                          ) : null}

                          {field.type === "rating" ? (
                            <div className="grid gap-2">
                              <Label>Scale</Label>
                              <div className="text-sm text-secondary">
                                Fixed for now: {field.scale.min}–{field.scale.max}
                              </div>
                            </div>
                          ) : null}

                          {field.type === "radio" || field.type === "checkbox" ? (
                            <div className="grid gap-2">
                              <div className="flex items-center justify-between gap-2">
                                <Label>Options</Label>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => addOption(currentStep.id, field.id)}
                                >
                                  <Plus className="mr-2 h-4 w-4" />
                                  Add option
                                </Button>
                              </div>
                              <div className="grid gap-2">
                                {field.options.map((opt) => (
                                  <div key={opt.id} className="flex items-center gap-2">
                                    <Input
                                      value={opt.label}
                                      onChange={(e) =>
                                        updateOption(currentStep.id, field.id, opt.id, { label: e.target.value })
                                      }
                                    />
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => removeOption(currentStep.id, field.id, opt.id)}
                                      disabled={field.options.length <= 1}
                                      aria-label="Remove option"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <SurveyPreviewOverlay>
          <SurveyPreview
            survey={survey}
            stepIndex={previewStepIndex}
            setStepIndex={setPreviewStepIndex}
            answers={previewAnswers}
            setAnswers={setPreviewAnswers}
            onExitPreview={exitPreview}
          />
        </SurveyPreviewOverlay>
      )}
    </div>
  );
}

function SurveyPreviewOverlay({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    if (!mounted) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] background-primary text-primary overflow-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-6">{children}</div>
    </div>,
    document.body,
  );
}

function SurveyPreview({
  survey,
  stepIndex,
  setStepIndex,
  answers,
  setAnswers,
  onExitPreview,
}: {
  survey: Survey;
  stepIndex: number;
  setStepIndex: (idx: number) => void;
  answers: PreviewAnswers;
  setAnswers: React.Dispatch<React.SetStateAction<PreviewAnswers>>;
  onExitPreview: () => void;
}) {
  const steps = survey.steps;
  const step = steps[stepIndex] ?? steps[0];
  const canBack = stepIndex > 0;
  const canNext = stepIndex < steps.length - 1;

  React.useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
  }, [stepIndex]);

  function setAnswer(fieldId: string, value: unknown) {
    setAnswers((a) => ({ ...a, [fieldId]: value }));
  }

  return (
    <div className="grid gap-6">
      <div className="sticky top-0 z-40 -mx-4 px-4 py-3 bg-background/80 backdrop-blur border-b">
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-0.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-secondary">
                Preview
              </p>
              <p className="text-sm text-secondary">
                {survey.title || "Untitled survey"}
              </p>
            </div>
            <Button onClick={onExitPreview} variant="secondary" size="sm">
              <Pencil className="mr-2 h-4 w-4" />
              Exit preview
            </Button>
          </div>

          <SurveyProgress steps={steps} currentStepIndex={stepIndex} />

          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!canBack}
              onClick={() => setStepIndex(stepIndex - 1)}
            >
              Back
            </Button>
            <div />
            <Button
              type="button"
              variant="outline"
              disabled={!canNext}
              onClick={() => setStepIndex(stepIndex + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{survey.title || "Untitled survey"}</CardTitle>
          {survey.description ? <CardDescription>{survey.description}</CardDescription> : null}
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{step?.title || `Step ${stepIndex + 1}`}</CardTitle>
          {step?.description ? <CardDescription>{step.description}</CardDescription> : null}
        </CardHeader>
        <CardContent className="grid gap-4">
          {step.fields.length === 0 ? (
            <p className="text-sm text-secondary">No fields in this step.</p>
          ) : (
            <div className="grid gap-4">
              {step.fields.map((field) => (
                <div key={field.id} className="grid gap-2">
                  <div className="grid gap-1">
                    <p className="text-sm font-semibold">
                      {field.title || "Untitled field"}{" "}
                      {field.required ? <span className="text-red-400">*</span> : null}
                    </p>
                    {field.description ? (
                      <p className="text-sm text-secondary">{field.description}</p>
                    ) : null}
                  </div>

                  {field.type === "text" ? (
                    <Input
                      value={(answers[field.id] as string) ?? ""}
                      onChange={(e) => setAnswer(field.id, e.target.value)}
                      placeholder={field.placeholder || "Your answer…"}
                    />
                  ) : null}

                  {field.type === "radio" ? (
                    <div className="grid gap-2">
                      {field.options.map((opt) => {
                        const selected = answers[field.id] === opt.id;
                        return (
                          <label key={opt.id} className="flex items-center gap-2 text-sm">
                            <input
                              type="radio"
                              name={field.id}
                              checked={selected}
                              onChange={() => setAnswer(field.id, opt.id)}
                            />
                            {opt.label}
                          </label>
                        );
                      })}
                    </div>
                  ) : null}

                  {field.type === "checkbox" ? (
                    <div className="grid gap-2">
                      {field.options.map((opt) => {
                        const set = new Set((answers[field.id] as string[]) ?? []);
                        const checked = set.has(opt.id);
                        return (
                          <label key={opt.id} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(next) => {
                                const nextSet = new Set((answers[field.id] as string[]) ?? []);
                                if (next) nextSet.add(opt.id);
                                else nextSet.delete(opt.id);
                                setAnswer(field.id, Array.from(nextSet));
                              }}
                            />
                            {opt.label}
                          </label>
                        );
                      })}
                    </div>
                  ) : null}

                  {field.type === "rating" ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {Array.from({ length: field.scale.max - field.scale.min + 1 }).map((_, i) => {
                        const value = field.scale.min + i;
                        const selected = answers[field.id] === value;
                        return (
                          <Button
                            key={value}
                            type="button"
                            variant={selected ? "default" : "outline"}
                            size="sm"
                            onClick={() => setAnswer(field.id, value)}
                          >
                            {value}
                          </Button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-2">
            <Button type="button" variant="outline" disabled={!canBack} onClick={() => setStepIndex(stepIndex - 1)}>
              Back
            </Button>
            <div />
            <Button type="button" variant="outline" disabled={!canNext} onClick={() => setStepIndex(stepIndex + 1)}>
              Next
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end">
        <Button onClick={onExitPreview} variant="secondary">
          <Pencil className="mr-2 h-4 w-4" />
          Exit preview
        </Button>
      </div>
    </div>
  );
}

