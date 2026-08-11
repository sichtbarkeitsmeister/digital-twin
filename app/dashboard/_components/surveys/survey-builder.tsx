"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Download,
  Eye,
  Globe,
  Info,
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
import {
  addCheckboxOtherEntry,
  buildCheckboxAnswer,
  buildRadioAnswer,
  getRadioOtherState,
  parseCheckboxOtherEntries,
  RADIO_OTHER_TOKEN,
  removeCheckboxOtherEntry,
  setCheckboxOtherEntryText,
} from "@/lib/surveys/other-option";
import { SurveyRankingInput } from "@/components/surveys/survey-ranking-input";
import { SurveyTextListInput } from "@/components/surveys/survey-text-list-input";
import { FormattedInfoText } from "@/components/surveys/formatted-info-text";
import { RichTextEditor } from "@/components/surveys/rich-text-editor";
import { formatRankingAnswerForDisplay } from "@/lib/surveys/ranking-answer";
import {
  formatTextListAnswerForDisplay,
  isTextListAnswerValid,
} from "@/lib/surveys/text-list-answer";
import { surveySchema } from "@/lib/surveys/schema";
import {
  normalizeSurveyPurpose,
  surveyPurposeLabel,
  type SurveyPurpose,
} from "@/lib/surveys/purpose";
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
import { DtSelect } from "@/components/dt/dt-select";

import { SurveyProgress } from "@/app/dashboard/_components/surveys/survey-progress";
import {
  publishSurveyAction,
  updateSurveySlugAction,
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
    answerPlaceholder: "Deine Antwort…",
    infoTextEnabled: false,
    infoText: "",
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
    return { ...base, type: "text" };
  }
  if (type === "rating") {
    return { ...base, type: "rating", scale: { min: 1, max: 5 } };
  }
  const options: SurveyOption[] = [{ id: createId(), label: "Option 1" }];
  if (type === "text_list") {
    return {
      ...base,
      type: "text_list",
      required: true,
      options: [
        { id: createId(), label: "Mir ist aufgefallen, dass…" },
        { id: createId(), label: "Das Kind hat Probleme mit…" },
        { id: createId(), label: "Der Kinderarzt hat empfohlen…" },
      ],
      allowExtraEntries: true,
    };
  }
  if (type === "radio")
    return { ...base, type: "radio", options, allowOtherOption: false };
  if (type === "checkbox")
    return { ...base, type: "checkbox", options, allowOtherOption: true };
  return {
    ...base,
    type: "ranking",
    options: [...options, { id: createId(), label: "Option 2" }],
    allowCustomEntries: true,
  };
}

function fieldHasOptions(
  field: SurveyField,
): field is Extract<
  SurveyField,
  { type: "text_list" | "radio" | "checkbox" | "ranking" }
> {
  return (
    field.type === "text_list" ||
    field.type === "radio" ||
    field.type === "checkbox" ||
    field.type === "ranking"
  );
}

function getOptionsFromField(
  field: SurveyField,
  minCount: number,
): SurveyOption[] {
  const source = fieldHasOptions(field)
    ? field.options.map((opt) => ({ ...opt }))
    : [{ id: createId(), label: "Option 1" }];
  const next = [...source];
  while (next.length < minCount) {
    next.push({ id: createId(), label: `Option ${next.length + 1}` });
  }
  return next;
}

function convertFieldType(
  field: SurveyField,
  nextType: SurveyFieldType,
): SurveyField {
  if (field.type === nextType) return field;

  const base = {
    id: field.id,
    title: field.title,
    description: field.description,
    required: field.required,
  };

  if (nextType === "text") {
    return {
      ...base,
      type: "text",
    };
  }

  if (nextType === "rating") {
    return {
      ...base,
      type: "rating",
      scale: field.type === "rating" ? field.scale : { min: 1, max: 5 },
    };
  }

  if (nextType === "text_list") {
    return {
      ...base,
      type: "text_list",
      options: getOptionsFromField(field, 1),
      allowExtraEntries:
        field.type === "text_list" ? field.allowExtraEntries !== false : true,
    };
  }

  if (nextType === "radio") {
    const options = getOptionsFromField(field, 1);
    const allowOtherOption =
      field.type === "radio" || field.type === "checkbox"
        ? field.allowOtherOption === true
        : false;
    return {
      ...base,
      type: "radio",
      options,
      allowOtherOption,
    };
  }

  if (nextType === "checkbox") {
    const options = getOptionsFromField(field, 1);
    const allowOtherOption =
      field.type === "radio" || field.type === "checkbox"
        ? field.allowOtherOption !== false
        : true;
    return {
      ...base,
      type: "checkbox",
      options,
      allowOtherOption,
    };
  }

  return {
    ...base,
    type: "ranking",
    options: getOptionsFromField(field, 2),
    allowCustomEntries:
      field.type === "ranking" ? field.allowCustomEntries !== false : true,
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
type ActiveResponseEditor = { stepId: string; fieldId: string } | null;

type Props = {
  surveyId?: string;
  initialSurvey?: Survey;
  initialPurpose?: SurveyPurpose;
  initialVisibility?: "private" | "public";
  initialSlug?: string | null;
  initialNotificationEmails?: string[];
  initialResponseAnswers?: Record<string, unknown>;
};

export function SurveyBuilder({
  surveyId: initialSurveyId,
  initialSurvey,
  initialPurpose = "persona",
  initialVisibility = "private",
  initialSlug = null,
  initialNotificationEmails = [],
  initialResponseAnswers = {},
}: Props) {
  const router = useRouter();
  const [mode, setMode] = React.useState<"edit" | "preview">("edit");
  const [survey, setSurvey] = React.useState<Survey>(
    () => initialSurvey ?? createDefaultSurvey(),
  );
  const [purpose, setPurpose] = React.useState<SurveyPurpose>(() =>
    normalizeSurveyPurpose(initialPurpose),
  );
  const [currentStepIndex, setCurrentStepIndex] = React.useState(0);

  const [dbSurveyId, setDbSurveyId] = React.useState<string | null>(
    initialSurveyId ?? null,
  );
  const [visibility, setVisibility] = React.useState<"private" | "public">(
    initialVisibility,
  );
  const [slug, setSlug] = React.useState<string | null>(initialSlug);
  const [slugDraft, setSlugDraft] = React.useState(initialSlug ?? "");

  const [notificationEmails, setNotificationEmails] = React.useState<string[]>(
    () => normalizeEmails(initialNotificationEmails ?? []),
  );
  const [notificationEmailDraft, setNotificationEmailDraft] =
    React.useState("");

  const [importJson, setImportJson] = React.useState("");
  const [exportJson, setExportJson] = React.useState("");
  const [jsonModal, setJsonModal] = React.useState<null | {
    mode: "export" | "import";
  }>(null);
  const [status, setStatus] = React.useState<{
    kind: "ok" | "error";
    message: string;
  } | null>(null);

  const [previewStepIndex, setPreviewStepIndex] = React.useState(0);
  const [previewAnswers, setPreviewAnswers] = React.useState<PreviewAnswers>(
    () => initialResponseAnswers ?? {},
  );
  const [activeResponseEditor, setActiveResponseEditor] =
    React.useState<ActiveResponseEditor>(null);
  const resetBaselineRef = React.useRef<string | null>(null);
  const draftStorageId = dbSurveyId ?? initialSurveyId ?? "new";
  const reloadRestoreFlagKey = `dt_survey_restore_on_reload:${draftStorageId}`;
  const previewAnswersStorageKey = `dt_survey_preview_answers_v1:${draftStorageId}`;

  React.useEffect(() => {
    function markReloadRestore() {
      try {
        window.sessionStorage.setItem(reloadRestoreFlagKey, "1");
      } catch {
        // ignore
      }
    }
    window.addEventListener("beforeunload", markReloadRestore);
    return () => window.removeEventListener("beforeunload", markReloadRestore);
  }, [reloadRestoreFlagKey]);

  // Initial load
  React.useEffect(() => {
    let shouldRestore = false;
    if (typeof window !== "undefined") {
      try {
        const flag = window.sessionStorage.getItem(reloadRestoreFlagKey);
        window.sessionStorage.removeItem(reloadRestoreFlagKey);
        shouldRestore = flag === "1";
      } catch {
        shouldRestore = false;
      }
    }
    const draft = shouldRestore ? loadDraftSurvey(draftStorageId) : null;
    if (draft) {
      setSurvey(draft);
      setCurrentStepIndex(0);
      setStatus({
        kind: "ok",
        message: "Entwurf aus dem lokalen Speicher geladen.",
      });
      return;
    }
    if (initialSurvey) {
      setSurvey(initialSurvey);
    }
    try {
      const rawPreviewAnswers = window.localStorage.getItem(
        previewAnswersStorageKey,
      );
      if (!rawPreviewAnswers) return;
      const parsed = JSON.parse(rawPreviewAnswers) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const localAnswers = parsed as PreviewAnswers;
        const hasLocalValues = Object.keys(localAnswers).length > 0;
        if (!hasLocalValues) return;
        setPreviewAnswers((prev) => ({
          ...prev,
          ...localAnswers,
        }));
      }
    } catch {
      // ignore
    }
  }, [
    initialSurvey,
    draftStorageId,
    reloadRestoreFlagKey,
    previewAnswersStorageKey,
  ]);

  React.useEffect(() => {
    const hasCurrentValues = Object.keys(previewAnswers).length > 0;
    const hasInitialValues =
      Object.keys(initialResponseAnswers ?? {}).length > 0;
    if (hasCurrentValues || !hasInitialValues) return;
    setPreviewAnswers(initialResponseAnswers);
  }, [initialResponseAnswers, previewAnswers]);

  // Autosave (debounced)
  React.useEffect(() => {
    if (resetBaselineRef.current) {
      const current = JSON.stringify(survey);
      if (current === resetBaselineRef.current) return;
      resetBaselineRef.current = null;
    }
    const handle = window.setTimeout(() => {
      saveDraftSurvey(survey, draftStorageId);
    }, 400);
    return () => window.clearTimeout(handle);
  }, [survey, draftStorageId]);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(
        previewAnswersStorageKey,
        JSON.stringify(previewAnswers),
      );
    } catch {
      // ignore
    }
  }, [previewAnswers, previewAnswersStorageKey]);

  // Keep indices safe when steps change
  React.useEffect(() => {
    setCurrentStepIndex((idx) =>
      Math.min(Math.max(idx, 0), Math.max(survey.steps.length - 1, 0)),
    );
    setPreviewStepIndex((idx) =>
      Math.min(Math.max(idx, 0), Math.max(survey.steps.length - 1, 0)),
    );
  }, [survey.steps.length]);

  React.useEffect(() => {
    if (mode !== "edit") return;
    window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
  }, [currentStepIndex, mode]);

  React.useEffect(() => {
    setSlugDraft(slug ?? "");
  }, [slug]);

  const steps = survey.steps;
  const currentStep = steps[currentStepIndex] ?? steps[0];
  const isInfoIntroEditStep =
    survey.infoTextEnabled === true && currentStepIndex === 0;
  const activeResponseField =
    activeResponseEditor == null
      ? null
      : survey.steps
          .find((s) => s.id === activeResponseEditor.stepId)
          ?.fields.find((f) => f.id === activeResponseEditor.fieldId) ?? null;

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

  function enableInfoTextMode() {
    setSurvey((s) => {
      if (s.infoTextEnabled === true) return s;
      const introStep: SurveyStep = {
        id: createId(),
        title: "Info",
        description: "",
        fields: [],
      };

      return {
        ...s,
        infoTextEnabled: true,
        steps: [introStep, ...s.steps],
      };
    });
    setCurrentStepIndex((idx) => idx);
  }

  function disableInfoTextMode() {
    setSurvey((s) => {
      if (s.infoTextEnabled !== true) return s;
      const [, ...rest] = s.steps;
      const nextSteps =
        rest.length > 0
          ? rest
          : [
              {
                id: createId(),
                title: "Schritt 1",
                description: "",
                fields: [],
              } satisfies SurveyStep,
            ];
      return {
        ...s,
        infoTextEnabled: false,
        steps: nextSteps,
      };
    });
    setCurrentStepIndex((idx) => Math.max(0, idx - 1));
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

  function changeFieldType(
    stepId: string,
    fieldId: string,
    nextType: SurveyFieldType,
  ) {
    setSurvey((s) => ({
      ...s,
      steps: s.steps.map((st) => {
        if (st.id !== stepId) return st;
        return {
          ...st,
          fields: st.fields.map((f) =>
            f.id === fieldId ? convertFieldType(f, nextType) : f,
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
            if (!fieldHasOptions(f)) {
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
            if (!fieldHasOptions(f)) {
              return f;
            }
            const nextNum = f.options.length + 1;
            const label =
              f.type === "text_list"
                ? `Prompt ${nextNum}`
                : `Option ${nextNum}`;
            return {
              ...f,
              options: [...f.options, { id: createId(), label }],
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
            if (!fieldHasOptions(f)) {
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
        const msg =
          parsed.error.issues[0]?.message ?? "Ungültiges Umfrage-JSON.";
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
    clearDraftSurvey(draftStorageId);
    try {
      window.localStorage.removeItem(previewAnswersStorageKey);
    } catch {
      // ignore
    }
    const nextSurvey = createDefaultSurvey();
    resetBaselineRef.current = JSON.stringify(nextSurvey);
    setSurvey(nextSurvey);
    setCurrentStepIndex(0);
    setPreviewAnswers({});
    setImportJson("");
    setExportJson("");
    setNotificationEmails([]);
    setNotificationEmailDraft("");
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
      purpose,
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

  async function saveSlug() {
    const id = dbSurveyId ?? (await saveDraftToDatabase());
    if (!id) return;
    const normalized = slugDraft.trim().toLowerCase();
    if (!normalized) {
      setStatus({ kind: "error", message: "Bitte eine URL eingeben." });
      return;
    }
    const res = await updateSurveySlugAction({ surveyId: id, slug: normalized });
    if (!res.ok || !res.data?.slug) {
      setStatus({ kind: "error", message: res.message });
      return;
    }
    setSlug(res.data.slug);
    setSlugDraft(res.data.slug);
    setStatus({ kind: "ok", message: res.message });
  }

  async function makePrivate() {
    if (!dbSurveyId) {
      setStatus({
        kind: "error",
        message: "Bitte zuerst den Entwurf speichern.",
      });
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

      {mode === "edit" ? (
        <div className="mx-auto w-full max-w-5xl px-4 py-2">
          <div className="grid gap-6">
            <div className="sticky top-0 z-40 -mx-4 border-b bg-background/90 px-4 py-3 backdrop-blur">
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="grid gap-0.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-secondary">
                      Editable Preview
                    </p>
                    <p className="text-sm text-secondary">
                      <Link
                        href="/dashboard/surveys"
                        prefetch
                        className="hover:text-primary transition-colors"
                      >
                        ← Zurück zu Umfragen
                      </Link>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {visibility === "public" ? (
                      <Button
                        onClick={makePrivate}
                        variant="secondary"
                        size="sm"
                      >
                        <Lock className="mr-2 h-4 w-4" />
                        Privat
                      </Button>
                    ) : (
                      <Button onClick={publishSurvey} size="sm">
                        <Globe className="mr-2 h-4 w-4" />
                        Veröffentlichen
                      </Button>
                    )}
                    {visibility === "public" && slug ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          copyText(`${window.location.origin}/s/${slug}`)
                        }
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        Link kopieren
                      </Button>
                    ) : null}
                    <Button onClick={enterPreview} variant="outline" size="sm">
                      <Eye className="mr-2 h-4 w-4" />
                      Vorschau
                    </Button>
                    <Button onClick={saveDraftToDatabase} size="sm">
                      <Save className="mr-2 h-4 w-4" />
                      Speichern
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
                </div>

                <SurveyProgress
                  steps={steps}
                  currentStepIndex={currentStepIndex}
                  onStepChange={setCurrentStepIndex}
                />

                <div className="flex items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={currentStepIndex === 0}
                    onClick={() =>
                      setCurrentStepIndex((idx) => Math.max(0, idx - 1))
                    }
                  >
                    Zurück
                  </Button>
                  <Badge variant="outline">
                    Schritt {currentStepIndex + 1} / {steps.length}
                  </Badge>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={currentStepIndex >= steps.length - 1}
                    onClick={() =>
                      setCurrentStepIndex((idx) =>
                        Math.min(steps.length - 1, idx + 1),
                      )
                    }
                  >
                    Weiter
                  </Button>
                </div>
              </div>
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="w-full">
                  <Input
                    value={survey.title}
                    onChange={(e) => updateSurvey({ title: e.target.value })}
                    placeholder="Umfrage-Titel"
                    className="h-10 border-0 px-0 text-xl font-semibold shadow-none focus-visible:ring-0"
                  />
                </CardTitle>
                <CardDescription className="w-full">
                  <div className="grid gap-3">
                    <div className="grid gap-1.5">
                      <DtSelect
                        label="Zweck der Umfrage"
                        fullWidth
                        elevated
                        value={purpose}
                        onValueChange={(value) => setPurpose(normalizeSurveyPurpose(value))}
                        options={[
                          {
                            value: "persona",
                            label: surveyPurposeLabel("persona"),
                            description: "Antworten → Kunden-Avatar",
                          },
                          {
                            value: "anbieter",
                            label: surveyPurposeLabel("anbieter"),
                            description: "Antworten → SEO-Berater Wissen (1:1)",
                          },
                        ]}
                      />
                      <p className="text-xs text-secondary">
                        {purpose === "anbieter"
                          ? "Antworten landen 1:1 beim SEO-Berater (Unternehmenswissen) — kein Avatar."
                          : "Antworten können in einen Kunden-Persona-Avatar umgewandelt werden."}
                      </p>
                    </div>
                    <Textarea
                      value={survey.description}
                      onChange={(e) =>
                        updateSurvey({ description: e.target.value })
                      }
                      placeholder="Beschreibung der Umfrage (optional)"
                      className="min-h-[70px] border-0 px-0 shadow-none focus-visible:ring-0"
                    />
                    {currentStepIndex === 0 ? (
                      <div className="grid gap-2">
                        <div className="flex items-center justify-between gap-2">
                          <label className="flex cursor-pointer items-center gap-2 text-sm">
                            <Checkbox
                              checked={survey.infoTextEnabled === true}
                              onCheckedChange={(checked) => {
                                if (checked === true) {
                                  enableInfoTextMode();
                                  return;
                                }
                                disableInfoTextMode();
                              }}
                            />
                            Infotext aktivieren (nur auf Seite 1)
                          </label>
                        </div>
                        {survey.infoTextEnabled === true ? (
                          <>
                            <RichTextEditor
                              value={survey.infoText ?? ""}
                              onChange={(next) =>
                                updateSurvey({ infoText: next })
                              }
                              disabled={false}
                            />
                          </>
                        ) : null}
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <label className="flex cursor-pointer items-center gap-2 text-sm">
                          <Checkbox
                            checked={survey.infoTextEnabled === true}
                            onCheckedChange={(checked) => {
                              if (checked === true) {
                                enableInfoTextMode();
                                return;
                              }
                              disableInfoTextMode();
                            }}
                          />
                          Infotext aktivieren (nur auf Seite 1)
                        </label>
                        {survey.infoTextEnabled === true ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setCurrentStepIndex(0)}
                            className="text-secondary hover:text-primary"
                          >
                            Infotext auf Seite 1 bearbeiten
                          </Button>
                        ) : null}
                      </div>
                    )}
                  </div>
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {isInfoIntroEditStep ? (
                    <div className="grid min-w-0 flex-1 gap-1">
                      <p className="text-lg font-semibold">Infoseite</p>
                      <p className="text-sm text-secondary">
                        Schritt 1 ist für den Infotext reserviert.
                      </p>
                    </div>
                  ) : (
                    <div className="grid min-w-0 flex-1 gap-2">
                      <Input
                        value={currentStep?.title ?? ""}
                        onChange={(e) =>
                          updateStep(currentStep.id, { title: e.target.value })
                        }
                        placeholder={`Schritt ${currentStepIndex + 1}`}
                        className="h-9 border-0 px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
                      />
                      <Textarea
                        value={currentStep?.description ?? ""}
                        onChange={(e) =>
                          updateStep(currentStep.id, {
                            description: e.target.value,
                          })
                        }
                        placeholder="Schrittbeschreibung (optional)"
                        className="min-h-[64px] border-0 px-0 shadow-none focus-visible:ring-0"
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-1">
                    {!isInfoIntroEditStep ? (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => moveStep(currentStepIndex, -1)}
                          disabled={currentStepIndex === 0}
                          aria-label="Schritt nach oben"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => moveStep(currentStepIndex, 1)}
                          disabled={currentStepIndex >= steps.length - 1}
                          aria-label="Schritt nach unten"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeStep(currentStep.id)}
                          disabled={steps.length <= 1}
                          aria-label="Schritt löschen"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addStep}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Schritt
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="grid gap-5">
                {survey.infoTextEnabled === true && currentStepIndex === 0 ? (
                  <div className="rounded-lg border border-dashed p-4 text-sm text-secondary">
                    Schritt 1 ist als Infoseite reserviert. Fragen starten ab
                    Schritt 2.
                  </div>
                ) : currentStep.fields.length === 0 ? (
                  <p className="text-sm text-secondary">
                    Keine Felder in diesem Schritt.
                  </p>
                ) : (
                  currentStep.fields.map((field, fieldIndex) => (
                    <div
                      key={field.id}
                      className="grid gap-3 rounded-lg border p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="grid min-w-0 flex-1 gap-2">
                          <Input
                            value={field.title}
                            onChange={(e) =>
                              updateField(currentStep.id, field.id, {
                                title: e.target.value,
                              })
                            }
                            placeholder="Fragetitel"
                            className="h-9 border-0 px-0 text-base font-medium shadow-none focus-visible:ring-0"
                          />
                          <Textarea
                            value={field.description}
                            onChange={(e) =>
                              updateField(currentStep.id, field.id, {
                                description: e.target.value,
                              })
                            }
                            placeholder="Fragebeschreibung (optional)"
                            className="min-h-[56px] border-0 px-0 shadow-none focus-visible:ring-0"
                          />
                        </div>

                        <div className="flex items-center gap-1">
                          <Badge
                            variant="outline"
                            className={cn(
                              "mr-1",
                              hasFieldAnswer(field, previewAnswers[field.id])
                                ? "border-emerald-300 text-emerald-400"
                                : "border-border text-secondary",
                            )}
                          >
                            {hasFieldAnswer(field, previewAnswers[field.id])
                              ? "Beantwortet"
                              : "Offen"}
                          </Badge>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button type="button" variant="outline" size="sm">
                                Typ: {field.type}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onSelect={() =>
                                  changeFieldType(
                                    currentStep.id,
                                    field.id,
                                    "text",
                                  )
                                }
                              >
                                Text
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() =>
                                  changeFieldType(
                                    currentStep.id,
                                    field.id,
                                    "text_list",
                                  )
                                }
                              >
                                Textliste
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() =>
                                  changeFieldType(
                                    currentStep.id,
                                    field.id,
                                    "radio",
                                  )
                                }
                              >
                                Radio
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() =>
                                  changeFieldType(
                                    currentStep.id,
                                    field.id,
                                    "checkbox",
                                  )
                                }
                              >
                                Checkbox
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() =>
                                  changeFieldType(
                                    currentStep.id,
                                    field.id,
                                    "rating",
                                  )
                                }
                              >
                                Bewertung
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() =>
                                  changeFieldType(
                                    currentStep.id,
                                    field.id,
                                    "ranking",
                                  )
                                }
                              >
                                Ranking
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
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
                            variant="ghost"
                            size="icon"
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
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              removeField(currentStep.id, field.id)
                            }
                            aria-label="Feld löschen"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
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
                        Pflichtfeld
                      </label>

                      {field.type === "rating" ? (
                        <div className="rounded-md border bg-accent/20 px-3 py-2 text-sm text-secondary">
                          Bewertungsskala: {field.scale.min} - {field.scale.max}
                        </div>
                      ) : null}

                      {field.type === "text" ? (
                        <div className="grid gap-2">
                          <Label htmlFor={`answer_preview_${field.id}`}>
                            Antwort
                          </Label>
                          <Input
                            id={`answer_preview_${field.id}`}
                            value={(previewAnswers[field.id] as string) ?? ""}
                            onChange={(e) =>
                              setPreviewAnswers((prev) => ({
                                ...prev,
                                [field.id]: e.target.value,
                              }))
                            }
                            placeholder=""
                          />
                        </div>
                      ) : null}

                      {field.type !== "text" ? (
                        <div className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2">
                          <p className="min-w-0 flex-1 truncate text-xs text-secondary">
                            {summarizeFieldAnswer(field, previewAnswers[field.id])}
                          </p>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="shrink-0"
                            onClick={() =>
                              setActiveResponseEditor({
                                stepId: currentStep.id,
                                fieldId: field.id,
                              })
                            }
                          >
                            Antwort bearbeiten
                          </Button>
                        </div>
                      ) : null}

                      {field.type === "text_list" ||
                      field.type === "radio" ||
                      field.type === "checkbox" ||
                      field.type === "ranking" ? (
                        <div className="grid gap-2">
                          <div className="flex items-center justify-between gap-2">
                            <Label>
                              {field.type === "text_list"
                                ? "Prompts / Eingabefelder"
                                : "Optionen"}
                            </Label>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                addOption(currentStep.id, field.id)
                              }
                            >
                              <Plus className="mr-2 h-4 w-4" />
                              {field.type === "text_list" ? "Prompt" : "Option"}
                            </Button>
                          </div>
                          {field.type === "text_list" ? (
                            <p className="text-xs text-secondary">
                              Jeder Prompt wird als Label über einem editierbaren
                              Textfeld angezeigt. Bei Pflichtfeld muss jedes Feld
                              ausgefüllt werden.
                            </p>
                          ) : null}
                          {field.options.map((opt) => (
                            <div
                              key={opt.id}
                              className="flex items-center gap-2"
                            >
                              {field.type === "text_list" ? (
                                <span className="inline-flex h-5 w-5 items-center justify-center text-xs text-secondary">
                                  T
                                </span>
                              ) : field.type !== "ranking" ? (
                                <span
                                  className={cn(
                                    "inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px]",
                                    field.type === "radio" &&
                                      previewAnswers[field.id] === opt.label
                                      ? "border-emerald-300 text-emerald-400"
                                      : field.type === "checkbox" &&
                                          Array.isArray(previewAnswers[field.id]) &&
                                          (previewAnswers[field.id] as string[]).includes(opt.label)
                                        ? "border-emerald-300 text-emerald-400"
                                        : "border-border text-transparent",
                                  )}
                                  aria-hidden="true"
                                >
                                  <Check className="h-3 w-3" />
                                </span>
                              ) : (
                                <span className="inline-flex h-5 w-5 items-center justify-center text-xs text-secondary">
                                  {(() => {
                                    const formatted = formatRankingAnswerForDisplay(
                                      previewAnswers[field.id],
                                      field.options.map((o) => o.label),
                                    );
                                    if (!formatted) return "•";
                                    const parts = formatted.split(", ");
                                    const idx = parts.findIndex((p) =>
                                      p.replace(/^\d+\.\s*/, "") === opt.label,
                                    );
                                    return idx >= 0 ? idx + 1 : "•";
                                  })()}
                                </span>
                              )}
                              <Input
                                value={opt.label}
                                onChange={(e) =>
                                  updateOption(
                                    currentStep.id,
                                    field.id,
                                    opt.id,
                                    {
                                      label: e.target.value,
                                    },
                                  )
                                }
                                placeholder={
                                  field.type === "text_list"
                                    ? "Prompt (z.B. Mir ist aufgefallen, dass…)"
                                    : "Option"
                                }
                              />
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                onClick={() =>
                                  removeOption(currentStep.id, field.id, opt.id)
                                }
                                disabled={
                                  field.options.length <=
                                  (field.type === "ranking" ? 2 : 1)
                                }
                                aria-label={
                                  field.type === "text_list"
                                    ? "Prompt entfernen"
                                    : "Option entfernen"
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                          {field.type === "text_list" ? (
                            <label className="flex cursor-pointer items-center gap-2 text-sm">
                              <Checkbox
                                checked={field.allowExtraEntries !== false}
                                onCheckedChange={(next) =>
                                  updateField(currentStep.id, field.id, {
                                    allowExtraEntries: next === true,
                                  })
                                }
                              />
                              <span>Zusätzliche freie Eingaben erlauben</span>
                            </label>
                          ) : field.type !== "ranking" ? (
                            <label className="flex cursor-pointer items-center gap-2 text-sm">
                              <Checkbox
                                checked={
                                  field.type === "radio"
                                    ? field.allowOtherOption === true
                                    : field.allowOtherOption !== false
                                }
                                onCheckedChange={(next) =>
                                  updateField(currentStep.id, field.id, {
                                    allowOtherOption: next === true,
                                  })
                                }
                              />
                              <span>Andere-Option erlauben</span>
                            </label>
                          ) : (
                            <label className="flex cursor-pointer items-center gap-2 text-sm">
                              <Checkbox
                                checked={field.allowCustomEntries !== false}
                                onCheckedChange={(next) =>
                                  updateField(currentStep.id, field.id, {
                                    allowCustomEntries: next === true,
                                  })
                                }
                              />
                              <span>Eigene Ranking-Optionen erlauben</span>
                            </label>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ))
                )}

                {!(
                  survey.infoTextEnabled === true && currentStepIndex === 0
                ) ? (
                  <div className="grid gap-2 rounded-lg border border-dashed p-3">
                    <p className="text-sm font-semibold">Feld hinzufügen</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => addField(currentStep.id, "text")}
                      >
                        Text
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => addField(currentStep.id, "text_list")}
                      >
                        Textliste
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => addField(currentStep.id, "radio")}
                      >
                        Radio
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => addField(currentStep.id, "checkbox")}
                      >
                        Checkbox
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => addField(currentStep.id, "rating")}
                      >
                        Bewertung
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => addField(currentStep.id, "ranking")}
                      >
                        Ranking
                      </Button>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Builder Tools</CardTitle>
                <CardDescription>
                  Zusatzoptionen für Benachrichtigungen und Schritt-Navigation.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="survey_answer_placeholder">
                    Platzhalter Text (alle Textfelder)
                  </Label>
                  <Input
                    id="survey_answer_placeholder"
                    value={survey.answerPlaceholder ?? ""}
                    onChange={(e) =>
                      updateSurvey({ answerPlaceholder: e.target.value })
                    }
                    placeholder="Deine Antwort…"
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="survey_public_slug">Öffentliche URL</Label>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border px-2 py-1">
                      <span className="text-xs text-secondary">/s/</span>
                      <Input
                        id="survey_public_slug"
                        value={slugDraft}
                        onChange={(e) => setSlugDraft(e.target.value)}
                        placeholder="meine-umfrage"
                        className="h-8 min-w-0 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={saveSlug}
                      className="sm:shrink-0"
                    >
                      URL speichern
                    </Button>
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="survey_notifications">
                    Benachrichtigungs-E-Mails
                  </Label>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      id="survey_notifications"
                      value={notificationEmailDraft}
                      onChange={(e) =>
                        setNotificationEmailDraft(e.target.value)
                      }
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
                      placeholder="team@example.com"
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
                          <span className="max-w-[220px] truncate">
                            {email}
                          </span>
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
                    </div>
                  ) : (
                    <p className="text-xs text-secondary">
                      Keine Empfänger hinterlegt.
                    </p>
                  )}
                </div>
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

      {activeResponseEditor && activeResponseField ? (
        <div
          className="fixed inset-0 z-[120] bg-black/50 p-4 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setActiveResponseEditor(null);
          }}
        >
          <div className="mx-auto flex min-h-full w-full max-w-3xl items-center px-4">
            <Card className="w-full">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">
                    Antwort bearbeiten: {activeResponseField.title || "Unbenanntes Feld"}
                  </CardTitle>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Schließen"
                    onClick={() => setActiveResponseEditor(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4">
                {activeResponseField.type === "radio" ? (
                  <div className="grid gap-2">
                    {activeResponseField.options.map((opt) => {
                      const selected = previewAnswers[activeResponseField.id] === opt.label;
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
                            name={activeResponseField.id}
                            checked={selected}
                            className="peer sr-only"
                            onChange={() =>
                              setPreviewAnswers((prev) => ({
                                ...prev,
                                [activeResponseField.id]: opt.label,
                              }))
                            }
                          />
                          <span
                            aria-hidden="true"
                            className={cn(
                              "flex h-4 w-4 items-center justify-center rounded-full border bg-background",
                              selected ? "border-primary" : "border-primary/70",
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

                {activeResponseField.type === "checkbox" ? (
                  <div className="grid gap-2">
                    {activeResponseField.options.map((opt) => {
                      const current = Array.isArray(previewAnswers[activeResponseField.id])
                        ? (previewAnswers[activeResponseField.id] as string[])
                        : [];
                      const checked = current.includes(opt.label);
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
                              const set = new Set(current);
                              if (next) set.add(opt.label);
                              else set.delete(opt.label);
                              setPreviewAnswers((prev) => ({
                                ...prev,
                                [activeResponseField.id]: Array.from(set),
                              }));
                            }}
                          />
                          {opt.label}
                        </label>
                      );
                    })}
                  </div>
                ) : null}

                {activeResponseField.type === "rating" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {Array.from({
                      length: activeResponseField.scale.max - activeResponseField.scale.min + 1,
                    }).map((_, i) => {
                      const value = activeResponseField.scale.min + i;
                      const selected = previewAnswers[activeResponseField.id] === value;
                      return (
                        <Button
                          key={value}
                          type="button"
                          variant={selected ? "default" : "outline"}
                          size="sm"
                          onClick={() =>
                            setPreviewAnswers((prev) => ({
                              ...prev,
                              [activeResponseField.id]: value,
                            }))
                          }
                        >
                          {value}
                        </Button>
                      );
                    })}
                  </div>
                ) : null}

                {activeResponseField.type === "text_list" ? (
                  <SurveyTextListInput
                    fieldId={activeResponseField.id}
                    options={activeResponseField.options}
                    value={previewAnswers[activeResponseField.id]}
                    onChange={(next) =>
                      setPreviewAnswers((prev) => ({
                        ...prev,
                        [activeResponseField.id]: next,
                      }))
                    }
                    allowExtraEntries={activeResponseField.allowExtraEntries !== false}
                    required={activeResponseField.required}
                    placeholder={
                      survey.answerPlaceholder?.trim() || "Deine Antwort…"
                    }
                  />
                ) : null}

                {activeResponseField.type === "ranking" ? (
                  <SurveyRankingInput
                    fieldId={activeResponseField.id}
                    presetLabels={activeResponseField.options.map((opt) => opt.label)}
                    value={previewAnswers[activeResponseField.id]}
                    onChange={(next) =>
                      setPreviewAnswers((prev) => ({
                        ...prev,
                        [activeResponseField.id]: next,
                      }))
                    }
                    allowCustomEntries={activeResponseField.allowCustomEntries !== false}
                  />
                ) : null}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

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
              setStatus({
                kind: "error",
                message: "Bitte zuerst JSON einfügen.",
              });
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

function summarizeFieldAnswer(field: SurveyField, value: unknown) {
  if (field.type === "text") {
    return typeof value === "string" && value.trim() ? value.trim() : "Keine Antwort";
  }
  if (field.type === "text_list") {
    const formatted = formatTextListAnswerForDisplay(value, field.options);
    if (!formatted.trim()) return "Keine Eingaben";
    const lines = formatted.split("\n").filter(Boolean);
    return `Textliste: ${lines.slice(0, 2).join(" · ")}${lines.length > 2 ? ` +${lines.length - 2}` : ""}`;
  }
  if (field.type === "radio") {
    if (typeof value !== "string" || !value.trim()) return "Nichts gewählt";
    return `Gewählt: ${value}`;
  }
  if (field.type === "checkbox") {
    if (!Array.isArray(value) || value.length === 0) return "Nichts gewählt";
    const labels = value.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
    if (!labels.length) return "Nichts gewählt";
    return `Gewählt: ${labels.slice(0, 2).join(", ")}${labels.length > 2 ? ` +${labels.length - 2}` : ""}`;
  }
  if (field.type === "rating") {
    return typeof value === "number" ? `Bewertung: ${value}` : "Keine Bewertung";
  }
  if (field.type === "ranking") {
    const labels = formatRankingAnswerForDisplay(value, field.options.map((o) => o.label));
    if (!labels) return "Kein Ranking";
    const parts = labels.split(", ");
    return `Ranking: ${parts.slice(0, 2).join(", ")}${parts.length > 2 ? ` +${parts.length - 2}` : ""}`;
  }
  return "Keine Antwort";
}

function hasFieldAnswer(field: SurveyField, value: unknown) {
  if (field.type === "text") return typeof value === "string" && value.trim().length > 0;
  if (field.type === "text_list") {
    return isTextListAnswerValid(
      value,
      field.options.map((o) => o.id),
      false,
    );
  }
  if (field.type === "radio") return typeof value === "string" && value.trim().length > 0;
  if (field.type === "checkbox") {
    return (
      Array.isArray(value) &&
      value.some((x) => typeof x === "string" && x.trim().length > 0)
    );
  }
  if (field.type === "rating") return typeof value === "number" && Number.isFinite(value);
  if (field.type === "ranking") {
    return Boolean(
      formatRankingAnswerForDisplay(value, field.options.map((o) => o.label)),
    );
  }
  return false;
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
        <Card role="dialog" aria-modal="true" className="w-full shadow-lg">
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
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onExportCopy}
                  >
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
  const isInfoIntroStep = survey.infoTextEnabled === true && stepIndex === 0;
  const visibleFields = isInfoIntroStep ? [] : step.fields;
  const canBack = stepIndex > 0;
  const canNext = stepIndex < steps.length - 1;
  const hasInfoText =
    survey.infoTextEnabled === true &&
    (survey.infoText?.trim().length ?? 0) > 0;
  const [isInfoOpen, setIsInfoOpen] = React.useState(false);

  React.useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
  }, [stepIndex]);

  React.useEffect(() => {
    setIsInfoOpen(false);
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

          <SurveyProgress
            steps={steps}
            currentStepIndex={stepIndex}
            onStepChange={setStepIndex}
          />

          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!canBack}
              onClick={() => setStepIndex(stepIndex - 1)}
            >
              Zurück
            </Button>
            {hasInfoText && stepIndex >= 1 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsInfoOpen(true)}
                aria-label="Infotext anzeigen"
              >
                <Info className="mr-2 h-4 w-4" />
                Fragebogen Information
              </Button>
            ) : (
              <div />
            )}
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
      {hasInfoText && stepIndex === 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Info</CardTitle>
          </CardHeader>
          <CardContent>
            <FormattedInfoText text={survey.infoText ?? ""} />
          </CardContent>
        </Card>
      ) : null}

      {!isInfoIntroStep ? (
        <Card>
          <CardHeader>
            <CardTitle>{step?.title || `Schritt ${stepIndex + 1}`}</CardTitle>
            {step?.description ? (
              <CardDescription>{step.description}</CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className="grid gap-4">
            {visibleFields.length === 0 ? (
              <p className="text-sm text-secondary">
                Keine Felder in diesem Schritt.
              </p>
            ) : (
              <div className="grid gap-4">
                {visibleFields.map((field) => (
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
                        placeholder={
                          survey.answerPlaceholder?.trim() || "Deine Antwort…"
                        }
                      />
                    ) : null}

                    {field.type === "text_list" ? (
                      <SurveyTextListInput
                        fieldId={field.id}
                        options={field.options}
                        value={answers[field.id]}
                        onChange={(next) => setAnswer(field.id, next)}
                        allowExtraEntries={field.allowExtraEntries !== false}
                        required={field.required}
                        placeholder={
                          survey.answerPlaceholder?.trim() || "Deine Antwort…"
                        }
                      />
                    ) : null}

                    {field.type === "radio" ? (
                      <div className="grid gap-2">
                        {field.options.map((opt) => {
                          const selected = answers[field.id] === opt.label;
                          return (
                            <label
                              key={opt.id}
                              className={cn(
                                "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm shadow-sm transition-colors hover:bg-accent",
                                selected
                                  ? "border-primary bg-primary/5"
                                  : "border-input bg-background",
                              )}
                            >
                              <input
                                type="radio"
                                name={field.id}
                                checked={selected}
                                className="peer sr-only"
                                onChange={() => setAnswer(field.id, opt.label)}
                              />
                              <span
                                aria-hidden="true"
                                className={cn(
                                  "flex h-4 w-4 items-center justify-center rounded-full border bg-background",
                                  selected
                                    ? "border-primary"
                                    : "border-primary/70",
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
                        {field.allowOtherOption === true
                          ? (() => {
                              const presetLabels = field.options.map(
                                (opt) => opt.label,
                              );
                              const otherState = getRadioOtherState(
                                answers[field.id],
                                presetLabels,
                              );
                              return (
                                <label
                                  className={cn(
                                    "grid cursor-pointer gap-2 rounded-md border px-3 py-2 text-sm shadow-sm transition-colors",
                                    otherState.selected
                                      ? "border-primary bg-primary/5"
                                      : "border-input bg-background",
                                  )}
                                >
                                  <span className="flex items-center gap-3">
                                    <input
                                      type="radio"
                                      name={field.id}
                                      checked={otherState.selected}
                                      className="peer sr-only"
                                      onChange={() =>
                                        setAnswer(field.id, RADIO_OTHER_TOKEN)
                                      }
                                    />
                                    <span
                                      aria-hidden="true"
                                      className={cn(
                                        "flex h-4 w-4 items-center justify-center rounded-full border bg-background",
                                        otherState.selected
                                          ? "border-primary"
                                          : "border-primary/70",
                                      )}
                                    >
                                      <span
                                        className={cn(
                                          "h-2 w-2 rounded-full bg-primary transition-opacity",
                                          otherState.selected
                                            ? "opacity-100"
                                            : "opacity-0",
                                        )}
                                      />
                                    </span>
                                    Andere
                                  </span>
                                  {otherState.selected ? (
                                    <Input
                                      value={otherState.text}
                                      placeholder="Eigene Option eingeben…"
                                      onChange={(e) =>
                                        setAnswer(
                                          field.id,
                                          buildRadioAnswer(e.target.value),
                                        )
                                      }
                                    />
                                  ) : null}
                                </label>
                              );
                            })()
                          : null}
                      </div>
                    ) : null}

                    {field.type === "checkbox" ? (
                      <div className="grid gap-2">
                        {(() => {
                          const presetLabels = field.options.map(
                            (o) => o.label,
                          );
                          const otherState = parseCheckboxOtherEntries(
                            answers[field.id],
                            presetLabels,
                          );
                          return (
                            <>
                              {field.options.map((opt) => {
                                const checked = otherState.selectedPresets.has(
                                  opt.label,
                                );
                                return (
                                  <label
                                    key={opt.id}
                                    className={cn(
                                      "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm shadow-sm transition-colors hover:bg-accent",
                                      checked
                                        ? "border-primary bg-primary/5"
                                        : "border-input bg-background",
                                    )}
                                  >
                                    <Checkbox
                                      checked={checked}
                                      onCheckedChange={(next) => {
                                        const nextSet = new Set(
                                          otherState.selectedPresets,
                                        );
                                        if (next) nextSet.add(opt.label);
                                        else nextSet.delete(opt.label);
                                        setAnswer(
                                          field.id,
                                          buildCheckboxAnswer(
                                            presetLabels,
                                            nextSet,
                                            otherState.otherEntries,
                                          ),
                                        );
                                      }}
                                    />
                                    {opt.label}
                                  </label>
                                );
                              })}

                              {field.allowOtherOption !== false
                                ? otherState.otherEntries.map(
                                    (entry, entryIdx) => (
                                      <div
                                        key={entry.id}
                                        className={cn(
                                          "flex items-center gap-3 rounded-md border px-3 py-2 text-sm shadow-sm transition-colors hover:bg-accent",
                                          "border-primary bg-primary/5",
                                        )}
                                      >
                                        <Checkbox
                                          checked
                                          onCheckedChange={(next) => {
                                            if (next !== false) return;
                                            setAnswer(
                                              field.id,
                                              removeCheckboxOtherEntry(
                                                answers[field.id],
                                                presetLabels,
                                                entry.id,
                                              ),
                                            );
                                          }}
                                        />
                                        <Input
                                          value={entry.text}
                                          placeholder={`Eigene Option ${entryIdx + 1}…`}
                                          className="h-9 min-w-0 flex-1"
                                          onChange={(e) =>
                                            setAnswer(
                                              field.id,
                                              setCheckboxOtherEntryText(
                                                answers[field.id],
                                                presetLabels,
                                                entry.id,
                                                e.target.value,
                                              ),
                                            )
                                          }
                                        />
                                      </div>
                                    ),
                                  )
                                : null}

                              {field.allowOtherOption !== false ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="w-full justify-center sm:w-auto"
                                  onClick={() =>
                                    setAnswer(
                                      field.id,
                                      addCheckboxOtherEntry(
                                        answers[field.id],
                                        presetLabels,
                                      ),
                                    )
                                  }
                                >
                                  <Plus className="mr-2 h-4 w-4" />
                                  Andere / eigene Option hinzufügen
                                </Button>
                              ) : null}
                            </>
                          );
                        })()}
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

                    {field.type === "text_list" ? (
                      <SurveyTextListInput
                        fieldId={field.id}
                        options={field.options}
                        value={answers[field.id]}
                        onChange={(next) => setAnswer(field.id, next)}
                        allowExtraEntries={field.allowExtraEntries !== false}
                        required={field.required}
                        placeholder={
                          survey.answerPlaceholder?.trim() || "Deine Antwort…"
                        }
                      />
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
      ) : null}

      <div className="flex items-center justify-end">
        <Button onClick={onExitPreview} variant="secondary">
          <Pencil className="mr-2 h-4 w-4" />
          Vorschau schließen
        </Button>
      </div>
      {hasInfoText && isInfoOpen ? (
        <div
          className="fixed inset-0 z-[120] bg-black/50 p-4 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setIsInfoOpen(false);
          }}
        >
          <div className="mx-auto flex min-h-full w-full max-w-3xl items-center px-4">
            <Card className="w-full">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">Info</CardTitle>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Info schließen"
                    onClick={() => setIsInfoOpen(false)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <FormattedInfoText text={survey.infoText ?? ""} />
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
}
