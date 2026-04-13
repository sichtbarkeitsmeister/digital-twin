"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  Eye,
  Globe,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCcw,
  Save,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import type {
  Survey,
  SurveyField,
  SurveyFieldType,
  SurveyOption,
  SurveyStep,
} from "@/lib/surveys/types";
import { SurveyRankingInput } from "@/components/surveys/survey-ranking-input";
import { surveySchema } from "@/lib/surveys/schema";
import {
  clearDraftSurvey,
  loadDraftSurvey,
  saveDraftSurvey,
} from "@/lib/surveys/storage";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

import { SurveyProgress } from "@/app/dashboard/_components/surveys/survey-progress";
import {
  publishSurveyAction,
  unpublishSurveyAction,
  upsertSurveyDraftAction,
} from "@/app/dashboard/surveys/actions";

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
        title: "Schritt 1",
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
  const options: SurveyOption[] = [{ id: createId(), label: "Option 1" }];
  if (type === "radio") return { ...base, type: "radio", options };
  if (type === "checkbox") return { ...base, type: "checkbox", options };
  return {
    ...base,
    type: "ranking",
    options: [...options, { id: createId(), label: "Option 2" }],
    allowCustomEntries: true,
  };
}

function moveItem<T>(arr: T[], from: number, to: number) {
  if (from === to) return arr;
  const copy = [...arr];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item as T);
  return copy;
}

type PreviewAnswers = Record<string, unknown>;

type Props = {
  surveyId?: string;
  initialSurvey?: Survey;
  initialVisibility?: "private" | "public";
  initialSlug?: string | null;
  initialNotificationEmails?: string[];
};

export function SurveyBuilder({
  surveyId: initialSurveyId,
  initialSurvey,
  initialVisibility = "private",
  initialSlug = null,
  initialNotificationEmails = [],
}: Props) {
  const router = useRouter();
  const [mode, setMode] = React.useState<"edit" | "preview">("edit");
  const [survey, setSurvey] = React.useState<Survey>(
    () => initialSurvey ?? createDefaultSurvey(),
  );
  const [currentStepIndex, setCurrentStepIndex] = React.useState(0);

  const [dbSurveyId, setDbSurveyId] = React.useState<string | null>(
    initialSurveyId ?? null,
  );
  const [visibility, setVisibility] = React.useState<"private" | "public">(
    initialVisibility,
  );
  const [slug, setSlug] = React.useState<string | null>(initialSlug);

  const [notificationEmails, setNotificationEmails] = React.useState<string[]>(() =>
    normalizeEmails(initialNotificationEmails ?? []),
  );
  const [notificationEmailDraft, setNotificationEmailDraft] = React.useState("");

  const [importJson, setImportJson] = React.useState("");
  const [exportJson, setExportJson] = React.useState("");
  const [jsonModal, setJsonModal] = React.useState<null | { mode: "export" | "import" }>(
    null,
  );
  const [status, setStatus] = React.useState<{
    kind: "ok" | "error";
    message: string;
  } | null>(null);

  const [previewStepIndex, setPreviewStepIndex] = React.useState(0);
  const [previewAnswers, setPreviewAnswers] = React.useState<PreviewAnswers>(
    {},
  );

  // Initial load
  React.useEffect(() => {
    if (initialSurvey) return;
    const draft = loadDraftSurvey();
    if (draft) {
      setSurvey(draft);
      setCurrentStepIndex(0);
      setStatus({ kind: "ok", message: "Entwurf aus dem lokalen Speicher geladen." });
    }
  }, [initialSurvey]);

  // Autosave (debounced)
  React.useEffect(() => {
    const handle = window.setTimeout(() => {
      saveDraftSurvey(survey);
    }, 400);
    return () => window.clearTimeout(handle);
  }, [survey]);

  // Keep indices safe when steps change
  React.useEffect(() => {
    setCurrentStepIndex((idx) =>
      Math.min(Math.max(idx, 0), Math.max(survey.steps.length - 1, 0)),
    );
    setPreviewStepIndex((idx) =>
      Math.min(Math.max(idx, 0), Math.max(survey.steps.length - 1, 0)),
    );
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
        title: `Schritt ${nextIndex}`,
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

  function updateField(
    stepId: string,
    fieldId: string,
    patch: Partial<SurveyField>,
  ) {
    setSurvey((s) => ({
      ...s,
      steps: s.steps.map((st) => {
        if (st.id !== stepId) return st;
        return {
          ...st,
          fields: st.fields.map((f) =>
            f.id === fieldId ? ({ ...f, ...patch } as SurveyField) : f,
          ),
        };
      }),
    }));
  }

  function removeField(stepId: string, fieldId: string) {
    setSurvey((s) => ({
      ...s,
      steps: s.steps.map((st) =>
        st.id === stepId
          ? { ...st, fields: st.fields.filter((f) => f.id !== fieldId) }
          : st,
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

  function updateOption(
    stepId: string,
    fieldId: string,
    optionId: string,
    patch: Partial<SurveyOption>,
  ) {
    setSurvey((s) => ({
      ...s,
      steps: s.steps.map((st) => {
        if (st.id !== stepId) return st;
        return {
          ...st,
          fields: st.fields.map((f) => {
            if (f.id !== fieldId) return f;
            if (
              f.type !== "radio" &&
              f.type !== "checkbox" &&
              f.type !== "ranking"
            ) {
              return f;
            }
            return {
              ...f,
              options: f.options.map((o) =>
                o.id === optionId ? { ...o, ...patch } : o,
              ),
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
            if (
              f.type !== "radio" &&
              f.type !== "checkbox" &&
              f.type !== "ranking"
            ) {
              return f;
            }
            const nextNum = f.options.length + 1;
            return {
              ...f,
              options: [
                ...f.options,
                { id: createId(), label: `Option ${nextNum}` },
              ],
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
            if (
              f.type !== "radio" &&
              f.type !== "checkbox" &&
              f.type !== "ranking"
            ) {
              return f;
            }
            const minOptions = f.type === "ranking" ? 2 : 1;
            if (f.options.length <= minOptions) return f;
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
    } catch {
      setStatus({ kind: "error", message: "Kopieren fehlgeschlagen." });
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
      setStatus({ kind: "error", message: "Download fehlgeschlagen." });
    }
  }

  function exportSurvey() {
    const json = JSON.stringify(survey, null, 2);
    setExportJson(json);
    setStatus(null);
  }

  function importSurveyFromText(text: string) {
    try {
      const parsedJson: unknown = JSON.parse(text);
      const parsed = surveySchema.safeParse(parsedJson);
      if (!parsed.success) {
        const msg = parsed.error.issues[0]?.message ?? "Ungültiges Umfrage-JSON.";
        setStatus({ kind: "error", message: msg });
        return;
      }
      setSurvey(parsed.data as Survey);
      setCurrentStepIndex(0);
      setPreviewAnswers({});
      setStatus({ kind: "ok", message: "Umfrage-JSON importiert." });
    } catch {
      setStatus({ kind: "error", message: "Ungültiges JSON (Parse-Fehler)." });
    }
  }

  function resetDraft() {
    clearDraftSurvey();
    setSurvey(createDefaultSurvey());
    setCurrentStepIndex(0);
    setPreviewAnswers({});
    setImportJson("");
    setExportJson("");
    setDbSurveyId(null);
    setVisibility("private");
    setSlug(null);
    setStatus({ kind: "ok", message: "Entwurf zurückgesetzt." });
  }

  function openJsonExport() {
    exportSurvey();
    setJsonModal({ mode: "export" });
  }

  function openJsonImport() {
    setJsonModal({ mode: "import" });
  }

  async function saveDraftToDatabase() {
    const wasNew = !dbSurveyId;
    const invalid = notificationEmails.find((e) => !isValidEmail(e));
    if (invalid) {
      setStatus({ kind: "error", message: `Ungültige E-Mail: ${invalid}` });
      return null;
    }
    const res = await upsertSurveyDraftAction({
      surveyId: dbSurveyId ?? undefined,
      title: survey.title,
      description: survey.description,
      notificationEmails,
      definition: survey,
    });

    if (!res.ok || !res.data?.surveyId) {
      setStatus({ kind: "error", message: res.message });
      return null;
    }

    setDbSurveyId(res.data.surveyId);
    setStatus({ kind: "ok", message: res.message });

    // If we created a new survey, switch URL into edit mode.
    if (wasNew) {
      router.push(`/dashboard/surveys/${res.data.surveyId}/edit`);
    }

    return res.data.surveyId;
  }

  async function publishSurvey() {
    const id = dbSurveyId ?? (await saveDraftToDatabase());
    if (!id) return;

    const res = await publishSurveyAction({ surveyId: id });
    if (!res.ok || !res.data?.slug) {
      setStatus({ kind: "error", message: res.message });
      return;
    }

    setVisibility("public");
    setSlug(res.data.slug);
    setStatus({
      kind: "ok",
      message: `Veröffentlicht. Öffentlicher Link: /s/${res.data.slug}`,
    });
  }

  async function makePrivate() {
    if (!dbSurveyId) {
      setStatus({ kind: "error", message: "Bitte zuerst den Entwurf speichern." });
      return;
    }

    const res = await unpublishSurveyAction({ surveyId: dbSurveyId });
    if (!res.ok) {
      setStatus({ kind: "error", message: res.message });
      return;
    }

    setVisibility("private");
    setStatus({ kind: "ok", message: "Umfrage ist jetzt privat." });
  }

  return (
    <div className="grid gap-6">
      {mode === "edit" ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid gap-1">
            <p className="text-sm text-secondary">
              <Link
                href="/dashboard/surveys"
                prefetch
                className="hover:text-primary transition-colors"
              >
                ← Zurück zu Umfragen
              </Link>
            </p>
            <h1 className="text-3xl font-bold tracking-tight">
              Umfrage-Builder
            </h1>
            <p className="text-secondary">
              Erstelle flexible Umfragen mit mehreren Schritten. Der Entwurf wird lokal automatisch gespeichert; nutze
              „Entwurf speichern“, um in der Datenbank zu speichern.
            </p>
          </div>
        </div>
      ) : null}

      {status ? (
        <div
          className={cn(
            "text-sm",
            status.kind === "ok" ? "text-secondary" : "text-red-400",
          )}
        >
          {status.message}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {mode === "edit" ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {visibility === "public" ? (
                <Button onClick={makePrivate} variant="secondary">
                  <Lock className="mr-2 h-4 w-4" />
                  Privat machen
                </Button>
              ) : (
                <Button onClick={publishSurvey}>
                  <Globe className="mr-2 h-4 w-4" />
                  Veröffentlichen
                </Button>
              )}

              {visibility === "public" && slug ? (
                <Button
                  onClick={() => {
                    const path = `/s/${slug}`;
                    copyText(`${window.location.origin}${path}`);
                  }}
                  variant="outline"
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Öffentlichen Link kopieren
                </Button>
              ) : null}

              <Button onClick={enterPreview} variant="secondary">
                <Eye className="mr-2 h-4 w-4" />
                Vorschau
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Mehr Aktionen"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={openJsonExport}>
                    <Download className="h-4 w-4" />
                    JSON exportieren
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={openJsonImport}>
                    <Upload className="h-4 w-4" />
                    JSON importieren
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={resetDraft}>
                    <RefreshCcw className="h-4 w-4" />
                    Entwurf zurücksetzen
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <Button onClick={saveDraftToDatabase}>
                <Save className="mr-2 h-4 w-4" />
                {visibility === "public" ? "Speichern" : "Entwurf speichern"}
              </Button>
              <Button asChild variant="outline">
                <Link href="/dashboard/surveys" prefetch>
                  Fertig
                </Link>
              </Button>
            </div>
          </>
        ) : (
          <div />
        )}
      </div>

      {mode === "edit" ? (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Umfrage</CardTitle>
              <CardDescription>Titel/Beschreibung und Schritte.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="survey_title">Titel</Label>
                <Input
                  id="survey_title"
                  value={survey.title}
                  onChange={(e) => updateSurvey({ title: e.target.value })}
                  placeholder="z.B. Kunden-Onboarding-Umfrage"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="survey_desc">Beschreibung</Label>
                <Textarea
                  id="survey_desc"
                  value={survey.description}
                  onChange={(e) =>
                    updateSurvey({ description: e.target.value })
                  }
                  placeholder="Optionale kurze Beschreibung…"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="survey_notifications">Benachrichtigungs-E-Mails</Label>
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      id="survey_notifications"
                      value={notificationEmailDraft}
                      onChange={(e) => setNotificationEmailDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        const next = parseNotificationEmailsFromText(
                          notificationEmailDraft,
                        );
                        if (next.length === 0) return;
                        const invalid = next.find((x) => !isValidEmail(x));
                        if (invalid) {
                          setStatus({
                            kind: "error",
                            message: `Ungültige E-Mail: ${invalid}`,
                          });
                          return;
                        }
                        setNotificationEmails((prev) =>
                          normalizeEmails([...prev, ...next]),
                        );
                        setNotificationEmailDraft("");
                        setStatus(null);
                      }}
                      onPaste={(e) => {
                        const text = e.clipboardData.getData("text");
                        const next = parseNotificationEmailsFromText(text);
                        // If it's clearly a list, add immediately instead of pasting.
                        if (next.length <= 1) return;
                        e.preventDefault();
                        const invalid = next.find((x) => !isValidEmail(x));
                        if (invalid) {
                          setStatus({
                            kind: "error",
                            message: `Ungültige E-Mail: ${invalid}`,
                          });
                          return;
                        }
                        setNotificationEmails((prev) =>
                          normalizeEmails([...prev, ...next]),
                        );
                        setStatus(null);
                      }}
                      placeholder="E-Mail eingeben (z.B. team@example.com)"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        const next = parseNotificationEmailsFromText(
                          notificationEmailDraft,
                        );
                        if (next.length === 0) return;
                        const invalid = next.find((x) => !isValidEmail(x));
                        if (invalid) {
                          setStatus({
                            kind: "error",
                            message: `Ungültige E-Mail: ${invalid}`,
                          });
                          return;
                        }
                        setNotificationEmails((prev) =>
                          normalizeEmails([...prev, ...next]),
                        );
                        setNotificationEmailDraft("");
                        setStatus(null);
                      }}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Hinzufügen
                    </Button>
                  </div>

                  {notificationEmails.length ? (
                    <div className="flex flex-wrap gap-2">
                      {notificationEmails.map((email) => (
                        <Badge
                          key={email}
                          variant="secondary"
                          className="gap-1 pr-1"
                        >
                          <span className="max-w-[260px] truncate">{email}</span>
                          <button
                            type="button"
                            className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded hover:bg-accent"
                            aria-label={`E-Mail entfernen: ${email}`}
                            onClick={() => {
                              setNotificationEmails((prev) =>
                                prev.filter((x) => x !== email),
                              );
                              setStatus(null);
                            }}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </Badge>
                      ))}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setNotificationEmails([]);
                          setStatus(null);
                        }}
                      >
                        Alle entfernen
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-secondary">
                      Keine Empfänger hinterlegt. Optional: füge eine oder mehrere
                      E-Mails hinzu.
                    </p>
                  )}
                </div>
                <p className="text-xs text-secondary">
                  Diese Empfänger bekommen eine E-Mail beim Veröffentlichen und bei Admin-Antworten.
                </p>
              </div>

              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">Schritte</p>
                <Button onClick={addStep} size="sm" variant="outline">
                  <Plus className="mr-2 h-4 w-4" />
                  Schritt hinzufügen
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
                      idx === currentStepIndex
                        ? "bg-accent"
                        : "hover:bg-accent/50",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="grid gap-0.5">
                        <p className="text-sm font-medium">
                          {st.title || `Schritt ${idx + 1}`}
                        </p>
                        {st.description ? (
                          <p className="text-xs text-secondary line-clamp-2">
                            {st.description}
                          </p>
                        ) : (
                          <p className="text-xs text-secondary">
                            Keine Beschreibung
                          </p>
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
                          aria-label="Schritt nach oben"
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
                          aria-label="Schritt nach unten"
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
                          aria-label="Schritt löschen"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {/* JSON import/export moved into modal (opened from actions menu). */}
            </CardContent>
          </Card>

          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>
                  {currentStep?.title || `Schritt ${currentStepIndex + 1}`}
                </CardTitle>
                <CardDescription>
                  Schritt-Titel, Beschreibung und Felder bearbeiten.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="step_title">Schritt-Titel</Label>
                  <Input
                    id="step_title"
                    value={currentStep?.title ?? ""}
                    onChange={(e) =>
                      updateStep(currentStep.id, { title: e.target.value })
                    }
                    placeholder={`Schritt ${currentStepIndex + 1}`}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="step_desc">Schritt-Beschreibung</Label>
                  <Textarea
                    id="step_desc"
                    value={currentStep?.description ?? ""}
                    onChange={(e) =>
                      updateStep(currentStep.id, {
                        description: e.target.value,
                      })
                    }
                    placeholder="Optionale Schritt-Beschreibung…"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Felder</p>
                </div>

                {currentStep.fields.length === 0 ? (
                  <p className="text-sm text-secondary">
                    Noch keine Felder. Füge eins über den Button unten hinzu.
                  </p>
                ) : (
                  <div className="grid gap-3">
                    {currentStep.fields.map((field, fieldIndex) => (
                      <Card key={field.id}>
                        <CardHeader className="pb-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="grid gap-1">
                              <CardTitle className="text-base">
                                {field.title || "Unbenanntes Feld"}
                              </CardTitle>
                              <CardDescription>
                                Typ:{" "}
                                <span className="font-medium">
                                  {field.type}
                                </span>
                                {field.required ? " · erforderlich" : ""}
                              </CardDescription>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                onClick={() =>
                                  moveField(currentStep.id, fieldIndex, -1)
                                }
                                disabled={fieldIndex === 0}
                                aria-label="Feld nach oben"
                              >
                                <ArrowUp className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                onClick={() =>
                                  moveField(currentStep.id, fieldIndex, 1)
                                }
                                disabled={
                                  fieldIndex === currentStep.fields.length - 1
                                }
                                aria-label="Feld nach unten"
                              >
                                <ArrowDown className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                onClick={() =>
                                  removeField(currentStep.id, field.id)
                                }
                                aria-label="Feld löschen"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="grid gap-4">
                          <div className="grid gap-2">
                            <Label>Feld-Titel</Label>
                            <Input
                              value={field.title}
                              onChange={(e) =>
                                updateField(currentStep.id, field.id, {
                                  title: e.target.value,
                                })
                              }
                              placeholder="z.B. Frage / Titel"
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label>Feld-Beschreibung</Label>
                            <Textarea
                              value={field.description}
                              onChange={(e) =>
                                updateField(currentStep.id, field.id, {
                                  description: e.target.value,
                                })
                              }
                              placeholder="Optionaler Hinweis / Beschreibung…"
                            />
                          </div>
                          <label className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={field.required}
                              onCheckedChange={(checked) =>
                                updateField(currentStep.id, field.id, {
                                  required: Boolean(checked),
                                })
                              }
                            />
                            Erforderlich
                          </label>

                          {field.type === "text" ? (
                            <div className="grid gap-2">
                              <Label>Platzhalter</Label>
                              <Input
                                value={field.placeholder}
                                onChange={(e) =>
                                  updateField(currentStep.id, field.id, {
                                    placeholder: e.target.value,
                                  })
                                }
                                placeholder="z.B. Deine Antwort…"
                              />
                            </div>
                          ) : null}

                          {field.type === "rating" ? (
                            <div className="grid gap-2">
                              <Label>Skala</Label>
                              <div className="text-sm text-secondary">
                                Derzeit fest: {field.scale.min}–
                                {field.scale.max}
                              </div>
                            </div>
                          ) : null}

                          {field.type === "radio" ||
                          field.type === "checkbox" ||
                          field.type === "ranking" ? (
                            <div className="grid gap-2">
                              <div className="flex items-center justify-between gap-2">
                                <Label>Optionen</Label>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    addOption(currentStep.id, field.id)
                                  }
                                >
                                  <Plus className="mr-2 h-4 w-4" />
                                  Option hinzufügen
                                </Button>
                              </div>
                              <div className="grid gap-2">
                                {field.options.map((opt) => (
                                  <div
                                    key={opt.id}
                                    className="flex items-center gap-2"
                                  >
                                    <Input
                                      value={opt.label}
                                      onChange={(e) =>
                                        updateOption(
                                          currentStep.id,
                                          field.id,
                                          opt.id,
                                          { label: e.target.value },
                                        )
                                      }
                                    />
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="ghost"
                                      onClick={() =>
                                        removeOption(
                                          currentStep.id,
                                          field.id,
                                          opt.id,
                                        )
                                      }
                                      disabled={
                                        field.options.length <=
                                        (field.type === "ranking" ? 2 : 1)
                                      }
                                      aria-label="Option entfernen"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                ))}
                              </div>
                              {field.type === "ranking" ? (
                                <label className="flex cursor-pointer items-center gap-2 text-sm">
                                  <Checkbox
                                    checked={field.allowCustomEntries !== false}
                                    onCheckedChange={(next) =>
                                      updateField(currentStep.id, field.id, {
                                        allowCustomEntries: next === true,
                                      })
                                    }
                                  />
                                  <span>
                                    Teilnehmende dürfen eigene Optionen ergänzen („Andere“)
                                  </span>
                                </label>
                              ) : null}
                            </div>
                          ) : null}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "mt-2 w-full rounded-lg border border-dashed px-4 py-7 text-left transition-colors",
                        "hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent">
                          <Plus className="h-5 w-5" />
                        </div>
                        <div className="grid">
                          <p className="text-sm font-semibold">Feld hinzufügen</p>
                          <p className="text-xs text-secondary">
                            Text, Auswahl, Mehrfachauswahl, Bewertung oder Ranking
                          </p>
                        </div>
                      </div>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem
                      onSelect={() => {
                        addField(currentStep.id, "text");
                      }}
                    >
                      Textfeld
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        addField(currentStep.id, "radio");
                      }}
                    >
                      Einzelauswahl (Radio)
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        addField(currentStep.id, "checkbox");
                      }}
                    >
                      Mehrfachauswahl (Checkbox)
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        addField(currentStep.id, "rating");
                      }}
                    >
                      Bewertung (1–5)
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        addField(currentStep.id, "ranking");
                      }}
                    >
                      Ranking (Reihenfolge)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
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

      {jsonModal ? (
        <JsonModal
          mode={jsonModal.mode}
          onClose={() => setJsonModal(null)}
          importJson={importJson}
          setImportJson={setImportJson}
          exportJson={exportJson}
          setExportJson={setExportJson}
          onImport={() => {
            if (!importJson.trim()) {
              setStatus({ kind: "error", message: "Bitte zuerst JSON einfügen." });
              return;
            }
            importSurveyFromText(importJson);
            setJsonModal(null);
          }}
          onExportCopy={() => {
            const json = exportJson.trim()
              ? exportJson
              : JSON.stringify(survey, null, 2);
            copyText(json);
          }}
          onExportDownload={() => {
            const json = exportJson.trim()
              ? exportJson
              : JSON.stringify(survey, null, 2);
            downloadJson(`survey-${survey.id}.json`, json);
          }}
        />
      ) : null}
    </div>
  );
}

function parseNotificationEmailsFromText(text: string) {
  // Accept single entry or lists separated by commas/newlines/semicolons/spaces.
  return Array.from(
    new Set(
      text
        .split(/[,\n;\s]+/g)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function normalizeEmails(list: string[]) {
  return Array.from(
    new Set(list.map((s) => s.trim().toLowerCase()).filter(Boolean)),
  );
}

function JsonModal({
  mode,
  onClose,
  importJson,
  setImportJson,
  exportJson,
  setExportJson,
  onImport,
  onExportCopy,
  onExportDownload,
}: {
  mode: "export" | "import";
  onClose: () => void;
  importJson: string;
  setImportJson: (v: string) => void;
  exportJson: string;
  setExportJson: (v: string) => void;
  onImport: () => void;
  onExportCopy: () => void;
  onExportDownload: () => void;
}) {
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

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[110] bg-black/50 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mx-auto flex min-h-full w-full max-w-3xl items-start justify-center px-4 py-10">
        <Card
          role="dialog"
          aria-modal="true"
          className="w-full shadow-lg"
        >
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="grid gap-1">
                <CardTitle>
                  {mode === "export" ? "JSON exportieren" : "JSON importieren"}
                </CardTitle>
                <CardDescription>
                  {mode === "export"
                    ? "Kopiere oder lade den aktuellen Entwurf als JSON herunter."
                    : "Füge Umfrage-JSON ein oder importiere es aus einer Datei."}
                </CardDescription>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Schließen"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3">
            {mode === "export" ? (
              <>
                <Textarea
                  value={exportJson}
                  onChange={(e) => setExportJson(e.target.value)}
                  className="font-mono text-xs min-h-[260px]"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button type="button" variant="outline" onClick={onExportCopy}>
                    <Copy className="mr-2 h-4 w-4" />
                    Kopieren
                  </Button>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={onExportDownload}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Herunterladen
                    </Button>
                    <Button type="button" variant="secondary" onClick={onClose}>
                      Schließen
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <Textarea
                  value={importJson}
                  onChange={(e) => setImportJson(e.target.value)}
                  placeholder='Umfrage-JSON hier einfügen (muss "version": 1 enthalten)…'
                  className="font-mono text-xs min-h-[260px]"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" onClick={onImport}>
                      <Upload className="mr-2 h-4 w-4" />
                      Importieren
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
                          e.currentTarget.value = "";
                        }}
                      />
                      <span className="inline-flex items-center gap-2">
                        <Upload className="h-4 w-4" />
                        Aus Datei wählen
                      </span>
                    </label>
                  </div>
                  <Button type="button" variant="secondary" onClick={onClose}>
                    Schließen
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>,
    document.body,
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
                Vorschau
              </p>
              <p className="text-sm text-secondary">
                {survey.title || "Unbenannte Umfrage"}
              </p>
            </div>
            <Button onClick={onExitPreview} variant="secondary" size="sm">
              <Pencil className="mr-2 h-4 w-4" />
              Vorschau schließen
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
              Zurück
            </Button>
            <div />
            <Button
              type="button"
              variant="outline"
              disabled={!canNext}
              onClick={() => setStepIndex(stepIndex + 1)}
            >
              Weiter
            </Button>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{survey.title || "Unbenannte Umfrage"}</CardTitle>
          {survey.description ? (
            <CardDescription>{survey.description}</CardDescription>
          ) : null}
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{step?.title || `Schritt ${stepIndex + 1}`}</CardTitle>
          {step?.description ? (
            <CardDescription>{step.description}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-4">
          {step.fields.length === 0 ? (
            <p className="text-sm text-secondary">Keine Felder in diesem Schritt.</p>
          ) : (
            <div className="grid gap-4">
              {step.fields.map((field) => (
                <div key={field.id} className="grid gap-2">
                  <div className="grid gap-1">
                    <p className="text-sm font-semibold">
                      {field.title || "Unbenanntes Feld"}{" "}
                      {field.required ? (
                        <span className="text-red-400">*</span>
                      ) : null}
                    </p>
                    {field.description ? (
                      <p className="text-sm text-secondary">
                        {field.description}
                      </p>
                    ) : null}
                  </div>

                  {field.type === "text" ? (
                    <Input
                      value={(answers[field.id] as string) ?? ""}
                      onChange={(e) => setAnswer(field.id, e.target.value)}
                      placeholder={field.placeholder || "Deine Antwort…"}
                    />
                  ) : null}

                  {field.type === "radio" ? (
                    <div className="grid gap-2">
                      {field.options.map((opt) => {
                        const selected = answers[field.id] === opt.id;
                        return (
                          <label
                            key={opt.id}
                            className={cn(
                              "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm shadow-sm transition-colors hover:bg-accent",
                              selected ? "border-primary bg-primary/5" : "border-input bg-background",
                            )}
                          >
                            <input
                              type="radio"
                              name={field.id}
                              checked={selected}
                              className="peer sr-only"
                              onChange={() => setAnswer(field.id, opt.id)}
                            />
                            <span
                              aria-hidden="true"
                              className={cn(
                                "flex h-4 w-4 items-center justify-center rounded-full border bg-background",
                                selected ? "border-primary" : "border-input",
                              )}
                            >
                              <span
                                className={cn(
                                  "h-2 w-2 rounded-full bg-primary transition-opacity",
                                  selected ? "opacity-100" : "opacity-0",
                                )}
                              />
                            </span>
                            {opt.label}
                          </label>
                        );
                      })}
                    </div>
                  ) : null}

                  {field.type === "checkbox" ? (
                    <div className="grid gap-2">
                      {field.options.map((opt) => {
                        const set = new Set(
                          (answers[field.id] as string[]) ?? [],
                        );
                        const checked = set.has(opt.id);
                        return (
                          <label
                            key={opt.id}
                            className={cn(
                              "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm shadow-sm transition-colors hover:bg-accent",
                              checked ? "border-primary bg-primary/5" : "border-input bg-background",
                            )}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(next) => {
                                const nextSet = new Set(
                                  (answers[field.id] as string[]) ?? [],
                                );
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
                      {Array.from({
                        length: field.scale.max - field.scale.min + 1,
                      }).map((_, i) => {
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

                  {field.type === "ranking" ? (
                    <SurveyRankingInput
                      fieldId={field.id}
                      presetLabels={field.options.map((opt) => opt.label)}
                      value={answers[field.id]}
                      onChange={(next) => setAnswer(field.id, next)}
                      allowCustomEntries={field.allowCustomEntries !== false}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={!canBack}
              onClick={() => setStepIndex(stepIndex - 1)}
            >
              Zurück
            </Button>
            <div />
            <Button
              type="button"
              variant="outline"
              disabled={!canNext}
              onClick={() => setStepIndex(stepIndex + 1)}
            >
              Weiter
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end">
        <Button onClick={onExitPreview} variant="secondary">
          <Pencil className="mr-2 h-4 w-4" />
          Vorschau schließen
        </Button>
      </div>
    </div>
  );
}
