"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, FileText, Loader2, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/components/dt/cn";
import { contentQuery } from "@/components/dt/content/content-api";
import { DtContentTextFrame } from "@/components/dt/content/dt-content-text-frame";
import { DtField, DtInput, DtInputWrap } from "@/components/dt/dt-field";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { DtSelect } from "@/components/dt/dt-select";
import { contentExportFile } from "@/lib/dt/content/export";
import { CONTENT_PAGE_TYPE_LABELS } from "@/lib/dt/content/page-types";
import { formatEur } from "@/lib/dt/content/presentation";
import { slugify } from "@/lib/dt/content/render";
import type { ContentApiResponse } from "@/lib/dt/content/types";
import type { HormoziToolBausteine, HormoziToolResult } from "@/lib/dt/text-tools/hormozi";
import { TEXT_TOOL_ACCEPT, TEXT_TOOL_MAX_FILE_BYTES } from "@/lib/dt/text-tools/ingest";
import { SEO_TOOL_PAGE_TYPE_OPTIONS, type SeoToolPageType } from "@/lib/dt/text-tools/seo";

const cardClass =
  "relative overflow-hidden rounded-dt-lg border border-sbkm-navy/10 bg-white/55 shadow-dt backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.05]";
const hintClass = "text-[11px] leading-relaxed text-sbkm-ink-500 dark:text-white/45";
const linkClass = "font-semibold text-sbkm-navy underline-offset-2 hover:underline dark:text-sbkm-mint";

/** The building blocks in the order and with the labels of the result card. */
const BAUSTEINE_LABELS: ReadonlyArray<{ key: keyof HormoziToolBausteine; label: string }> = [
  { key: "traumziel", label: "Traumziel" },
  { key: "hauptschmerz", label: "Hauptschmerz" },
  { key: "groesste_huerde", label: "Größte Hürde" },
  { key: "moeglicher_beweis", label: "Beweis" },
  { key: "gewuenschter_cta", label: "Handlungsaufforderung" },
];

type Phase =
  | { kind: "idle" }
  | { kind: "running"; startedAt: number }
  | { kind: "done"; result: HormoziToolResult }
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

/** The result as a file, built in the browser with the same rendering as the Texte export. */
function saveFile(format: "html" | "txt", result: HormoziToolResult) {
  const name = (result.page_name || result.file_name.replace(/\.[a-z0-9]+$/i, "")).trim();
  const base = slugify(name) || "text";
  const file = contentExportFile(format, { slug: `${base}-hormozi`, title: result.title || name || "Hormozi-Text", html: result.html });
  const url = URL.createObjectURL(new Blob([file.body], { type: file.contentType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Verwaltung → Hormozi: a file, an optional page name, a page type and an avatar in, one
 * Claude call with the Hormozi prompt from Globale Prompts, the text with hero sentence,
 * Value Equation and calls to action as HTML or .txt out, plus the building blocks the model
 * derived. Nothing is stored; the request waits for the text (one to three minutes).
 */
export function DtHormoziTool(props: {
  organisationId: string;
  organisationName: string;
  /** „11 von 13 Abschnitten aus den Gesprächen · …“ or null without any Anbieterfakten. */
  anbieterHint: string | null;
  /** The organisation's avatars, newest first. */
  avatars: Array<{ id: string; name: string; role: string | null }>;
}) {
  const { organisationId } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pageName, setPageName] = useState("");
  const [pageType, setPageType] = useState<SeoToolPageType>("unterseite");
  const [avatarId, setAvatarId] = useState<string>(props.avatars[0]?.id ?? "");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [now, setNow] = useState(() => Date.now());

  // A second counter while the model works, so a long wait does not look like a hang.
  useEffect(() => {
    if (phase.kind !== "running") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [phase.kind]);

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
    if (!file) {
      toast.error("Bitte zuerst eine Datei auswählen.");
      return;
    }
    if (!avatarId) {
      toast.error("Bitte einen Avatar wählen.");
      return;
    }
    setNow(Date.now());
    setPhase({ kind: "running", startedAt: Date.now() });
    const form = new FormData();
    form.set("organisationId", organisationId);
    form.set("file", file);
    form.set("pageName", pageName);
    form.set("pageType", pageType);
    form.set("avatarId", avatarId);
    let json: ContentApiResponse<HormoziToolResult> | null = null;
    try {
      const res = await fetch(`/api/dt/text-tools/hormozi/run?${contentQuery(organisationId)}`, { method: "POST", body: form });
      json = (await res.json().catch(() => null)) as ContentApiResponse<HormoziToolResult> | null;
      if (!json) {
        json = {
          ok: false,
          message:
            res.status === 504
              ? "Das Modell hat nicht rechtzeitig geantwortet (Zeitlimit). Bitte erneut versuchen."
              : `Unerwartete Antwort vom Server (${res.status}).`,
        };
      }
    } catch {
      json = { ok: false, message: "Keine Verbindung zum Server. Bitte erneut versuchen." };
    }
    if (!json.ok) {
      setPhase({ kind: "error", message: json.message });
      return;
    }
    setPhase({ kind: "done", result: json.data });
    toast.success("Hormozi-Text ist fertig.");
  }

  const hasAvatars = props.avatars.length > 0;
  const running = phase.kind === "running";
  const canRun = Boolean(file) && Boolean(avatarId) && !running;
  const seconds = running ? Math.max(0, Math.round((now - phase.startedAt) / 1000)) : 0;
  const orgQuery = `org=${encodeURIComponent(organisationId)}`;

  return (
    <div className="grid gap-5">
      <section aria-label="Hormozi-Werkzeug" className={cardClass}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent dark:via-white/10" />
        <header className="border-b border-sbkm-navy/8 px-4 py-3.5 dark:border-white/8 sm:px-5">
          <h2 className="text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">Conversion-Schicht ergänzen</h2>
          <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/60">
            Eigenständiges Werkzeug: die Anweisung kommt aus Globale Prompts → Hormozi, Fakten aus den Anbieterfakten und der
            Leser aus dem gewählten Avatar von <span className="font-semibold">{props.organisationName}</span>. Keine Analyse,
            keine Seitenstruktur, keine Einstellungen aus Texte.
          </p>
        </header>

        <div className="grid gap-4 px-4 py-4 sm:px-5">
          {!props.anbieterHint ? (
            <Notice tone="warn">
              Keine Anbieterfakten vorhanden (weder Anbieter-Fragebogen noch ausgewertete Gespräche). Der Text wird
              trotzdem überarbeitet; fehlende Kontaktwege, Preise, Garantien und Beweise bekommen den Platzhalter „[BITTE
              PRÜFEN: …]“.
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
              <DtPillButton type="button" size="sm" variant="outline" disabled={running} onClick={() => fileRef.current?.click()}>
                <Upload className="size-3.5" aria-hidden />
                {file ? "Andere Datei" : "Datei hochladen"}
              </DtPillButton>
              {file ? (
                <span className="truncate text-xs text-sbkm-navy dark:text-white/85" title={file.name}>
                  {file.name} · {Math.max(1, Math.round(file.size / 1024))} KB
                </span>
              ) : null}
            </div>
            <p className={hintClass}>
              .txt, .html, .pdf oder .docx, höchstens {Math.round(TEXT_TOOL_MAX_FILE_BYTES / (1024 * 1024))} MB. Überschriften werden aus
              H1/H2/H3 übernommen, bei reinem Text aus kurzen Zeilen geraten. Unter den ersten Abschnitt setzt das Werkzeug den
              Hero-Satz.
            </p>
          </DtField>

          <div className="grid gap-4 sm:grid-cols-2">
            <DtField label="Seitenname" htmlFor="hormozi-page-name" optional>
              <DtInputWrap>
                <DtInput
                  id="hormozi-page-name"
                  value={pageName}
                  maxLength={200}
                  disabled={running}
                  placeholder="z. B. Leistungen · Badsanierung"
                  onChange={(event) => setPageName(event.target.value)}
                />
              </DtInputWrap>
              <p className={hintClass}>Nur eine Beschriftung für das Modell und den Dateinamen des Exports.</p>
            </DtField>
            <DtField label="Seitentyp">
              <DtSelect
                value={pageType}
                onValueChange={(value) => {
                  setPageType(value as SeoToolPageType);
                  resetResult();
                }}
                options={SEO_TOOL_PAGE_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                srLabel="Seitentyp"
                disabled={running}
                fullWidth
                searchable={false}
              />
              <p className={hintClass}>Bestimmt die Regel für Handlungsaufforderungen: weicher nächster Schritt bei Ratgeberartikeln.</p>
            </DtField>
          </div>

          <DtField label="Avatar">
            {hasAvatars ? (
              <>
                <DtSelect
                  value={avatarId}
                  onValueChange={(value) => {
                    setAvatarId(value);
                    resetResult();
                  }}
                  options={props.avatars.map((a) => ({ value: a.id, label: a.name, description: a.role ?? undefined }))}
                  srLabel="Avatar"
                  disabled={running}
                  fullWidth
                />
                <p className={hintClass}>Der Wunschkunde, für den Hero-Satz und Handlungsaufforderungen geschrieben werden.</p>
              </>
            ) : (
              <Notice tone="warn">
                Diese Organisation hat noch keinen Avatar. Bitte zuerst unter{" "}
                <Link href={`/dashboard/verwaltung/agents?${orgQuery}`} className={linkClass}>
                  Agenten
                </Link>{" "}
                oder im{" "}
                <Link href={`/dashboard/transkripte?${orgQuery}`} className={linkClass}>
                  Transkripte
                </Link>
                -Schritt Avatar-Plan anlegen.
              </Notice>
            )}
          </DtField>

          {phase.kind === "error" ? <Notice tone="error">{phase.message}</Notice> : null}

          <div className="flex flex-wrap items-center gap-3">
            <DtPillButton type="button" size="sm" disabled={!canRun} onClick={() => void run()}>
              {running ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
              {running ? "Hormozi läuft …" : "Verarbeiten"}
            </DtPillButton>
            {running ? (
              <span className="text-xs tabular-nums text-sbkm-ink-600 dark:text-white/60" aria-live="polite">
                {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} · Das Modell überarbeitet den ganzen Text, meist ein
                bis drei Minuten. Die Seite bitte offen lassen.
              </span>
            ) : null}
          </div>
        </div>
      </section>

      {phase.kind === "done" ? (
        <>
          <section aria-label="Hormozi-Bausteine" className={cardClass}>
            <header className="border-b border-sbkm-navy/8 px-4 py-3.5 dark:border-white/8 sm:px-5">
              <h2 className="text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">Hormozi-Bausteine</h2>
              <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/60">
                Vom Modell aus Avatar, Anbieterfakten und Text abgeleitet; damit ist der Text geschrieben.
              </p>
            </header>
            <dl className="grid gap-1.5 px-4 py-4 text-xs text-sbkm-ink-600 dark:text-white/60 sm:grid-cols-[auto_1fr] sm:gap-x-4 sm:px-5">
              {BAUSTEINE_LABELS.map(({ key, label }) => (
                <div key={key} className="contents">
                  <dt className="font-semibold text-sbkm-navy dark:text-white">{label}</dt>
                  <dd>{phase.result.hormozi[key] || "—"}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-label="Ergebnis" className={cardClass}>
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-sbkm-navy/8 px-4 py-3.5 dark:border-white/8 sm:px-5">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">Ergebnis</h2>
                <p className="mt-0.5 truncate text-xs text-sbkm-ink-600 dark:text-white/60">
                  {phase.result.file_name} · {CONTENT_PAGE_TYPE_LABELS[phase.result.page_type]} · Avatar: {phase.result.avatar_name} ·{" "}
                  {phase.result.blocks.length} {phase.result.blocks.length === 1 ? "Abschnitt" : "Abschnitte"} ·{" "}
                  {formatEur(phase.result.cost_eur)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <DtPillButton type="button" size="sm" variant="outline" onClick={() => saveFile("html", phase.result)}>
                  <Download className="size-3.5" aria-hidden />
                  HTML herunterladen
                </DtPillButton>
                <DtPillButton type="button" size="sm" variant="outline" onClick={() => saveFile("txt", phase.result)}>
                  <FileText className="size-3.5" aria-hidden />
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
              <DtContentTextFrame html={phase.result.html} title="Hormozi-Text (Vorschau)" />
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
