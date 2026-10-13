"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, FileText, Loader2, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/components/dt/cn";
import { contentApi, contentQuery } from "@/components/dt/content/content-api";
import { downloadContentExport } from "@/components/dt/content/download";
import { DtContentTextFrame } from "@/components/dt/content/dt-content-text-frame";
import { DtField, DtInput, DtInputWrap, DtTextarea } from "@/components/dt/dt-field";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import type { ContentApiResponse } from "@/lib/dt/content/types";
import { formatEur } from "@/lib/dt/content/presentation";
import type { GeoToolJob, GeoToolResult, GeoToolStartResult } from "@/lib/dt/text-tools/geo";
import { TEXT_TOOL_ACCEPT, TEXT_TOOL_MAX_FILE_BYTES } from "@/lib/dt/text-tools/ingest";

const POLL_MS = 4_000;
/** After this long without a result the page says so instead of spinning forever. */
const SLOW_AFTER_MS = 6 * 60_000;

const cardClass =
  "relative overflow-hidden rounded-dt-lg border border-sbkm-navy/10 bg-white/55 shadow-dt backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.05]";

const FORMAT_LABELS: Record<string, string> = { txt: "Textdatei", html: "HTML", pdf: "PDF", docx: "Word" };

type Phase =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "running"; jobId: string; startedAt: number; input: GeoToolStartResult["input"] }
  | { kind: "done"; jobId: string; result: GeoToolResult; input: GeoToolStartResult["input"] }
  | { kind: "error"; message: string };

function Notice(props: { tone: "warn" | "error"; children: React.ReactNode }) {
  return (
    <div
      role={props.tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-[10px] border px-3 py-2.5 text-xs leading-relaxed",
        props.tone === "error"
          ? "border-red-300/70 bg-red-50 text-red-900 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-100"
          : "border-orange-300/70 bg-orange-50 text-orange-900 dark:border-orange-400/30 dark:bg-orange-500/10 dark:text-orange-100",
      )}
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <div>{props.children}</div>
    </div>
  );
}

/**
 * Verwaltung → GEO: one file in, step 4 of the Texte pipeline once, the result as HTML or
 * plain text out. The run is a background job; the card polls its status.
 */
export function DtGeoTool(props: {
  organisationId: string;
  organisationName: string;
  /** Confirmed Texte settings exist for the organisation; without them the run is refused. */
  settingsConfirmed: boolean;
  /** „11 von 13 Abschnitten aus den Gesprächen · …“ or null without any Anbieterfakten. */
  anbieterHint: string | null;
  avatarName: string | null;
}) {
  const { organisationId } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pageName, setPageName] = useState("");
  const [notes, setNotes] = useState("");
  const [questions, setQuestions] = useState("");
  const [faktencheck, setFaktencheck] = useState("");
  const [showOptional, setShowOptional] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [exporting, setExporting] = useState<"html" | "txt" | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Poll the job while it runs.
  useEffect(() => {
    if (phase.kind !== "running") return;
    const { jobId, input } = phase;
    let cancelled = false;
    const tick = async () => {
      const res = await contentApi<GeoToolJob>(
        `/api/dt/text-tools/geo/jobs/${encodeURIComponent(jobId)}?${contentQuery(organisationId)}`,
      );
      if (cancelled) return;
      setNow(Date.now());
      if (!res.ok) {
        setPhase({ kind: "error", message: res.message });
        return;
      }
      if (res.data.state === "done" && res.data.result) {
        setPhase({ kind: "done", jobId, result: res.data.result, input });
        toast.success("GEO-Text ist fertig.");
      } else if (res.data.state === "error") {
        setPhase({ kind: "error", message: res.data.error ?? "Die Verarbeitung ist fehlgeschlagen." });
      }
    };
    const timer = window.setInterval(() => void tick(), POLL_MS);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [phase, organisationId]);

  function pickFile(next: File | undefined) {
    if (!next) return;
    if (next.size > TEXT_TOOL_MAX_FILE_BYTES) {
      toast.error(`„${next.name}“ ist zu groß (max. ${Math.round(TEXT_TOOL_MAX_FILE_BYTES / (1024 * 1024))} MB).`);
      return;
    }
    setFile(next);
    if (phase.kind === "done" || phase.kind === "error") setPhase({ kind: "idle" });
  }

  async function run() {
    if (!file) {
      toast.error("Bitte zuerst eine Datei auswählen.");
      return;
    }
    setPhase({ kind: "uploading" });
    const form = new FormData();
    form.set("organisationId", organisationId);
    form.set("file", file);
    form.set("pageName", pageName);
    form.set("notes", notes);
    form.set("questions", questions);
    form.set("faktencheck", faktencheck);
    let json: ContentApiResponse<GeoToolStartResult> | null = null;
    try {
      const res = await fetch(`/api/dt/text-tools/geo/run?${contentQuery(organisationId)}`, { method: "POST", body: form });
      json = (await res.json().catch(() => null)) as ContentApiResponse<GeoToolStartResult> | null;
      if (!json) json = { ok: false, message: `Unerwartete Antwort (${res.status}).` };
    } catch {
      json = { ok: false, message: "Keine Verbindung. Bitte erneut versuchen." };
    }
    if (!json.ok) {
      setPhase({ kind: "error", message: json.message });
      return;
    }
    setPhase({ kind: "running", jobId: json.data.id, startedAt: Date.now(), input: json.data.input });
  }

  async function exportResult(format: "html" | "txt") {
    if (phase.kind !== "done") return;
    setExporting(format);
    const base = (phase.result.page_name || phase.result.file_name.replace(/\.[a-z0-9]+$/i, "") || "geo").trim();
    const res = await downloadContentExport(
      `/api/dt/text-tools/geo/jobs/${encodeURIComponent(phase.jobId)}/export?${contentQuery(organisationId)}&format=${format}`,
      `${base}-geo.${format}`,
    );
    if (!res.ok) toast.error(res.message);
    setExporting(null);
  }

  const busy = phase.kind === "uploading" || phase.kind === "running";
  const canRun = Boolean(file) && !busy && props.settingsConfirmed;
  const texteHref = `/dashboard/verwaltung/texte?${contentQuery(organisationId)}`;

  return (
    <div className="grid gap-5">
      <section aria-label="GEO-Werkzeug" className={cardClass}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent dark:via-white/10" />
        <header className="border-b border-sbkm-navy/8 px-4 py-3.5 dark:border-white/8 sm:px-5">
          <h2 className="text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">Text für KI-Zitate überarbeiten</h2>
          <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/60">
            Schritt 4 „GEO“ aus Texte, einmal auf eine hochgeladene Datei: Kernantwort nach vorn, jeder Abschnitt für sich
            verständlich, Entitäten ausgeschrieben, Unbelegtes markiert. Anbieterfakten, Einstellungen und Avatar kommen aus
            Texte für <span className="font-semibold">{props.organisationName}</span>.
          </p>
        </header>

        <div className="grid gap-4 px-4 py-4 sm:px-5">
          {!props.settingsConfirmed ? (
            <Notice tone="error">
              Die Einstellungen für Texte (Anrede, Branche, Tonalität, verbotene Wörter) sind für diese Organisation noch
              nicht bestätigt.{" "}
              <Link href={texteHref} className="font-semibold underline underline-offset-2">
                Zu Texte
              </Link>
            </Notice>
          ) : null}
          {props.settingsConfirmed && !props.anbieterHint ? (
            <Notice tone="warn">
              Keine Anbieterfakten vorhanden (weder Anbieter-Fragebogen noch ausgewertete Gespräche). Der Text wird nur
              umgebaut; Angaben ohne Beleg bekommen den Marker „[BITTE PRÜFEN: …]“.
            </Notice>
          ) : null}

          <DtField label="Datei">
            <input
              ref={fileRef}
              type="file"
              accept={TEXT_TOOL_ACCEPT}
              className="sr-only"
              aria-label="Textdatei wählen"
              onChange={(event) => {
                const next = event.target.files?.[0];
                event.target.value = "";
                pickFile(next);
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <DtPillButton type="button" size="sm" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
                <Upload className="size-3.5" aria-hidden />
                {file ? "Andere Datei" : "Datei hochladen"}
              </DtPillButton>
              {file ? (
                <span className="truncate text-xs text-sbkm-navy dark:text-white/85" title={file.name}>
                  {file.name} · {Math.max(1, Math.round(file.size / 1024))} KB
                </span>
              ) : null}
            </div>
            <p className="text-[11px] leading-relaxed text-sbkm-ink-500 dark:text-white/45">
              .txt, .html, .pdf oder .docx, höchstens {Math.round(TEXT_TOOL_MAX_FILE_BYTES / (1024 * 1024))} MB. Überschriften werden aus
              H1/H2/H3 übernommen, bei reinem Text aus kurzen Zeilen geraten. Ein HTML-Export aus Texte kommt mit seinen
              Abschnitten zurück.
            </p>
          </DtField>

          <div className="grid gap-4 sm:grid-cols-2">
            <DtField label="Seitenname" htmlFor="geo-page-name" optional>
              <DtInputWrap>
                <DtInput
                  id="geo-page-name"
                  value={pageName}
                  maxLength={200}
                  disabled={busy}
                  placeholder="z. B. Leistungen · Badsanierung"
                  onChange={(event) => setPageName(event.target.value)}
                />
              </DtInputWrap>
              <p className="text-[11px] leading-relaxed text-sbkm-ink-500 dark:text-white/45">
                Nur eine Beschriftung für das Modell und den Dateinamen des Exports.
              </p>
            </DtField>
            <DtField label="Redaktionelle Anmerkungen" htmlFor="geo-notes" optional>
              <DtTextarea
                id="geo-notes"
                value={notes}
                disabled={busy}
                className="min-h-[88px]"
                placeholder="Gelten vor allem anderen. Antworten darin zählen als bestätigte Fakten. Eine Leerzeile trennt Anmerkungen."
                onChange={(event) => setNotes(event.target.value)}
              />
            </DtField>
          </div>

          <div>
            <button
              type="button"
              className="text-xs font-semibold text-sbkm-navy underline-offset-2 hover:underline dark:text-white/85"
              onClick={() => setShowOptional((v) => !v)}
              aria-expanded={showOptional}
            >
              {showOptional ? "Weniger Felder" : "Fragen und Faktencheck (optional)"}
            </button>
          </div>
          {showOptional ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <DtField label="Hauptfrage und Fan-out-Fragen" htmlFor="geo-questions" optional>
                <DtTextarea
                  id="geo-questions"
                  value={questions}
                  disabled={busy}
                  className="min-h-[120px]"
                  placeholder={"Eine Frage je Zeile; die erste ist die Hauptfrage.\nLeer: GEO arbeitet nur mit dem Text."}
                  onChange={(event) => setQuestions(event.target.value)}
                />
                <p className="text-[11px] leading-relaxed text-sbkm-ink-500 dark:text-white/45">
                  Fragen, die der Text noch nicht beantwortet, werden als Frage-Überschrift mit Antwort ergänzt – nur aus
                  den Anbieterfakten.
                </p>
              </DtField>
              <DtField label="Faktencheck-JSON einfügen" htmlFor="geo-faktencheck" optional>
                <DtTextarea
                  id="geo-faktencheck"
                  value={faktencheck}
                  disabled={busy}
                  className="min-h-[120px] font-mono text-xs"
                  placeholder={'{"findings": [...], "questions": [...]}'}
                  spellCheck={false}
                  onChange={(event) => setFaktencheck(event.target.value)}
                />
                <p className="text-[11px] leading-relaxed text-sbkm-ink-500 dark:text-white/45">
                  Ergebnis eines Faktenchecks (Schritt 3) aus Texte. Ohne Faktencheck wird nichts gestrichen, Unbelegtes nur
                  markiert.
                </p>
              </DtField>
            </div>
          ) : null}

          {phase.kind === "error" ? <Notice tone="error">{phase.message}</Notice> : null}

          <div className="flex flex-wrap items-center gap-3">
            <DtPillButton type="button" size="sm" disabled={!canRun} onClick={() => void run()}>
              {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
              {phase.kind === "uploading" ? "Datei wird gelesen …" : phase.kind === "running" ? "GEO läuft …" : "Verarbeiten"}
            </DtPillButton>
            {phase.kind === "running" ? (
              <span className="text-xs text-sbkm-ink-600 dark:text-white/60" aria-live="polite">
                {FORMAT_LABELS[phase.input.format] ?? phase.input.format} gelesen: {phase.input.blocks}{" "}
                {phase.input.blocks === 1 ? "Abschnitt" : "Abschnitte"}, {phase.input.chars.toLocaleString("de-DE")} Zeichen.
                {now - phase.startedAt > SLOW_AFTER_MS
                  ? " Das dauert ungewöhnlich lange – läuft der Hintergrund-Worker? Die Seite kann offen bleiben."
                  : " Das Modell schreibt – meist zwei bis vier Minuten."}
              </span>
            ) : null}
            {props.avatarName ? (
              <span className="text-[11px] text-sbkm-ink-500 dark:text-white/45">Avatar: {props.avatarName}</span>
            ) : null}
          </div>
        </div>
      </section>

      {phase.kind === "done" ? (
        <section aria-label="Ergebnis" className={cardClass}>
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-sbkm-navy/8 px-4 py-3.5 dark:border-white/8 sm:px-5">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">Ergebnis</h2>
              <p className="mt-0.5 truncate text-xs text-sbkm-ink-600 dark:text-white/60">
                {phase.result.blocks.length} {phase.result.blocks.length === 1 ? "Abschnitt" : "Abschnitte"} · {phase.result.model} ·{" "}
                {formatEur(phase.result.cost_eur)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <DtPillButton type="button" size="sm" variant="outline" disabled={exporting !== null} onClick={() => void exportResult("html")}>
                {exporting === "html" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Download className="size-3.5" aria-hidden />}
                HTML herunterladen
              </DtPillButton>
              <DtPillButton type="button" size="sm" variant="outline" disabled={exporting !== null} onClick={() => void exportResult("txt")}>
                {exporting === "txt" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <FileText className="size-3.5" aria-hidden />}
                Text (.txt) herunterladen
              </DtPillButton>
            </div>
          </header>
          <div className="grid gap-3 px-4 py-4 sm:px-5">
            <dl className="grid gap-1 text-xs text-sbkm-ink-600 dark:text-white/60 sm:grid-cols-[auto_1fr] sm:gap-x-4">
              <dt className="font-semibold text-sbkm-navy dark:text-white">Title</dt>
              <dd>{phase.result.title || "—"}</dd>
              <dt className="font-semibold text-sbkm-navy dark:text-white">Meta-Description</dt>
              <dd>{phase.result.meta_description || "—"}</dd>
            </dl>
            <DtContentTextFrame html={phase.result.html} title="GEO-Text (Vorschau)" />
          </div>
        </section>
      ) : null}
    </div>
  );
}
