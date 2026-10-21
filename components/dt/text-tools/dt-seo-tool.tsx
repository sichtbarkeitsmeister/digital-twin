"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Download, FileText, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/components/dt/cn";
import { contentQuery } from "@/components/dt/content/content-api";
import { DtContentTextFrame } from "@/components/dt/content/dt-content-text-frame";
import { DtContentTypePromptsCard } from "@/components/dt/content/dt-content-type-prompts-card";
import { DtField, DtInput, DtInputWrap } from "@/components/dt/dt-field";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { DtSelect } from "@/components/dt/dt-select";
import { DtTextToolSource, appendTextToolSource, type TextToolSourceValue } from "@/components/dt/text-tools/dt-text-tool-source";
import { TEXT_TOOL_MAX_FILE_BYTES } from "@/lib/dt/text-tools/ingest";
import { contentExportFile } from "@/lib/dt/content/export";
import { CONTENT_PAGE_TYPE_LABELS } from "@/lib/dt/content/page-types";
import { formatEur } from "@/lib/dt/content/presentation";
import { slugify } from "@/lib/dt/content/render";
import type { ContentApiResponse } from "@/lib/dt/content/types";
import { SEO_TOOL_PAGE_TYPE_OPTIONS, type SeoToolPageType, type SeoToolResult, isSeoToolPageType } from "@/lib/dt/text-tools/seo";

const cardClass =
  "relative overflow-hidden rounded-dt-lg border border-sbkm-navy/10 bg-white/55 shadow-dt backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.05]";
const hintClass = "text-[11px] leading-relaxed text-sbkm-ink-500 dark:text-white/45";

/** Value of the „Ohne Avatar“ entry (the select needs a non-empty value). */
const NO_AVATAR = "none";

type Phase =
  | { kind: "idle" }
  | { kind: "running"; startedAt: number }
  | { kind: "done"; result: SeoToolResult }
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

function saveFile(format: "html" | "txt", result: SeoToolResult) {
  const base = slugify(result.page_name).replace(/-+$/, "") || "seo";
  const file = contentExportFile(format, { slug: `${base}-seo`, title: result.title || result.page_name, html: result.html });
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
 * Verwaltung → SEO: page name, page type, avatar and an optional file in, one Claude call
 * with the SEO prompt from Globale Prompts and this tool's own Textvorlage, the page text as
 * HTML or .txt out. Nothing is stored; the request waits for the text (two to four minutes).
 */
export function DtSeoTool(props: {
  organisationId: string;
  organisationName: string;
  /** „11 von 13 Abschnitten aus den Gesprächen · …“ or null without any Anbieterfakten. */
  anbieterHint: string | null;
  /** The organisation's avatars, newest first. */
  avatars: Array<{ id: string; name: string; role: string | null }>;
}) {
  const { organisationId } = props;
  const [source, setSource] = useState<TextToolSourceValue | null>(null);
  /** The page name last filled in from a crawled page; a name typed by hand is never overwritten. */
  const [autoName, setAutoName] = useState("");
  const [pageName, setPageName] = useState("");
  const [pageType, setPageType] = useState<SeoToolPageType>("unterseite");
  const [avatarId, setAvatarId] = useState<string>(props.avatars[0]?.id ?? NO_AVATAR);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [now, setNow] = useState(() => Date.now());

  // A second counter while the model writes, so a long wait does not look like a hang.
  useEffect(() => {
    if (phase.kind !== "running") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [phase.kind]);

  function resetResult() {
    if (phase.kind === "done" || phase.kind === "error") setPhase({ kind: "idle" });
  }

  function chooseSource(next: TextToolSourceValue | null) {
    setSource(next);
    resetResult();
    if (next?.kind === "crawl") {
      if (!pageName.trim() || pageName === autoName) {
        setPageName(next.page.name);
        setAutoName(next.page.name);
      }
      if (isSeoToolPageType(next.page.page_type)) setPageType(next.page.page_type);
    }
  }

  async function run() {
    if (!pageName.trim()) {
      toast.error("Bitte einen Seitennamen eingeben.");
      return;
    }
    setNow(Date.now());
    setPhase({ kind: "running", startedAt: Date.now() });
    const form = new FormData();
    form.set("organisationId", organisationId);
    appendTextToolSource(form, source);
    form.set("pageName", pageName);
    form.set("pageType", pageType);
    if (avatarId !== NO_AVATAR) form.set("avatarId", avatarId);
    let json: ContentApiResponse<SeoToolResult> | null = null;
    try {
      const res = await fetch(`/api/dt/text-tools/seo/run?${contentQuery(organisationId)}`, { method: "POST", body: form });
      json = (await res.json().catch(() => null)) as ContentApiResponse<SeoToolResult> | null;
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
    toast.success("SEO-Text ist fertig.");
  }

  const running = phase.kind === "running";
  const canRun = Boolean(pageName.trim()) && !running;
  const seconds = running ? Math.max(0, Math.round((now - phase.startedAt) / 1000)) : 0;
  const avatarOptions = [
    ...props.avatars.map((a) => ({ value: a.id, label: a.name, description: a.role ?? undefined })),
    { value: NO_AVATAR, label: "Ohne Avatar" },
  ];

  return (
    <div className="grid gap-5">
      <section aria-label="SEO-Werkzeug" className={cardClass}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent dark:via-white/10" />
        <header className="border-b border-sbkm-navy/8 px-4 py-3.5 dark:border-white/8 sm:px-5">
          <h2 className="text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">Seitentext schreiben</h2>
          <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/60">
            Eigenständiges Werkzeug: die Anweisung kommt aus Globale Prompts → SEO, die Textvorlage aus der Karte unten,
            Fakten aus den Anbieterfakten und der Leser aus dem gewählten Avatar von{" "}
            <span className="font-semibold">{props.organisationName}</span>. Keine Seitenstruktur, keine Einstellungen aus
            Texte.
          </p>
        </header>

        <div className="grid gap-4 px-4 py-4 sm:px-5">
          {!props.anbieterHint ? (
            <Notice tone="warn">
              Keine Anbieterfakten vorhanden (weder Anbieter-Fragebogen noch ausgewertete Gespräche). Der Text wird
              trotzdem geschrieben; Angaben ohne Beleg bekommen den Platzhalter „[BITTE PRÜFEN: …]“.
            </Notice>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <DtField label="Seitenname" htmlFor="seo-page-name">
              <DtInputWrap>
                <DtInput
                  id="seo-page-name"
                  value={pageName}
                  maxLength={200}
                  disabled={running}
                  placeholder="z. B. Badsanierung"
                  onChange={(event) => {
                    setPageName(event.target.value);
                    resetResult();
                  }}
                />
              </DtInputWrap>
              <p className={hintClass}>Name der Seite; auch der Dateiname des Exports.</p>
            </DtField>
            <DtField label="Seitentyp">
              <DtSelect
                value={pageType}
                onValueChange={(value) => setPageType(value as SeoToolPageType)}
                options={SEO_TOOL_PAGE_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                srLabel="Seitentyp"
                disabled={running}
                fullWidth
                searchable={false}
              />
              <p className={hintClass}>Bestimmt die Textvorlage aus der Karte „Textvorlagen“ unten.</p>
            </DtField>
          </div>

          <DtField label="Material" optional>
            <DtTextToolSource
              tool="seo"
              organisationId={organisationId}
              value={source}
              onChange={chooseSource}
              disabled={running}
              fileHint={
                <>
                  Bisheriger Seitentext oder ein Briefing-Dokument: .txt, .html, .pdf oder .docx, höchstens{" "}
                  {Math.round(TEXT_TOOL_MAX_FILE_BYTES / (1024 * 1024))} MB. Dient nur zur Orientierung für Thema, Umfang und Begriffe;
                  Fakten zählen nur, wenn sie in den Anbieterfakten stehen.
                </>
              }
              crawlHint="Ihr heutiger Text dient nur als Material (Thema, Umfang, Begriffe); Seitenname und Seitentyp werden vorgeschlagen."
            />
          </DtField>

          <DtField label="Avatar">
            <DtSelect
              value={avatarId}
              onValueChange={(value) => {
                setAvatarId(value);
                resetResult();
              }}
              options={avatarOptions}
              srLabel="Avatar"
              disabled={running}
              fullWidth
            />
            <p className={hintClass}>
              {props.avatars.length === 0
                ? "Diese Organisation hat noch keinen Avatar; der Text wird ohne Wunschkunden geschrieben."
                : "Der Wunschkunde, für den der Text geschrieben wird."}
            </p>
          </DtField>

          {phase.kind === "error" ? <Notice tone="error">{phase.message}</Notice> : null}

          <div className="flex flex-wrap items-center gap-3">
            <DtPillButton type="button" size="sm" disabled={!canRun} onClick={() => void run()}>
              {running ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
              {running ? "Text wird geschrieben …" : "Text schreiben"}
            </DtPillButton>
            {running ? (
              <span className="text-xs tabular-nums text-sbkm-ink-600 dark:text-white/60" aria-live="polite">
                {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} · Das Modell schreibt die ganze Seite, meist zwei
                bis vier Minuten. Die Seite bitte offen lassen.
              </span>
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
                {phase.result.blocks.length === 1 ? "Abschnitt" : "Abschnitte"}
                {phase.result.avatar_name ? ` · Avatar: ${phase.result.avatar_name}` : ""} · {phase.result.model} ·{" "}
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
            <DtContentTextFrame html={phase.result.html} title="SEO-Text (Vorschau)" />
          </div>
        </section>
      ) : null}

      <DtContentTypePromptsCard variant="seo_tool" />
    </div>
  );
}
