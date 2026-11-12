"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { downloadMarkdown } from "@/app/dashboard/transkripte/_components/download-markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CenteredModal } from "@/components/ui/centered-modal";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  anbieterHasSavedPoints,
  buildCurrentAnbieterMarkdown,
} from "@/lib/dt/transcripts/anbieter-markdown";
import {
  AVATAR_PLAN_MAX,
  AVATAR_PLAN_MIN,
} from "@/lib/dt/transcripts/avatar-plan-bounds";
import { markdownDownloadName } from "@/lib/dt/transcripts/markdown-file";

export const WORKSHOP_CHANGED_EVENT = "dt-workshop-changed";

type SectionStatus = "empty" | "proposed" | "approved" | "stale";

type WorkshopSourceView = {
  id: string;
  title: string | null;
  filename: string | null;
  sourceKind: "raw" | "summary";
  spokenOn: string | null;
  createdAt: string;
  hasSummary: boolean;
};

type AnbieterItem = {
  key: string;
  label: string;
  current: string;
  earlier: string | null;
  sources: string;
  conflicts?: {
    topic: string;
    claims: {
      text: string;
      source: string;
      date: string | null;
      dateOrigin?: "gespraech" | "dokument" | "dateiname" | "upload";
      newest: boolean;
      ids: string[];
    }[];
  }[];
};

type AnbieterState = {
  status: SectionStatus;
  sourceFingerprint: string | null;
  approvedFingerprint: string | null;
  revisionNote: string;
  items: AnbieterItem[];
  savedAt: string | null;
  openWithSource?: { key: string; label: string; sources: string[] }[];
  review?: AnbieterReview | null;
  sync?: { added: string[]; changed: string[]; removed: number };
};

type AnbieterMode = "full" | "merge" | "remove";

type AnbieterReview = {
  statementCount: number;
  sourceCount: number;
  unassigned: { id: string; text: string; source: string }[];
  unassignedCount: number;
  missingFacts: { kind: string; value: string; sources: string[]; context: string }[];
  internal?: { id: string; text: string; source: string }[];
  guardrails?: { rule: string; ids: string[] }[];
  lostInRevision: { id: string | null; text: string; source: string; point: string }[];
};

const FACT_LABEL: Record<string, string> = {
  euro: "Euro-Betrag",
  prozent: "Prozentangabe",
  datum: "Datum",
  jahr: "Jahreszahl",
  zahl: "Zahl",
  url: "URL",
  email: "E-Mail-Adresse",
  telefon: "Telefonnummer",
  name: "Eigenname",
};

const DATE_ORIGIN_NOTE: Record<string, string> = {
  gespraech: "Gesprächsdatum",
  dokument: "Stand laut Dokument",
  dateiname: "Datum aus dem Dateinamen",
  upload: "Upload-Datum, im Dokument steht keins",
};

function formatIsoDate(iso: string | null): string {
  const [year, month, day] = (iso ?? "").split("-");
  return year && month && day ? `${day}.${month}.${year}` : "";
}

type AvatarCase = {
  service: string;
  summary: string;
  quotes: string[];
};

type AvatarRueckfrage = { block: string; frage: string; vorschlag: string };

type AvatarGeneratorMeta = {
  abgeleitet: Array<{ block: string; aussage: string; grund: string }>;
  fehlende_daten: string[];
  zusatzbloecke: string[];
  offene_fragen: string[];
};

type AvatarGeneratorDraft = {
  promptTemplate: string;
  name: string;
  role: string;
  icon: string;
  quickActions: string[];
};

type AvatarGenerator = {
  status: "rueckfragen" | "fehler" | "fertig";
  rueckfragen: AvatarRueckfrage[];
  meta: AvatarGeneratorMeta | null;
  errors: string[];
  /** With status „fehler“: the result that was not saved. */
  draft: AvatarGeneratorDraft | null;
};

/** The editable fields of a rejected draft; Quick Actions one per line. */
type DraftForm = { promptTemplate: string; name: string; role: string; quickActions: string };

type GeneratorMode = "generate" | "answers" | "draft";

type WorkshopAvatar = {
  key: string;
  title: string;
  whySeparate: string;
  cases: AvatarCase[];
  generator: AvatarGenerator | null;
  agentId: string | null;
};

type AvatarPlan = {
  status: SectionStatus;
  sourceFingerprint: string | null;
  approvedFingerprint: string | null;
  revisionNote: string;
  notWanted: string;
  hinweis: string;
  avatars: WorkshopAvatar[];
};

type GenerateOutcome = "created" | "updated" | "rueckfragen" | "invalid" | "failed";

/** Bounds of „Anzahl Avatare“ — shared with the server (`AVATAR_PLAN_*`). */
const AVATAR_COUNT_MIN = AVATAR_PLAN_MIN;
const AVATAR_COUNT_MAX = AVATAR_PLAN_MAX;

function formatSpoken(iso: string | null): string {
  if (!iso) return "ohne Datum";
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${day}.${month}.${year}`;
}

function statusLabel(status: SectionStatus): string {
  switch (status) {
    case "approved":
      return "Freigegeben";
    case "proposed":
      return "Wartet auf Freigabe";
    case "stale":
      return "Bestand hat sich geändert";
    default:
      return "Noch offen";
  }
}

function formatSavedAt(iso: string | null): string {
  if (!iso) return "Speicherzeitpunkt unbekannt (älterer Stand)";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Speicherzeitpunkt unbekannt";
  return `Gespeichert am ${d.toLocaleString("de-DE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function sourceLabel(source: WorkshopSourceView, index: number): string {
  return `${formatSpoken(source.spokenOn)} · ${source.title || source.filename || `Gespräch ${index + 1}`}`;
}

function MetaList(props: { title: string; items: string[] }) {
  if (props.items.length === 0) return null;
  return (
    <div className="grid gap-1">
      <p className="font-medium text-primary">{props.title}</p>
      <ul className="list-disc space-y-0.5 pl-5">
        {props.items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function statusBadge(status: SectionStatus) {
  if (status === "approved") return <Badge>Freigegeben</Badge>;
  if (status === "stale") return <Badge variant="destructive">Veraltet</Badge>;
  if (status === "proposed") return <Badge variant="secondary">Zur Freigabe</Badge>;
  return <Badge variant="outline">Offen</Badge>;
}

export function WorkshopBoard(props: { organisationId: string; organisationName: string }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<WorkshopSourceView[]>([]);
  const [anbieter, setAnbieter] = useState<AnbieterState | null>(null);
  const [avatarPlan, setAvatarPlan] = useState<AvatarPlan | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [notWanted, setNotWanted] = useState("");
  const [anbieterError, setAnbieterError] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [anbieterNote, setAnbieterNote] = useState("");
  /** Progress line of a running Anbieter evaluation. */
  const [anbieterStep, setAnbieterStep] = useState<string | null>(null);
  /** Open missing facts or contradictions: approving asks once more. */
  const [confirmApprove, setConfirmApprove] = useState(false);
  /** A source was deleted: ask what happens to its content in the stand. */
  const [askRemoved, setAskRemoved] = useState(false);
  const [avatarNote, setAvatarNote] = useState("");
  /** Empty = KI wählt die Anzahl; eine Zahl ist Override. */
  const [countText, setCountText] = useState("");
  // A count the user typed survives a reload of the Bestand until the next plan.
  const countTouched = useRef(false);
  /** Edited answers to the Rückfragen, per avatar and question; untouched ones keep the Vorschlag. */
  const [answers, setAnswers] = useState<Record<string, Record<number, string>>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [runningMode, setRunningMode] = useState<GeneratorMode | null>(null);
  /** Edits of a rejected draft, per avatar; untouched fields show the stored draft. */
  const [draftEdits, setDraftEdits] = useState<Record<string, Partial<DraftForm>>>({});

  const applyPlan = useCallback((plan: AvatarPlan) => {
    setAvatarPlan(plan);
    setTitles(Object.fromEntries(plan.avatars.map((avatar) => [avatar.key, avatar.title])));
    setNotWanted(plan.notWanted);
    // Untouched = auto: keep the field empty. A typed override stays via countTouched.
    if (!countTouched.current) setCountText("");
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(
        `/api/dt/workshop?org=${encodeURIComponent(props.organisationId)}`,
      );
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        sources?: WorkshopSourceView[];
        anbieter?: AnbieterState;
        avatarPlan?: AvatarPlan;
      };
      if (!res.ok || !json.ok || !json.anbieter || !json.avatarPlan) {
        setError(json.message ?? "Workshop konnte nicht geladen werden.");
        return;
      }
      setSources(json.sources ?? []);
      setAnbieter(json.anbieter);
      setAskRemoved((json.anbieter.sync?.removed ?? 0) > 0);
      applyPlan(json.avatarPlan);
      setAnbieterNote(json.anbieter.revisionNote ?? "");
      setAvatarNote(json.avatarPlan.revisionNote ?? "");
    } catch {
      setError("Workshop konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [props.organisationId, applyPlan]);

  useEffect(() => {
    // Another organisation: its own count and no answers carried over.
    countTouched.current = false;
    setAnswers({});
    setDraftEdits({});
    setLoading(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    function onChanged(event: Event) {
      const detail = (event as CustomEvent<{ organisationId?: string }>).detail;
      if (detail?.organisationId && detail.organisationId !== props.organisationId) return;
      void refresh();
    }
    window.addEventListener(WORKSHOP_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(WORKSHOP_CHANGED_EVENT, onChanged);
  }, [props.organisationId, refresh]);

  async function postJson<T>(
    url: string,
    body: Record<string, unknown>,
  ): Promise<
    { ok: true; json: T } | { ok: false; message: string; json: Record<string, unknown> | null }
  > {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 280_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => null)) as (T & { ok?: boolean; message?: string }) | null;
      if (!res.ok || !json?.ok) {
        return {
          ok: false,
          message: json?.message ?? "Der Schritt ist fehlgeschlagen.",
          json: json as Record<string, unknown> | null,
        };
      }
      return { ok: true, json };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return {
          ok: false,
          message: "Die Anfrage hat zu lange gedauert und wurde abgebrochen. Bitte erneut versuchen.",
          json: null,
        };
      }
      return { ok: false, message: "Der Schritt ist fehlgeschlagen. Bitte erneut versuchen.", json: null };
    } finally {
      clearTimeout(timer);
    }
  }

  async function postAnbieter(
    action: "evaluate" | "approve" | "keep-removed",
    instruction?: string,
    mode: AnbieterMode = "full",
  ) {
    const revising = action === "evaluate" && Boolean(instruction?.trim());
    setBusy(
      action === "approve"
        ? "anbieter-approve"
        : action === "keep-removed"
          ? "anbieter-keep"
          : revising
            ? "anbieter-revise"
            : mode === "full"
              ? "anbieter-evaluate"
              : `anbieter-${mode}`,
    );
    setAnbieterError(null);
    setAnbieterStep(null);
    try {
      if (action === "evaluate") {
        // Stage 1: statements out of every source, a few pieces per request, until none is left.
        let lastPending = Number.POSITIVE_INFINITY;
        let stalled = 0;
        for (;;) {
          setAnbieterStep((step) => step ?? "Schritt 1 von 2: Aussagen aus den Quellen ziehen…");
          const round = await postJson<{ pending?: number; total?: number; read?: number }>(
            "/api/dt/workshop/anbieter",
            { organisationId: props.organisationId, action: "extract" },
          );
          if (!round.ok) {
            setAnbieterError(round.message);
            toast.error(round.message);
            return;
          }
          const pending = round.json.pending ?? 0;
          if (pending === 0) break;
          stalled = pending < lastPending ? 0 : stalled + 1;
          lastPending = pending;
          if (stalled >= 2) {
            const message = "Aus einem Teil der Quellen ließen sich keine Aussagen ziehen. Bitte erneut auswerten.";
            setAnbieterError(message);
            toast.error(message);
            return;
          }
          setAnbieterStep(
            `Schritt 1 von 2: Aussagen aus den Quellen ziehen… ${round.json.read ?? 0} von ${round.json.total ?? 0} Abschnitten gelesen.`,
          );
        }
        setAnbieterStep(
          revising
            ? "Schritt 2 von 2: Änderung einarbeiten und gegen den vorherigen Stand prüfen…"
            : mode === "merge"
              ? "Schritt 2 von 2: Neue Aussagen in die bestehenden Punkte einarbeiten…"
              : mode === "remove"
                ? "Schritt 2 von 2: Inhalte der gelöschten Quelle aus den Punkten nehmen…"
                : "Schritt 2 von 2: Aussagen den Punkten zuordnen und Abdeckung prüfen…",
        );
      }
      const result = await postJson<{ anbieter?: AnbieterState }>("/api/dt/workshop/anbieter", {
        organisationId: props.organisationId,
        action,
        ...(action === "evaluate" && mode !== "full" ? { mode } : {}),
        ...(instruction?.trim() ? { instruction: instruction.trim() } : {}),
      });
      if (!result.ok) {
        setAnbieterError(result.message);
        toast.error(result.message);
        return;
      }
      if (!result.json.anbieter) {
        const message = "Die Auswertung hat keinen Stand zurückgegeben.";
        setAnbieterError(message);
        toast.error(message);
        return;
      }
      if (action === "evaluate" && result.json.anbieter.status === "empty") {
        const message =
          "Die Auswertung hat keinen belegten Punkt geliefert. Die Freigabe bleibt deshalb gesperrt.";
        setAnbieterError(message);
        toast.error(message);
        return;
      }
      setAnbieter(result.json.anbieter);
      if (revising) setAnbieterNote(result.json.anbieter.revisionNote ?? "");
      setAskRemoved(false);
      toast.success(
        action === "keep-removed"
          ? "Die Inhalte bleiben im Anbieterwissen stehen."
          : mode === "merge"
            ? "Die neue Quelle ist eingearbeitet. Bitte prüfen und freigeben."
            : mode === "remove"
              ? "Die Inhalte der gelöschten Quelle sind entfernt. Bitte prüfen und freigeben."
              : revising
          ? "Die Änderung ist eingearbeitet. Bitte prüfen und freigeben."
          : action === "evaluate"
            ? "Anbieterstand liegt vor. Bitte prüfen und freigeben."
            : "Freigegeben. Der SEO-Berater hat den aktuellen Stand.",
      );
    } finally {
      setAnbieterStep(null);
      setBusy(null);
    }
  }

  async function postAvatars(body: Record<string, unknown>, busyKey: string, success: string) {
    setBusy(busyKey);
    setAvatarError(null);
    try {
      const result = await postJson<{ avatarPlan?: AvatarPlan }>("/api/dt/workshop/avatars", {
        organisationId: props.organisationId,
        ...body,
      });
      if (!result.ok) {
        setAvatarError(result.message);
        toast.error(result.message);
        if (result.json?.missingSummaries) void refresh();
        return;
      }
      if (!result.json.avatarPlan) {
        const message = "Der Avatar-Schritt hat nichts zurückgegeben.";
        setAvatarError(message);
        toast.error(message);
        return;
      }
      // Auto plan: back to empty. Override: keep the typed count for the next run.
      if (body.action === "plan" && body.count == null) countTouched.current = false;
      applyPlan(result.json.avatarPlan);
      if (body.instruction) setAvatarNote(result.json.avatarPlan.revisionNote ?? "");
      toast.success(success);
    } finally {
      setBusy(null);
    }
  }

  /** One run of the avatar generator; the caller holds `busy`. */
  function draftForm(avatar: WorkshopAvatar): DraftForm {
    const stored = avatar.generator?.draft;
    const edits = draftEdits[avatar.key] ?? {};
    return {
      promptTemplate: edits.promptTemplate ?? stored?.promptTemplate ?? "",
      name: edits.name ?? stored?.name ?? "",
      role: edits.role ?? stored?.role ?? "",
      quickActions: edits.quickActions ?? (stored?.quickActions ?? []).join("\n"),
    };
  }

  function editDraft(key: string, patch: Partial<DraftForm>) {
    setDraftEdits((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  /**
   * One run for one avatar: a new generator run, the answers to its Rückfragen, or the
   * corrected draft („Prüfen und speichern“, no model call). The caller holds `busy`.
   */
  async function runGenerator(
    avatar: WorkshopAvatar,
    mode: GeneratorMode,
  ): Promise<{ outcome: GenerateOutcome; message?: string }> {
    setRunning(avatar.key);
    setRunningMode(mode);
    setAvatarError(null);
    try {
      const given =
        mode === "answers" && avatar.generator?.status === "rueckfragen"
          ? avatar.generator.rueckfragen.map((question, index) => ({
              block: question.block,
              frage: question.frage,
              antwort: (answers[avatar.key]?.[index] ?? question.vorschlag).trim(),
            }))
          : [];
      const form = draftForm(avatar);
      const result = await postJson<{ avatarPlan?: AvatarPlan; outcome?: string }>(
        "/api/dt/workshop/avatars",
        {
          organisationId: props.organisationId,
          avatarKey: avatar.key,
          ...(mode === "draft"
            ? {
                action: "save_draft",
                draft: {
                  promptTemplate: form.promptTemplate,
                  name: form.name.trim(),
                  role: form.role.trim(),
                  icon: avatar.generator?.draft?.icon ?? "",
                  quickActions: form.quickActions
                    .split("\n")
                    .map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
                    .filter(Boolean)
                    .slice(0, 12),
                },
              }
            : { action: "generate", ...(given.length > 0 ? { answers: given } : {}) }),
        },
      );
      if (!result.ok) {
        setAvatarError(result.message);
        if (result.json?.missingSummaries) void refresh();
        return { outcome: "failed", message: result.message };
      }
      if (result.json.avatarPlan) applyPlan(result.json.avatarPlan);
      setAnswers((prev) => {
        const next = { ...prev };
        delete next[avatar.key];
        return next;
      });
      setDraftEdits((prev) => {
        const next = { ...prev };
        delete next[avatar.key];
        return next;
      });
      const outcome = result.json.outcome;
      return outcome === "created" || outcome === "updated" || outcome === "rueckfragen" || outcome === "invalid"
        ? { outcome }
        : { outcome: "failed", message: "Der Avatar-Schritt hat nichts zurückgegeben." };
    } finally {
      setRunning(null);
      setRunningMode(null);
    }
  }

  async function generateOne(avatar: WorkshopAvatar, mode: GeneratorMode) {
    setBusy(`generate:${avatar.key}`);
    try {
      const { outcome, message } = await runGenerator(avatar, mode);
      const title = titles[avatar.key] ?? avatar.title;
      if (outcome === "created") toast.success(`${title}: Avatar erstellt. Er steht jetzt in Agenten.`);
      else if (outcome === "updated") toast.success(`${title}: Avatar aktualisiert.`);
      else if (outcome === "rueckfragen") toast(`${title}: Der Generator hat Rückfragen. Bitte beantworten.`);
      else if (outcome === "invalid") toast.error(`${title}: Der Avatar-Text hat Regeln verletzt und wurde nicht gespeichert.`);
      else toast.error(message ?? "Der Avatar-Schritt ist fehlgeschlagen.");
    } finally {
      setBusy(null);
    }
  }

  /** „Alle Avatare erstellen“: every avatar without an agent, one after the other; open Rückfragen wait. */
  async function generateAll() {
    const pending = (avatarPlan?.avatars ?? []).filter(
      (avatar) => !avatar.agentId && avatar.generator?.status !== "rueckfragen",
    );
    if (pending.length === 0) return;
    setBusy("generate-all");
    const counts = { done: 0, rueckfragen: 0, invalid: 0, failed: 0 };
    try {
      for (const avatar of pending) {
        const { outcome } = await runGenerator(avatar, "generate");
        if (outcome === "created" || outcome === "updated") counts.done += 1;
        else counts[outcome] += 1;
      }
    } finally {
      setBusy(null);
    }
    const parts = [
      counts.done ? `${counts.done} erstellt` : "",
      counts.rueckfragen ? `${counts.rueckfragen} mit Rückfragen` : "",
      counts.invalid ? `${counts.invalid} nicht gespeichert (Regeln verletzt)` : "",
      counts.failed ? `${counts.failed} fehlgeschlagen` : "",
    ].filter(Boolean);
    const text = `Avatare: ${parts.join(", ")}.`;
    if (counts.invalid || counts.failed) toast.error(text);
    else toast.success(text);
  }

  const planEditable = avatarPlan?.status === "proposed";
  // The saved points stay visible in every status, also when the Bestand changed since.
  const anbieterHasPoints = anbieterHasSavedPoints(anbieter?.items ?? []);
  // Empty points for which a source has a filled section under this very heading.
  const anbieterReview = anbieter?.review ?? null;
  const anbieterConflictCount = (anbieter?.items ?? []).reduce(
    (sum, item) => sum + (item.conflicts?.length ?? 0),
    0,
  );
  const anbieterSync = anbieter?.sync ?? { added: [], changed: [], removed: 0 };
  // Working in a new source needs a checked stand, and no source may have changed meanwhile.
  const anbieterCanMerge =
    anbieter?.status === "stale" &&
    Boolean(anbieterReview) &&
    anbieterSync.added.length > 0 &&
    anbieterSync.changed.length === 0;
  const anbieterInternal = anbieterReview?.internal ?? [];
  const anbieterGuardrails = anbieterReview?.guardrails ?? [];
  const anbieterGuardedIds = new Set(anbieterGuardrails.flatMap((guardrail) => guardrail.ids));
  const anbieterInternalUncovered = anbieterInternal.filter((s) => !anbieterGuardedIds.has(s.id)).length;
  const anbieterMissingCount = anbieterReview?.missingFacts.length ?? 0;
  const anbieterNeedsConfirm = anbieterMissingCount > 0 || anbieterConflictCount > 0;
  const anbieterLost = new Map((anbieter?.openWithSource ?? []).map((point) => [point.key, point]));
  const missingSummaries = sources
    .map((source, index) => ({ id: source.id, label: sourceLabel(source, index), hasSummary: source.hasSummary }))
    .filter((source) => !source.hasSummary);
  const countTrimmed = countText.trim();
  const countAuto = countTrimmed === "";
  const countValue = Number.parseInt(countTrimmed, 10);
  const countValid =
    countAuto ||
    (Number.isInteger(countValue) && countValue >= AVATAR_COUNT_MIN && countValue <= AVATAR_COUNT_MAX);
  const planCountBody = countAuto ? {} : { count: countValue };
  const pendingAvatars = (avatarPlan?.avatars ?? []).filter(
    (avatar) => !avatar.agentId && avatar.generator?.status !== "rueckfragen",
  );
  const agentsHref = `/dashboard/verwaltung/agents?org=${encodeURIComponent(props.organisationId)}`;

  return (
    <div className="grid gap-6">
      <CenteredModal
        open={askRemoved && busy == null && anbieterSync.removed > 0}
        onClose={() => setAskRemoved(false)}
        title="Quelle gelöscht"
        description="Inhalte dieser Quelle aus dem Anbieterwissen entfernen oder stehen lassen?"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setAskRemoved(false)}>
              Später entscheiden
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setAskRemoved(false);
                void postAnbieter("keep-removed");
              }}
            >
              Stehen lassen
            </Button>
            <Button
              type="button"
              className="bg-sbkm-navy text-white hover:bg-sbkm-ink-700"
              onClick={() => {
                setAskRemoved(false);
                void postAnbieter("evaluate", undefined, "remove");
              }}
            >
              Inhalte entfernen
            </Button>
          </div>
        }
      >
        <ul className="list-disc pl-5 text-sm text-primary">
          <li>
            <strong>Inhalte entfernen:</strong> Die Punkte, in denen Aussagen dieser Quelle stehen,
            werden aus den übrigen Quellen neu geschrieben. Alle anderen Punkte bleiben wörtlich. Danach
            ist eine neue Freigabe nötig.
          </li>
          <li>
            <strong>Stehen lassen:</strong> Das Anbieterwissen bleibt Wort für Wort, wie es ist, und
            behält seine Freigabe.
          </li>
        </ul>
      </CenteredModal>
      <CenteredModal
        open={confirmApprove}
        onClose={() => setConfirmApprove(false)}
        title="Trotzdem freigeben?"
        description="Die Kontrolle gegen den Bestand hat offene Punkte gefunden."
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirmApprove(false)}>
              Zurück und prüfen
            </Button>
            <Button
              type="button"
              className="bg-sbkm-navy text-white hover:bg-sbkm-ink-700"
              onClick={() => {
                setConfirmApprove(false);
                void postAnbieter("approve");
              }}
            >
              Trotzdem freigeben
            </Button>
          </div>
        }
      >
        <ul className="list-disc pl-5 text-sm text-primary">
          {anbieterMissingCount > 0 ? (
            <li>
              {anbieterMissingCount === 1
                ? "1 Fakt aus dem Bestand fehlt im Ergebnis."
                : `${anbieterMissingCount} Fakten aus dem Bestand fehlen im Ergebnis.`}
            </li>
          ) : null}
          {anbieterConflictCount > 0 ? (
            <li>
              {anbieterConflictCount === 1
                ? "1 Widerspruch ist ungeklärt."
                : `${anbieterConflictCount} Widersprüche sind ungeklärt.`}{" "}
              Der SEO-Berater bekommt dazu nur „nicht verwenden, bis geklärt“.
            </li>
          ) : null}
        </ul>
      </CenteredModal>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bestand</CardTitle>
          <CardDescription>
            Alle Gespräche dieser Organisation, in Gesprächsreihenfolge. Eine spätere Aussage zum
            selben Punkt ersetzt die frühere. Die frühere bleibt hier sichtbar.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-secondary">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Lade Bestand…
            </p>
          ) : sources.length === 0 ? (
            <p className="text-sm text-secondary">
              Noch kein Gespräch. Oben ein Rohtranskript oder eine Zusammenfassung speichern.
            </p>
          ) : (
            <ol className="grid gap-2">
              {sources.map((source, index) => (
                <li
                  key={source.id}
                  className="flex flex-wrap items-center gap-2 text-sm text-primary"
                >
                  <span className="text-xs text-secondary">{index + 1}.</span>
                  <span className="font-medium">{formatSpoken(source.spokenOn)}</span>
                  <span>{source.title || source.filename || "Ohne Titel"}</span>
                  <Badge variant="outline">
                    {source.sourceKind === "summary" ? "Zusammenfassung" : "Rohtranskript"}
                  </Badge>
                  {source.hasSummary ? (
                    <span className="text-xs text-secondary">Zusammenfassung liegt vor</span>
                  ) : (
                    <span className="text-xs text-secondary">Noch ohne Zusammenfassung</span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">1. Anbieter</CardTitle>
            {anbieter ? statusBadge(anbieter.status) : null}
          </div>
          <CardDescription>
            Jeder Punkt aus dem gesamten Wortlaut, inklusive Ablauf und Mitwirkung. Jede Angabe
            bleibt erhalten. Freigabe schreibt nur den aktuellen Stand in den SEO-Berater. Offene
            Punkte bleiben offen.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            {anbieterCanMerge ? (
              <Button
                type="button"
                className="bg-sbkm-navy text-white hover:bg-sbkm-ink-700"
                disabled={loading || busy != null}
                onClick={() => void postAnbieter("evaluate", undefined, "merge")}
              >
                {busy === "anbieter-merge" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {busy === "anbieter-merge" ? "Arbeitet ein…" : "Nur einarbeiten"}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              disabled={loading || sources.length === 0 || busy != null}
              onClick={() => void postAnbieter("evaluate")}
            >
              {busy === "anbieter-evaluate" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              {busy === "anbieter-evaluate"
                ? "Wertet aus…"
                : anbieterCanMerge
                  ? "Komplett neu auswerten"
                  : anbieter && anbieter.status !== "empty"
                    ? "Bestand neu auswerten"
                    : "Bestand auswerten"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={loading || sources.length === 0 || busy != null || !anbieterNote.trim()}
              onClick={() => void postAnbieter("evaluate", anbieterNote)}
            >
              {busy === "anbieter-revise" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              {busy === "anbieter-revise" ? "Passt an…" : "Änderung anwenden"}
            </Button>
            {anbieter?.status === "proposed" ? (
              <Button
                type="button"
                className="bg-sbkm-navy text-white hover:bg-sbkm-ink-700"
                disabled={busy != null}
                onClick={() => (anbieterNeedsConfirm ? setConfirmApprove(true) : void postAnbieter("approve"))}
              >
                {busy === "anbieter-approve" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <CheckCircle2 className="size-4" aria-hidden />
                )}
                {anbieter.approvedFingerprint
                  ? "Erneut freigeben"
                  : "Freigeben und in den SEO-Berater schreiben"}
              </Button>
            ) : null}
          </div>
          {anbieterCanMerge && busy == null ? (
            <p className="text-sm text-primary">
              Neu im Bestand: {anbieterSync.added.join(", ")}. „Nur einarbeiten“ liest nur diese{" "}
              {anbieterSync.added.length === 1 ? "Quelle" : "Quellen"} und ergänzt die bestehenden Punkte;
              der vorhandene Text bleibt wörtlich. „Komplett neu auswerten“ schreibt alle Punkte aus allen
              Quellen neu.
            </p>
          ) : null}
          {anbieterSync.changed.length > 0 && anbieter?.status === "stale" && busy == null ? (
            <p className="text-sm text-primary">
              Geändert wurde: {anbieterSync.changed.join(", ")}. Eine geänderte Quelle lässt sich nicht
              einarbeiten, nur komplett neu auswerten.
            </p>
          ) : null}
          {anbieterSync.removed > 0 && busy == null ? (
            <div className="grid gap-2 rounded-xl border border-sbkm-navy/10 px-3 py-3 dark:border-white/10">
              <p className="text-sm text-primary">
                {anbieterSync.removed === 1
                  ? "Eine Quelle wurde gelöscht. Ihre Inhalte stehen noch im Anbieterwissen."
                  : `${anbieterSync.removed} Quellen wurden gelöscht. Ihre Inhalte stehen noch im Anbieterwissen.`}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => void postAnbieter("evaluate", undefined, "remove")}>
                  Inhalte entfernen
                </Button>
                <Button type="button" variant="outline" onClick={() => void postAnbieter("keep-removed")}>
                  Stehen lassen
                </Button>
              </div>
            </div>
          ) : null}
          {busy === "anbieter-evaluate" || busy === "anbieter-revise" || busy === "anbieter-merge" || busy === "anbieter-remove" ? (
            <p className="flex items-center gap-2 text-sm text-primary">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {anbieterStep ??
                (busy === "anbieter-revise"
                  ? "Die Änderung wird in den Anbieterstand eingearbeitet."
                  : "Die Auswertung läuft.")}{" "}
              Das kann einige Minuten dauern. Die Buttons sind solange gesperrt.
            </p>
          ) : null}
          <div className="grid gap-1.5">
            <p className="text-sm font-medium text-primary">Änderung</p>
            <Textarea
              value={anbieterNote}
              onChange={(event) => setAnbieterNote(event.target.value)}
              placeholder="Was soll anders werden? Nenne die Punkte mit Namen, z. B. „Preis & Positionierung“. Nur diese werden neu geschrieben, alle anderen bleiben wörtlich."
              className="min-h-[88px]"
            />
          </div>
          {anbieterError ? <p className="text-sm text-destructive">{anbieterError}</p> : null}
          {anbieter?.status === "empty" && busy !== "anbieter-evaluate" ? (
            <p className="text-sm text-secondary">
              Der dunkle Freigabe-Button erscheint unter den Punkten, sobald der Vorschlag da ist.
            </p>
          ) : null}
          {anbieter?.status === "stale" ? (
            <p className="text-sm text-destructive">
              Seit der letzten Auswertung ist ein Gespräch dazugekommen oder geändert worden. Der
              SEO-Berater behält den alten Stand, bis du neu auswertest und erneut freigibst.
            </p>
          ) : null}
          {anbieter?.status === "approved" ? (
            <p className="text-sm text-secondary">
              Dieser Stand ist freigegeben und im SEO-Berater gespeichert.
            </p>
          ) : null}
          {anbieter && anbieterHasPoints ? (
            <div className="grid gap-2 rounded-xl border border-sbkm-navy/10 bg-muted/40 px-3 py-3 dark:border-white/10">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-primary">Gespeicherte Zusammenfassung</p>
                  {statusBadge(anbieter.status)}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    downloadMarkdown(
                      markdownDownloadName(`${props.organisationName}-anbieterstand`),
                      `${buildCurrentAnbieterMarkdown({
                        organisationName: props.organisationName,
                        items: anbieter.items,
                        guardrails: (anbieter.review?.guardrails ?? []).map((guardrail) => guardrail.rule),
                      })}\n`,
                    )
                  }
                >
                  <Download className="size-3.5" aria-hidden />
                  Als .md herunterladen
                </Button>
              </div>
              <p className="text-sm text-primary">Diesen Stand nutzt Texte als Anbieterfakten.</p>
              <p className="text-xs text-secondary">{formatSavedAt(anbieter.savedAt)}</p>
            </div>
          ) : null}
          {anbieter && anbieterHasPoints && anbieterLost.size > 0 ? (
            <div
              role="alert"
              className="grid gap-1 rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-3"
            >
              <p className="text-sm font-semibold text-destructive">
                {anbieterLost.size === 1
                  ? "1 Punkt ist leer, obwohl der Bestand einen Abschnitt dazu hat"
                  : `${anbieterLost.size} Punkte sind leer, obwohl der Bestand Abschnitte dazu hat`}
              </p>
              <ul className="list-disc pl-5 text-sm text-primary">
                {[...anbieterLost.values()].map((point) => (
                  <li key={point.key}>
                    {point.label}: Abschnitt in {point.sources.join(", ")}
                  </li>
                ))}
              </ul>
              <p className="text-sm text-primary">
                Bitte neu auswerten oder die Punkte im Feld „Änderung“ mit ihrem Namen nennen, bevor
                du freigibst.
              </p>
            </div>
          ) : null}
          {anbieter && anbieterHasPoints && !anbieterReview ? (
            <p className="text-sm text-secondary">
              Dieser Stand stammt aus der Zeit vor der Abdeckungsprüfung. Erst „Bestand neu
              auswerten“ prüft ihn Aussage für Aussage gegen die Quellen.
            </p>
          ) : null}
          {anbieter && anbieterHasPoints && anbieterReview ? (
            <div className="grid gap-3 rounded-xl border border-sbkm-navy/10 px-3 py-3 dark:border-white/10">
              <p className="text-sm font-semibold text-primary">Kontrolle gegen den Bestand</p>
              <p className="text-sm text-primary">
                {anbieterReview.statementCount} Aussagen aus {anbieterReview.sourceCount}{" "}
                {anbieterReview.sourceCount === 1 ? "Quelle" : "Quellen"} ·{" "}
                {anbieterReview.unassignedCount} nicht zugeordnet · {anbieterReview.missingFacts.length}{" "}
                fehlende Fakten · {anbieterConflictCount}{" "}
                {anbieterConflictCount === 1 ? "Widerspruch" : "Widersprüche"} · {anbieterInternal.length}{" "}
                {anbieterInternal.length === 1 ? "interner Hinweis" : "interne Hinweise"}
              </p>
              {anbieterReview.lostInRevision.length > 0 ? (
                <div role="alert" className="grid gap-1 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2">
                  <p className="text-sm font-semibold text-destructive">
                    Durch die letzte Änderung entfallen ({anbieterReview.lostInRevision.length})
                  </p>
                  <p className="text-xs text-primary">
                    Das stand vorher im Anbieterstand und fehlt jetzt, ohne dass die Anweisung es
                    gestrichen hat.
                  </p>
                  <ul className="list-disc pl-5 text-sm text-primary">
                    {anbieterReview.lostInRevision.map((lost, index) => (
                      <li key={`${lost.id ?? "fact"}-${index}`}>
                        {lost.text}
                        <span className="text-secondary">
                          {" "}
                          · aus „{lost.point}“{lost.source ? ` · ${lost.source}` : ""}
                          {lost.id ? ` · Aussage ${lost.id}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {anbieterReview.missingFacts.length > 0 ? (
                <details className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2" open>
                  <summary className="cursor-pointer text-sm font-semibold text-destructive">
                    Fakten aus dem Bestand, die im Ergebnis fehlen ({anbieterReview.missingFacts.length})
                  </summary>
                  <ul className="mt-2 grid gap-1.5 text-sm text-primary">
                    {anbieterReview.missingFacts.map((fact, index) => (
                      <li key={`${fact.kind}-${fact.value}-${index}`}>
                        <span className="font-semibold text-destructive">
                          {FACT_LABEL[fact.kind] ?? fact.kind}: {fact.value}
                        </span>
                        <span className="text-secondary"> · {fact.sources.join("; ")}</span>
                        {fact.context ? (
                          <span className="block text-xs text-secondary">{fact.context}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {anbieterInternal.length > 0 ? (
                <details className="rounded-lg border border-sbkm-navy/10 px-3 py-2 dark:border-white/10" open>
                  <summary className="cursor-pointer text-sm font-semibold text-primary">
                    Interne Hinweise ({anbieterInternal.length})
                  </summary>
                  <p className="mt-1 text-xs text-secondary">
                    Im Bestand als intern oder „nicht verwenden“ gekennzeichnet. Diese Aussagen
                    stehen in keinem der 13 Punkte. Der SEO-Berater bekommt nur die Leitplanken,
                    nicht die Hinweise selbst.
                  </p>
                  <p className="mt-2 text-xs font-semibold text-primary">Leitplanken für den SEO-Berater</p>
                  {anbieterGuardrails.length > 0 ? (
                    <ul className="mt-1 list-disc pl-5 text-sm text-primary">
                      {anbieterGuardrails.map((guardrail) => (
                        <li key={guardrail.rule}>{guardrail.rule}</li>
                      ))}
                    </ul>
                  ) : null}
                  {anbieterInternalUncovered > 0 ? (
                    <p className="mt-1 text-sm text-destructive">
                      {anbieterInternalUncovered === 1
                        ? "1 interner Hinweis hat keine Leitplanke."
                        : `${anbieterInternalUncovered} interne Hinweise haben keine Leitplanke.`}{" "}
                      Bitte neu auswerten.
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs font-semibold text-primary">Hinweise im Wortlaut (bleiben intern)</p>
                  <ul className="mt-1 grid gap-1.5 text-sm text-primary">
                    {anbieterInternal.map((statement) => (
                      <li key={statement.id}>
                        {statement.text}
                        <span className="text-secondary">
                          {" "}
                          · {statement.source} · Aussage {statement.id}
                          {anbieterGuardedIds.has(statement.id) ? "" : " · ohne Leitplanke"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {anbieterReview.unassignedCount > 0 ? (
                <details className="rounded-lg border border-sbkm-navy/10 px-3 py-2 dark:border-white/10">
                  <summary className="cursor-pointer text-sm font-semibold text-primary">
                    Nicht zugeordnet ({anbieterReview.unassignedCount})
                  </summary>
                  <p className="mt-1 text-xs text-secondary">
                    Diese Aussagen stehen im Bestand, aber in keinem der 13 Punkte. Sie werden nicht
                    verworfen. Gehört eine in den Anbieterstand, nenne den Punkt im Feld „Änderung“.
                  </p>
                  <ul className="mt-2 grid gap-1.5 text-sm text-primary">
                    {anbieterReview.unassigned.map((statement) => (
                      <li key={statement.id}>
                        {statement.text}
                        <span className="text-secondary">
                          {" "}
                          · {statement.source} · Aussage {statement.id}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {anbieterReview.unassignedCount > anbieterReview.unassigned.length ? (
                    <p className="mt-2 text-xs text-secondary">
                      Angezeigt sind die ersten {anbieterReview.unassigned.length} von{" "}
                      {anbieterReview.unassignedCount}.
                    </p>
                  ) : null}
                </details>
              ) : null}
            </div>
          ) : null}
          {anbieter && anbieterHasPoints ? (
            <ul className="grid gap-3">
              {anbieter.items.map((item) => (
                <li
                  key={item.key}
                  className="rounded-xl border border-sbkm-navy/10 px-3 py-3 dark:border-white/10"
                >
                  <p className="text-sm font-semibold text-primary">{item.label}</p>
                  {item.current ? (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-primary">{item.current}</p>
                  ) : anbieterLost.has(item.key) ? (
                    <p className="mt-1 text-sm text-destructive">
                      Leer, obwohl ein Abschnitt „{item.label}“ im Bestand steht (
                      {anbieterLost.get(item.key)?.sources.join(", ")}). Die Auswertung hat ihn nicht
                      übernommen.
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-secondary">Offen. Wird nicht erfunden.</p>
                  )}
                  {(item.conflicts ?? []).map((conflict, index) => (
                    <div
                      key={`${item.key}-conflict-${index}`}
                      className="mt-2 grid gap-1 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2"
                    >
                      <p className="text-sm font-semibold text-destructive">
                        Widerspruch{conflict.topic ? `: ${conflict.topic}` : ""}
                      </p>
                      <ul className="grid gap-1 text-sm text-primary">
                        {conflict.claims.map((claim, claimIndex) => (
                          <li key={claimIndex}>
                            {claim.text}
                            <span className="text-secondary">
                              {" "}
                              · {claim.source}
                              {formatIsoDate(claim.date)
                                ? ` · ${formatIsoDate(claim.date)}${
                                    claim.dateOrigin ? ` (${DATE_ORIGIN_NOTE[claim.dateOrigin]})` : ""
                                  }`
                                : ""}
                            </span>
                            {claim.newest ? (
                              <span className="ml-1 rounded bg-sbkm-navy/10 px-1.5 py-0.5 text-xs font-semibold text-primary dark:bg-white/10">
                                neuere Quelle
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                      <p className="text-xs text-secondary">
                        Keine Angabe wurde ausgewählt. Kläre es im Feld „Änderung“ mit dem Namen des
                        Punkts.
                      </p>
                    </div>
                  ))}
                  {item.earlier ? (
                    <p className="mt-2 text-xs text-secondary">
                      Zuerst: {item.earlier}
                      {item.sources ? ` · ${item.sources}` : ""}
                    </p>
                  ) : item.sources ? (
                    <p className="mt-2 text-xs text-secondary">{item.sources}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-secondary">{statusLabel(anbieter?.status ?? "empty")}.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">2. Avatar-Plan</CardTitle>
            {avatarPlan ? statusBadge(avatarPlan.status) : null}
          </div>
          <CardDescription>
            Die KI schlägt vor, wie viele Avatare die Zusammenfassungen hergeben, dazu Arbeitstitel
            und wen ihr nicht als Kunden wollt. Anzahl kannst du optional überschreiben.
            Grundlage sind nur die gespeicherten Zusammenfassungen und der Anbieterstand. Fälle
            sind Belege, keine eigenen Avatare. Nach der Freigabe erstellt „Avatar erstellen“ jeden
            Avatar direkt in Agenten.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid gap-1">
              <label htmlFor="avatar-plan-count" className="text-xs font-medium text-secondary">
                Anzahl Avatare (optional)
              </label>
              <Input
                id="avatar-plan-count"
                type="number"
                inputMode="numeric"
                min={AVATAR_COUNT_MIN}
                max={AVATAR_COUNT_MAX}
                step={1}
                placeholder="KI"
                value={countText}
                onChange={(event) => {
                  countTouched.current = true;
                  setCountText(event.target.value);
                }}
                aria-invalid={!countValid}
                aria-describedby="avatar-plan-count-hint"
                className="h-9 w-24"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={
                loading || sources.length === 0 || busy != null || !countValid || missingSummaries.length > 0
              }
              onClick={() =>
                void postAvatars(
                  { action: "plan", ...planCountBody },
                  "plan",
                  "Avatar-Plan liegt vor. Bitte prüfen.",
                )
              }
            >
              {busy === "plan" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {busy === "plan" ? "Plan wird vorgeschlagen…" : "Avatar-Plan vorschlagen"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={
                loading ||
                sources.length === 0 ||
                busy != null ||
                !avatarNote.trim() ||
                !countValid ||
                missingSummaries.length > 0
              }
              onClick={() =>
                void postAvatars(
                  { action: "plan", instruction: avatarNote.trim(), ...planCountBody },
                  "plan-revise",
                  "Der Plan ist an die Änderung angepasst. Bitte prüfen.",
                )
              }
            >
              {busy === "plan-revise" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {busy === "plan-revise" ? "Passt an…" : "Änderung anwenden"}
            </Button>
            {planEditable ? (
              <Button
                type="button"
                className="bg-sbkm-navy text-white hover:bg-sbkm-ink-700"
                disabled={busy != null}
                onClick={() =>
                  void postAvatars(
                    {
                      action: "approve",
                      notWanted,
                      titles: (avatarPlan?.avatars ?? []).map((avatar) => ({
                        key: avatar.key,
                        title: (titles[avatar.key] ?? avatar.title).trim(),
                      })),
                    },
                    "approve",
                    "Avatar-Plan freigegeben. Jetzt die Avatare erstellen.",
                  )
                }
              >
                {busy === "approve" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <CheckCircle2 className="size-4" aria-hidden />
                )}
                Plan freigeben
              </Button>
            ) : null}
          </div>
          <p id="avatar-plan-count-hint" className="text-xs text-secondary">
            Leer lassen: die KI wählt {AVATAR_COUNT_MIN}–{AVATAR_COUNT_MAX} nach klar getrennten
            Gruppen. Eine Zahl erzwingt genau diese Anzahl.
          </p>
          {!countValid ? (
            <p className="text-sm text-destructive">
              Anzahl Avatare: leer (KI) oder eine ganze Zahl von {AVATAR_COUNT_MIN} bis{" "}
              {AVATAR_COUNT_MAX}.
            </p>
          ) : null}
          {missingSummaries.length > 0 ? (
            <p className="text-sm text-destructive">
              Diese Gespräche haben noch keine Zusammenfassung:{" "}
              {missingSummaries.map((item, index) => (
                <span key={item.id}>
                  {index > 0 ? ", " : null}
                  <a href={`#transkript-${item.id}`} className="font-medium underline underline-offset-2">
                    {item.label}
                  </a>
                </span>
              ))}
              . Bitte zuerst zusammenfassen.
            </p>
          ) : null}
          {busy === "plan" || busy === "plan-revise" ? (
            <p className="flex items-center gap-2 text-sm text-primary">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {busy === "plan-revise"
                ? "Die Änderung wird in den Avatar-Plan eingearbeitet."
                : "Der Avatar-Plan wird vorgeschlagen. Das kann einige Minuten dauern."}
            </p>
          ) : null}
          <div className="grid gap-1.5">
            <p className="text-sm font-medium text-primary">Änderung</p>
            <Textarea
              value={avatarNote}
              onChange={(event) => setAvatarNote(event.target.value)}
              placeholder="Was soll am Plan anders werden? Nur diese Punkte werden angepasst."
              className="min-h-[88px]"
            />
          </div>
          {avatarError ? <p className="text-sm text-destructive">{avatarError}</p> : null}
          {(avatarPlan?.status === "empty" || avatarPlan?.status === "stale") && busy !== "plan" ? (
            <p className="text-sm text-secondary">
              „Plan freigeben“ wird erst klickbar, wenn ein Vorschlag vorliegt.
            </p>
          ) : null}
          {avatarPlan?.status === "stale" ? (
            <p className="text-sm text-destructive">
              Der Bestand hat sich geändert. Bereits angelegte Avatare bleiben. Nur der Punkt, den
              ein neues Gespräch trifft, wird neu vorgeschlagen und braucht wieder eine Freigabe.
            </p>
          ) : null}
          <div className="grid gap-1.5">
            <p className="text-sm font-medium text-primary">Nicht als Kunden gewollt</p>
            <Textarea
              value={notWanted}
              onChange={(event) => setNotWanted(event.target.value)}
              readOnly={!planEditable}
              placeholder="Wird kein Avatar."
              className="min-h-[72px]"
            />
          </div>
          {avatarPlan?.hinweis ? (
            <p className="rounded-lg border border-amber-300/60 bg-amber-50/70 px-3 py-2 text-sm text-primary dark:border-amber-400/30 dark:bg-amber-400/10">
              <span className="font-medium">Hinweis: </span>
              {avatarPlan.hinweis}
            </p>
          ) : null}
          {avatarPlan?.status === "approved" && avatarPlan.avatars.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                className="bg-sbkm-navy text-white hover:bg-sbkm-ink-700"
                disabled={busy != null || pendingAvatars.length === 0 || missingSummaries.length > 0}
                onClick={() => void generateAll()}
              >
                {busy === "generate-all" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {busy === "generate-all" ? "Erstellt Avatare…" : "Alle Avatare erstellen"}
              </Button>
              <p className="text-xs text-secondary">
                Erstellt nacheinander jeden Avatar, der noch nicht in Agenten steht. Avatare mit
                offenen Rückfragen warten auf die Antworten.
              </p>
            </div>
          ) : null}
          {avatarPlan && avatarPlan.avatars.length > 0 ? (
            <ul className="grid gap-4">
              {avatarPlan.avatars.map((avatar, index) => {
                const generator = avatar.generator;
                const meta = avatar.agentId ? generator?.meta : null;
                return (
                  <li
                    key={avatar.key}
                    id={`avatar-${avatar.key}`}
                    className="grid gap-3 rounded-xl border border-sbkm-navy/10 px-3 py-3 dark:border-white/10"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-secondary">Avatar {index + 1}</span>
                      {avatar.agentId ? <Badge variant="secondary">In Agenten</Badge> : null}
                      {generator?.status === "rueckfragen" ? (
                        <Badge variant="outline">Rückfragen offen</Badge>
                      ) : null}
                      {generator?.status === "fehler" ? (
                        <Badge variant="destructive">Nicht gespeichert</Badge>
                      ) : null}
                    </div>
                    {planEditable ? (
                      <Input
                        value={titles[avatar.key] ?? avatar.title}
                        onChange={(event) =>
                          setTitles((prev) => ({ ...prev, [avatar.key]: event.target.value }))
                        }
                        aria-label={`Arbeitstitel Avatar ${index + 1}`}
                      />
                    ) : (
                      <p className="text-sm font-semibold text-primary">{avatar.title}</p>
                    )}
                    {avatar.whySeparate ? (
                      <p className="text-sm text-secondary">{avatar.whySeparate}</p>
                    ) : null}
                    {avatar.cases.length > 0 ? (
                      <ul className="grid gap-2">
                        {avatar.cases.map((item, caseIndex) => (
                          <li key={`${avatar.key}-${caseIndex}`} className="text-sm">
                            <p className="font-medium text-primary">
                              {item.service || "Fall"}: {item.summary}
                            </p>
                            {item.quotes.length > 0 ? (
                              <p className="text-xs text-secondary">„{item.quotes.join("“ · „")}“</p>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {avatarPlan.status === "approved" && generator?.status === "rueckfragen" ? (
                      <div className="grid gap-3 rounded-lg border border-amber-300/60 bg-amber-50/60 px-3 py-3 dark:border-amber-400/30 dark:bg-amber-400/5">
                        <p className="text-sm text-primary">
                          Der Generator hat Rückfragen. Solange sie offen sind, wird nichts in
                          Agenten geschrieben.
                        </p>
                        {generator.rueckfragen.map((question, questionIndex) => (
                          <label key={questionIndex} className="grid gap-1 text-sm">
                            <span className="text-xs font-semibold uppercase tracking-wide text-secondary">
                              {question.block || "Allgemein"}
                            </span>
                            <span className="text-primary">{question.frage}</span>
                            <Textarea
                              value={answers[avatar.key]?.[questionIndex] ?? question.vorschlag}
                              onChange={(event) =>
                                setAnswers((prev) => ({
                                  ...prev,
                                  [avatar.key]: { ...prev[avatar.key], [questionIndex]: event.target.value },
                                }))
                              }
                              className="min-h-[60px]"
                            />
                          </label>
                        ))}
                        <div>
                          <Button
                            type="button"
                            size="sm"
                            disabled={busy != null || missingSummaries.length > 0}
                            onClick={() => void generateOne(avatar, "answers")}
                          >
                            {running === avatar.key && runningMode !== "draft" ? (
                              <Loader2 className="size-3.5 animate-spin" aria-hidden />
                            ) : null}
                            {avatar.agentId
                              ? "Antworten übernehmen und Avatar aktualisieren"
                              : "Antworten übernehmen und Avatar erstellen"}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    {avatarPlan.status === "approved" && generator?.status === "fehler" && generator.errors.length > 0 ? (
                      <div className="grid gap-1 text-sm text-destructive">
                        <p className="font-medium">Nicht gespeichert. Diese Regeln waren verletzt:</p>
                        <ul className="list-disc space-y-0.5 pl-5">
                          {generator.errors.map((message, errorIndex) => (
                            <li key={errorIndex}>{message}</li>
                          ))}
                        </ul>
                        <p className="text-xs text-secondary">
                          {avatar.agentId
                            ? "Der Avatar in Agenten bleibt unverändert. "
                            : ""}
                          {generator.draft
                            ? "Den Entwurf unten an diesen Stellen korrigieren und prüfen lassen, oder neu erzeugen."
                            : "Neu erzeugen; die Fehler gehen dabei an die KI mit."}
                        </p>
                      </div>
                    ) : null}
                    {avatarPlan.status === "approved" && generator?.status === "fehler" && generator.draft ? (
                      <details className="rounded-lg border border-sbkm-navy/10 px-3 py-2 dark:border-white/10">
                        <summary className="cursor-pointer text-sm font-medium text-primary">
                          Entwurf ansehen und selbst korrigieren
                        </summary>
                        <div className="mt-3 grid gap-3">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <label className="grid gap-1 text-sm">
                              <span className="text-xs font-medium text-secondary">Name</span>
                              <Input
                                value={draftForm(avatar).name}
                                onChange={(event) => editDraft(avatar.key, { name: event.target.value })}
                              />
                            </label>
                            <label className="grid gap-1 text-sm">
                              <span className="text-xs font-medium text-secondary">Rolle</span>
                              <Input
                                value={draftForm(avatar).role}
                                onChange={(event) => editDraft(avatar.key, { role: event.target.value })}
                              />
                            </label>
                          </div>
                          <label className="grid gap-1 text-sm">
                            <span className="text-xs font-medium text-secondary">
                              Schnelltests (eine pro Zeile, 4 bis 6 — Fragen an den Avatar)
                            </span>
                            <Textarea
                              value={draftForm(avatar).quickActions}
                              onChange={(event) => editDraft(avatar.key, { quickActions: event.target.value })}
                              className="min-h-[110px]"
                            />
                          </label>
                          <label className="grid gap-1 text-sm">
                            <span className="text-xs font-medium text-secondary">Avatar-Text</span>
                            <Textarea
                              value={draftForm(avatar).promptTemplate}
                              onChange={(event) => editDraft(avatar.key, { promptTemplate: event.target.value })}
                              className="min-h-[420px] font-mono text-xs leading-relaxed"
                            />
                          </label>
                          <div>
                            <Button
                              type="button"
                              size="sm"
                              disabled={busy != null || !draftForm(avatar).promptTemplate.trim()}
                              onClick={() => void generateOne(avatar, "draft")}
                            >
                              {running === avatar.key && runningMode === "draft" ? (
                                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                              ) : (
                                <CheckCircle2 className="size-3.5" aria-hidden />
                              )}
                              {avatar.agentId ? "Prüfen und Avatar aktualisieren" : "Prüfen und speichern"}
                            </Button>
                          </div>
                        </div>
                      </details>
                    ) : null}
                    {avatarPlan.status === "approved" ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {generator?.status !== "rueckfragen" ? (
                          <Button
                            type="button"
                            size="sm"
                            disabled={busy != null || missingSummaries.length > 0}
                            onClick={() => void generateOne(avatar, "generate")}
                          >
                            {running === avatar.key && runningMode !== "draft" ? (
                              <Loader2 className="size-3.5 animate-spin" aria-hidden />
                            ) : null}
                            {generator?.status === "fehler"
                              ? "Erneut erzeugen"
                              : avatar.agentId
                                ? "Avatar aktualisieren"
                                : "Avatar erstellen"}
                          </Button>
                        ) : null}
                        {avatar.agentId ? (
                          <Button asChild size="sm" variant="outline">
                            <Link href={agentsHref}>
                              <ExternalLink className="size-3.5" aria-hidden />
                              In Agenten öffnen
                            </Link>
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                    {running === avatar.key ? (
                      <p className="flex items-center gap-2 text-sm text-primary">
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                        {runningMode === "draft"
                          ? "Der Entwurf wird geprüft und gespeichert."
                          : "Der Avatar wird erzeugt und geprüft. Das kann einige Minuten dauern."}
                      </p>
                    ) : null}
                    {meta ? (
                      <div className="grid gap-2 rounded-lg bg-muted/50 px-3 py-3 text-sm">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-secondary">
                            Zur Prüfung durch das Team
                          </p>
                          <p className="text-xs text-secondary">Steht nicht im Prompt des Avatars.</p>
                        </div>
                        <MetaList
                          title="Abgeleitet"
                          items={meta.abgeleitet.map(
                            (item) =>
                              `${item.block ? `${item.block}: ` : ""}${item.aussage}${item.grund ? ` (Grund: ${item.grund})` : ""}`,
                          )}
                        />
                        <MetaList title="Fehlende Daten" items={meta.fehlende_daten} />
                        <MetaList title="Zusatzblöcke" items={meta.zusatzbloecke} />
                        <MetaList title="Offene Fragen" items={meta.offene_fragen} />
                        {meta.abgeleitet.length +
                          meta.fehlende_daten.length +
                          meta.zusatzbloecke.length +
                          meta.offene_fragen.length ===
                        0 ? (
                          <p className="text-secondary">Nichts abgeleitet, nichts offen.</p>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-secondary">Noch kein Avatar-Plan.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
