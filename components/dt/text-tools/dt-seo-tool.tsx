"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, FileText, Loader2, Sparkles, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/components/dt/cn";
import { contentApi, contentQuery } from "@/components/dt/content/content-api";
import { downloadContentExport } from "@/components/dt/content/download";
import { DtContentTextFrame } from "@/components/dt/content/dt-content-text-frame";
import { DtField, DtInput, DtInputWrap, DtTextarea } from "@/components/dt/dt-field";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { DtSelect } from "@/components/dt/dt-select";
import { CONTENT_PAGE_TYPE_LABELS } from "@/lib/dt/content/page-types";
import type { ContentApiResponse } from "@/lib/dt/content/types";
import { formatEur } from "@/lib/dt/content/presentation";
import { TEXT_TOOL_ACCEPT, TEXT_TOOL_MAX_FILE_BYTES } from "@/lib/dt/text-tools/ingest";
import {
  SEO_TOOL_PAGE_TYPE_OPTIONS,
  type SeoToolJob,
  type SeoToolPageType,
  type SeoToolResult,
  type SeoToolStartResult,
} from "@/lib/dt/text-tools/seo";

const POLL_MS = 4_000;
/** After this long without a result the page says so instead of spinning forever. */
const SLOW_AFTER_MS = 8 * 60_000;

const cardClass =
  "relative overflow-hidden rounded-dt-lg border border-sbkm-navy/10 bg-white/55 shadow-dt backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.05]";
const hintClass = "text-[11px] leading-relaxed text-sbkm-ink-500 dark:text-white/45";

const FORMAT_LABELS: Record<string, string> = { txt: "Textdatei", html: "HTML", pdf: "PDF", docx: "Word" };

type Phase =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "running"; jobId: string; startedAt: number; start: SeoToolStartResult; progress: string | null }
  | { kind: "done"; jobId: string; result: SeoToolResult }
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
 * Verwaltung → SEO: a briefing form and an optional file in, step 2 „SEO“ of the Texte
 * pipeline once (with its own Analyse first, unless one is pasted), the page text as HTML
 * or plain text out. The run is a background job; the card polls its status.
 */
export function DtSeoTool(props: {
  organisationId: string;
  organisationName: string;
  /** Confirmed Texte settings exist for the organisation; without them the run is refused. */
  settingsConfirmed: boolean;
  /** „11 von 13 Abschnitten aus den Gesprächen · …“ or null without any Anbieterfakten (then the run is refused). */
  anbieterHint: string | null;
  avatarName: string | null;
}) {
  const { organisationId } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pageName, setPageName] = useState("");
  const [pageType, setPageType] = useState<SeoToolPageType>("unterseite");
  const [pillarName, setPillarName] = useState("");
  const [mainKeyword, setMainKeyword] = useState("");
  const [secondaryKeywords, setSecondaryKeywords] = useState("");
  const [h1Options, setH1Options] = useState("");
  const [userQuestions, setUserQuestions] = useState("");
  const [linkTargets, setLinkTargets] = useState("");
  const [kiPrompt, setKiPrompt] = useState("");
  const [notes, setNotes] = useState("");
  const [analyse, setAnalyse] = useState("");
  const [showBriefing, setShowBriefing] = useState(false);
  const [showAnalyse, setShowAnalyse] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [exporting, setExporting] = useState<"html" | "txt" | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Poll the job while it runs.
  useEffect(() => {
    if (phase.kind !== "running") return;
    const { jobId } = phase;
    let cancelled = false;
    const tick = async () => {
      const res = await contentApi<SeoToolJob>(
        `/api/dt/text-tools/seo/jobs/${encodeURIComponent(jobId)}?${contentQuery(organisationId)}`,
      );
      if (cancelled) return;
      setNow(Date.now());
      if (!res.ok) {
        setPhase({ kind: "error", message: res.message });
        return;
      }
      if (res.data.state === "done" && res.data.result) {
        setPhase({ kind: "done", jobId, result: res.data.result });
        toast.success("SEO-Text ist fertig.");
      } else if (res.data.state === "error") {
        setPhase({ kind: "error", message: res.data.error ?? "Die Verarbeitung ist fehlgeschlagen." });
      } else if (res.data.progress !== phase.progress) {
        setPhase({ ...phase, progress: res.data.progress });
      }
    };
    const timer = window.setInterval(() => void tick(), POLL_MS);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [phase, organisationId]);

  function resetResult() {
    if (phase.kind === "done" || phase.kind === "error") setPhase({ kind: "idle" });
  }

  function pickFile(next: File | undefined) {
    if (!next) return;
    if (next.size > TEXT_TOOL_MAX_FILE_BYTES) {
      toast.error(`„${next.name}“ ist zu groß (max. ${Math.round(TEXT_TOOL_MAX_FILE_BYTES / (1024 * 1024))} MB).`);
      return;
    }
    setFile(next);
    resetResult();
  }

  async function run() {
    if (!pageName.trim()) {
      toast.error("Bitte einen Seitennamen eingeben.");
      return;
    }
    setPhase({ kind: "uploading" });
    const form = new FormData();
    form.set("organisationId", organisationId);
    if (file) form.set("file", file);
    form.set("pageName", pageName);
    form.set("pageType", pageType);
    form.set("pillarName", pillarName);
    form.set("mainKeyword", mainKeyword);
    form.set("secondaryKeywords", secondaryKeywords);
    form.set("h1Options", h1Options);
    form.set("userQuestions", userQuestions);
    form.set("linkTargets", linkTargets);
    form.set("kiPrompt", kiPrompt);
    form.set("notes", notes);
    form.set("analyse", analyse);
    let json: ContentApiResponse<SeoToolStartResult> | null = null;
    try {
      const res = await fetch(`/api/dt/text-tools/seo/run?${contentQuery(organisationId)}`, { method: "POST", body: form });
      json = (await res.json().catch(() => null)) as ContentApiResponse<SeoToolStartResult> | null;
      if (!json) json = { ok: false, message: `Unerwartete Antwort (${res.status}).` };
    } catch {
      json = { ok: false, message: "Keine Verbindung. Bitte erneut versuchen." };
    }
    if (!json.ok) {
      setPhase({ kind: "error", message: json.message });
      return;
    }
    setPhase({ kind: "running", jobId: json.data.id, startedAt: Date.now(), start: json.data, progress: null });
  }

  async function exportResult(format: "html" | "txt") {
    if (phase.kind !== "done") return;
    setExporting(format);
    const base = (phase.result.page_name || "seo").trim();
    const res = await downloadContentExport(
      `/api/dt/text-tools/seo/jobs/${encodeURIComponent(phase.jobId)}/export?${contentQuery(organisationId)}&format=${format}`,
      `${base}-seo.${format}`,
    );
    if (!res.ok) toast.error(res.message);
    setExporting(null);
  }

  const busy = phase.kind === "uploading" || phase.kind === "running";
  const canRun = Boolean(pageName.trim()) && !busy && props.settingsConfirmed && Boolean(props.anbieterHint);
  const texteHref = `/dashboard/verwaltung/texte?${contentQuery(organisationId)}`;
  const runningLabel = phase.kind === "running" ? (phase.progress ? "Seitentext wird geschrieben …" : phase.start.analyse_source === "pasted" ? "Seitentext wird geschrieben …" : "Analyse läuft …") : "";

  return (
    <div className="grid gap-5">
      <section aria-label="SEO-Werkzeug" className={cardClass}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent dark:via-white/10" />
        <header className="border-b border-sbkm-navy/8 px-4 py-3.5 dark:border-white/8 sm:px-5">
          <h2 className="text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">Seitentext aus Briefing schreiben</h2>
          <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/60">
            Schritt 2 „SEO“ aus Texte, einmal für eine Seite ohne Seitenstruktur: Briefing eingeben, optional Material
            hochladen, fertig ist der vollständige Seitentext mit H1, Zusammenfassung, Frage-Überschriften und
            Hero-Platzhalter. Ohne eingefügte Analyse läuft vorher die Analyse (Schritt 1) im selben Durchlauf.
            Anbieterfakten, Einstellungen, Textvorlagen und Avatar kommen aus Texte für{" "}
            <span className="font-semibold">{props.organisationName}</span>.
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
            <Notice tone="error">
              Keine Anbieterfakten vorhanden (weder Anbieter-Fragebogen noch ausgewertete Gespräche). Der SEO-Schritt
              schreibt nur aus belegten Fakten; ohne Fakten entstünden nur Platzhalter.{" "}
              <Link href={texteHref} className="font-semibold underline underline-offset-2">
                Zu Texte
              </Link>
            </Notice>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <DtField label="Seitenname" htmlFor="seo-page-name">
              <DtInputWrap>
                <DtInput
                  id="seo-page-name"
                  value={pageName}
                  maxLength={200}
                  disabled={busy}
                  placeholder="z. B. Badsanierung"
                  onChange={(event) => {
                    setPageName(event.target.value);
                    resetResult();
                  }}
                />
              </DtInputWrap>
              <p className={hintClass}>Name der Seite wie in der Seitenstruktur; auch der Dateiname des Exports.</p>
            </DtField>
            <DtField label="Seitentyp">
              <DtSelect
                value={pageType}
                onValueChange={(value) => setPageType(value as SeoToolPageType)}
                options={SEO_TOOL_PAGE_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                srLabel="Seitentyp"
                disabled={busy}
                fullWidth
                searchable={false}
              />
              <p className={hintClass}>Bestimmt die Textvorlage, mit der der SEO-Schritt schreibt (Karte „Textvorlagen“ unter Texte).</p>
            </DtField>
          </div>

          <DtField label="Material" optional>
            <input
              ref={fileRef}
              type="file"
              accept={TEXT_TOOL_ACCEPT}
              className="sr-only"
              aria-label="Datei mit Material wählen"
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
                <>
                  <span className="truncate text-xs text-sbkm-navy dark:text-white/85" title={file.name}>
                    {file.name} · {Math.max(1, Math.round(file.size / 1024))} KB
                  </span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-[11px] text-sbkm-ink-500 hover:text-sbkm-navy dark:text-white/45 dark:hover:text-white"
                    disabled={busy}
                    onClick={() => {
                      setFile(null);
                      resetResult();
                    }}
                  >
                    <X className="size-3" aria-hidden />
                    Entfernen
                  </button>
                </>
              ) : null}
            </div>
            <p className={hintClass}>
              Bisheriger Seitentext oder ein Briefing-Dokument: .txt, .html, .pdf oder .docx, höchstens{" "}
              {Math.round(TEXT_TOOL_MAX_FILE_BYTES / (1024 * 1024))} MB. Dient nur zur Orientierung für Thema, Umfang und Begriffe;
              Fakten zählen nur, wenn sie in den Anbieterfakten oder den Anmerkungen stehen. Ohne Datei reicht das Briefing.
            </p>
          </DtField>

          <div className="grid gap-4 sm:grid-cols-2">
            <DtField label="Hauptkeyword" htmlFor="seo-main-keyword" optional>
              <DtInputWrap>
                <DtInput
                  id="seo-main-keyword"
                  value={mainKeyword}
                  maxLength={120}
                  disabled={busy}
                  placeholder="z. B. Badsanierung Münster"
                  onChange={(event) => setMainKeyword(event.target.value)}
                />
              </DtInputWrap>
              <p className={hintClass}>Wird wörtlich übernommen. Leer: die Analyse leitet es aus Seite, Leistung und Ort ab.</p>
            </DtField>
            <DtField label="Nebenkeywords" htmlFor="seo-secondary-keywords" optional>
              <DtInputWrap>
                <DtInput
                  id="seo-secondary-keywords"
                  value={secondaryKeywords}
                  maxLength={1_000}
                  disabled={busy}
                  placeholder="Mit Komma trennen: Bad renovieren, Badumbau Kosten"
                  onChange={(event) => setSecondaryKeywords(event.target.value)}
                />
              </DtInputWrap>
            </DtField>
          </div>

          <div>
            <button
              type="button"
              className="text-xs font-semibold text-sbkm-navy underline-offset-2 hover:underline dark:text-white/85"
              onClick={() => setShowBriefing((v) => !v)}
              aria-expanded={showBriefing}
            >
              {showBriefing ? "Weniger Briefing-Felder" : "Weitere Briefing-Felder (Hauptsilo, H1, Nutzerfragen, Linkziele, KI-Prompt)"}
            </button>
          </div>
          {showBriefing ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <DtField label="Hauptsilo (übergeordnete Seite)" htmlFor="seo-pillar" optional>
                <DtInputWrap>
                  <DtInput
                    id="seo-pillar"
                    value={pillarName}
                    maxLength={200}
                    disabled={busy}
                    placeholder="z. B. Sanitär"
                    onChange={(event) => setPillarName(event.target.value)}
                  />
                </DtInputWrap>
                <p className={hintClass}>Ersetzt „[Hauptsilo]“ in der Textvorlage; bei Unterseiten und Ratgebern sinnvoll.</p>
              </DtField>
              <DtField label="H1-Optionen" htmlFor="seo-h1" optional>
                <DtTextarea
                  id="seo-h1"
                  value={h1Options}
                  disabled={busy}
                  className="min-h-[88px]"
                  placeholder={"Eine Option je Zeile. Enthält eine das Hauptkeyword, wird sie wörtlich genommen."}
                  onChange={(event) => setH1Options(event.target.value)}
                />
              </DtField>
              <DtField label="Nutzerfragen" htmlFor="seo-questions" optional>
                <DtTextarea
                  id="seo-questions"
                  value={userQuestions}
                  disabled={busy}
                  className="min-h-[120px]"
                  placeholder={"Eine Frage je Zeile (echte Google-Fragen, wie Spalte H der Excel)."}
                  onChange={(event) => setUserQuestions(event.target.value)}
                />
                <p className={hintClass}>Haben Vorrang vor erfundenen Fragen und werden Frage-Überschriften im Text.</p>
              </DtField>
              <DtField label="Erlaubte interne Linkziele" htmlFor="seo-links" optional>
                <DtTextarea
                  id="seo-links"
                  value={linkTargets}
                  disabled={busy}
                  className="min-h-[120px]"
                  placeholder={"Ein Seitenname je Zeile. Leer: keine internen Links."}
                  onChange={(event) => setLinkTargets(event.target.value)}
                />
                <p className={hintClass}>Nur diese Seiten werden als Marker „[LINK: Seitenname]“ verlinkt.</p>
              </DtField>
              <DtField label="KI-Prompt für diese Seite" htmlFor="seo-ki-prompt" optional className="sm:col-span-2">
                <DtTextarea
                  id="seo-ki-prompt"
                  value={kiPrompt}
                  disabled={busy}
                  className="min-h-[88px]"
                  placeholder="Stehende Anweisung der Redaktion, wie in der Spalte KI-Prompt der Seitenstruktur."
                  onChange={(event) => setKiPrompt(event.target.value)}
                />
              </DtField>
            </div>
          ) : null}

          <DtField label="Redaktionelle Anmerkungen" htmlFor="seo-notes" optional>
            <DtTextarea
              id="seo-notes"
              value={notes}
              disabled={busy}
              className="min-h-[88px]"
              placeholder="Gelten vor allem anderen. Antworten darin zählen als bestätigte Fakten. Eine Leerzeile trennt Anmerkungen."
              onChange={(event) => setNotes(event.target.value)}
            />
          </DtField>

          <div>
            <button
              type="button"
              className="text-xs font-semibold text-sbkm-navy underline-offset-2 hover:underline dark:text-white/85"
              onClick={() => setShowAnalyse((v) => !v)}
              aria-expanded={showAnalyse}
            >
              {showAnalyse ? "Analyse ausblenden" : "Analyse-JSON einfügen (optional, spart die Analyse)"}
            </button>
          </div>
          {showAnalyse ? (
            <DtField label="Analyse-JSON" htmlFor="seo-analyse" optional>
              <DtTextarea
                id="seo-analyse"
                value={analyse}
                disabled={busy}
                className="min-h-[120px] font-mono text-xs"
                placeholder={'{"main_keyword": "…", "main_question": "…", "fanout_questions": [...], ...}'}
                spellCheck={false}
                onChange={(event) => setAnalyse(event.target.value)}
              />
              <p className={hintClass}>
                Ergebnis einer Analyse (Schritt 1) aus Texte. Dann läuft nur der SEO-Schritt; sonst erarbeitet der Durchlauf die
                Analyse selbst (zwei KI-Aufrufe, beide abgerechnet).
              </p>
            </DtField>
          ) : null}

          {phase.kind === "error" ? <Notice tone="error">{phase.message}</Notice> : null}

          <div className="flex flex-wrap items-center gap-3">
            <DtPillButton type="button" size="sm" disabled={!canRun} onClick={() => void run()}>
              {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
              {phase.kind === "uploading" ? "Briefing wird gelesen …" : phase.kind === "running" ? runningLabel : "Text schreiben"}
            </DtPillButton>
            {phase.kind === "running" ? (
              <span className="text-xs text-sbkm-ink-600 dark:text-white/60" aria-live="polite">
                {phase.start.input
                  ? `${FORMAT_LABELS[phase.start.input.format] ?? phase.start.input.format} gelesen: ${phase.start.input.blocks} ${
                      phase.start.input.blocks === 1 ? "Abschnitt" : "Abschnitte"
                    }, ${phase.start.input.chars.toLocaleString("de-DE")} Zeichen. `
                  : "Nur Briefing, keine Datei. "}
                {phase.progress ?? (phase.start.analyse_source === "pasted" ? "Analyse übernommen." : "Analyse läuft zuerst.")}
                {now - phase.startedAt > SLOW_AFTER_MS
                  ? " Das dauert ungewöhnlich lange – läuft der Hintergrund-Worker? Die Seite kann offen bleiben."
                  : " Meist drei bis sechs Minuten für beide Schritte."}
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
                {CONTENT_PAGE_TYPE_LABELS[phase.result.page_type]} · {phase.result.blocks.length}{" "}
                {phase.result.blocks.length === 1 ? "Abschnitt" : "Abschnitte"} · {phase.result.calls}{" "}
                {phase.result.calls === 1 ? "KI-Aufruf" : "KI-Aufrufe"} · {phase.result.models.join(", ") || phase.result.model} ·{" "}
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
              <dt className="font-semibold text-sbkm-navy dark:text-white">Hauptkeyword</dt>
              <dd>{phase.result.analyse.main_keyword || "—"}</dd>
              <dt className="font-semibold text-sbkm-navy dark:text-white">Hauptfrage</dt>
              <dd>
                {phase.result.analyse.main_question || "—"}
                <span className="text-sbkm-ink-500 dark:text-white/45">
                  {" "}
                  ({phase.result.analyse_source === "pasted" ? "Analyse eingefügt" : "Analyse im Durchlauf erarbeitet"}
                  {phase.result.analyse.fanout_questions.length > 0 ? `, ${phase.result.analyse.fanout_questions.length} Fan-out-Fragen` : ""})
                </span>
              </dd>
            </dl>
            <p className={hintClass}>
              Der Platzhalter „[HERO – wird in Schritt 5 gefuellt]“ bleibt wie in Texte unter der H1 stehen; Faktencheck, GEO, Hormozi und
              die weiteren Schritte laufen hier nicht.
            </p>
            <DtContentTextFrame html={phase.result.html} title="SEO-Text (Vorschau)" />
          </div>
        </section>
      ) : null}
    </div>
  );
}
