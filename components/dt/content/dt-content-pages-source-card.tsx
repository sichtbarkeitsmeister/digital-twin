"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, FileSpreadsheet, Globe, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/components/dt/cn";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { contentApi, contentQuery } from "@/components/dt/content/content-api";
import { formatContentDate } from "@/lib/dt/content/presentation";
import type { ContentCrawlImportResult, ContentCrawlStatus, ContentLocalSources, ContentOverview } from "@/lib/dt/content/types";
import {
  WEBSITE_STRUCTURE_FILE_ACCEPT,
  WEBSITE_STRUCTURE_FILE_HINT,
  readWebsiteStructureFile,
} from "@/lib/dt/seo/read-website-structure-file";

export type ContentPagesMode = "structure" | "crawl";

const CRAWL_POLL_MS = 5_000;

const cardClass =
  "relative overflow-hidden rounded-dt-lg border border-sbkm-navy/10 bg-white/55 shadow-dt backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.05]";

const MODES: Array<{
  id: ContentPagesMode;
  title: string;
  when: string;
  text: string;
  icon: typeof FileSpreadsheet;
}> = [
  {
    id: "structure",
    title: "Excel-Seitenstruktur",
    when: "Kunde ohne Website oder vor dem Relaunch",
    text: "Die Agentur-Vorlage „Seitenstruktur“ ausfüllen und hier hochladen. Jede Zeile wird eine Seite in der Tabelle.",
    icon: FileSpreadsheet,
  },
  {
    id: "crawl",
    title: "Crawler – bestehende Website",
    when: "Kunde hat eine Website und will bessere Texte",
    text: "Wir lesen alle Seiten der Live-Website ein (Sitemap und interne Links). Danach wählen Sie in der Tabelle, welche Seiten neue Texte bekommen.",
    icon: Globe,
  },
];

function storageKey(organisationId: string): string {
  return `dt-content-pages-mode:${organisationId}`;
}

function readStoredMode(organisationId: string): ContentPagesMode | null {
  try {
    const raw = window.localStorage.getItem(storageKey(organisationId));
    return raw === "structure" || raw === "crawl" ? raw : null;
  } catch {
    return null;
  }
}

/** Without a stored choice: the mode that already has pages, Excel otherwise. */
export function inferContentPagesMode(local: Pick<ContentLocalSources, "structure" | "pages"> | null): ContentPagesMode {
  if (!local) return "structure";
  if (local.pages.crawl > 0 && local.pages.structure === 0 && !local.structure) return "crawl";
  return "structure";
}

function pagesWord(n: number): string {
  return `${n} ${n === 1 ? "Seite" : "Seiten"}`;
}

export function DtContentPagesSourceCard(props: {
  organisationId: string;
  local: ContentLocalSources | null;
  loading: boolean;
  /** After an upload or import: reload readiness and the table (the overview when already known). */
  onChanged: (overview?: ContentOverview) => void;
}) {
  const { organisationId, local } = props;
  const [mode, setMode] = useState<ContentPagesMode | null>(null);
  const [uploading, setUploading] = useState(false);
  const [crawl, setCrawl] = useState<ContentCrawlStatus | null>(null);
  const [crawlError, setCrawlError] = useState<string | null>(null);
  const [crawlBusy, setCrawlBusy] = useState<"start" | "import" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode) return;
    const stored = readStoredMode(organisationId);
    if (stored) {
      setMode(stored);
    } else if (local) {
      setMode(inferContentPagesMode(local));
    }
  }, [mode, organisationId, local]);

  function chooseMode(next: ContentPagesMode) {
    setMode(next);
    try {
      window.localStorage.setItem(storageKey(organisationId), next);
    } catch {
      /* private mode: the choice just does not stick */
    }
  }

  const loadCrawl = useCallback(async () => {
    const res = await contentApi<ContentCrawlStatus>(`/api/dt/content/crawl?${contentQuery(organisationId)}`);
    if (res.ok) {
      setCrawl(res.data);
      setCrawlError(null);
    } else {
      setCrawlError(res.message);
    }
  }, [organisationId]);

  const crawlActive = Boolean(crawl?.crawl && (crawl.crawl.status === "queued" || crawl.crawl.status === "running"));

  useEffect(() => {
    if (mode !== "crawl") return;
    void loadCrawl();
  }, [mode, loadCrawl]);

  useEffect(() => {
    if (mode !== "crawl" || !crawlActive) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadCrawl();
    }, CRAWL_POLL_MS);
    return () => window.clearInterval(timer);
  }, [mode, crawlActive, loadCrawl]);

  async function uploadStructure(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const { text, filename, mimeType } = await readWebsiteStructureFile(file);
      const res = await fetch("/api/dt/seo/website-structure", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organisationId, text, filename, mimeType }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; message?: string; structure?: { nodeCount?: number } }
        | null;
      if (!res.ok || !json?.ok) {
        toast.error(json?.message ?? "Seitenstruktur konnte nicht gespeichert werden.");
        return;
      }
      const n = json.structure?.nodeCount ?? 0;
      toast.success(`Seitenstruktur „${filename}“ gespeichert`, {
        description: n > 0 ? `${n} Einträge erkannt – die Seiten erscheinen jetzt in der Tabelle.` : undefined,
      });
      props.onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Datei konnte nicht gelesen werden.");
    } finally {
      setUploading(false);
    }
  }

  async function startCrawl() {
    setCrawlBusy("start");
    try {
      const res = await contentApi<{ message: string; reused: boolean }>("/api/dt/content/crawl", {
        method: "POST",
        body: { organisationId },
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(res.data.reused ? "Der Crawl läuft bereits" : "Crawl gestartet", { description: res.data.message });
      await loadCrawl();
    } finally {
      setCrawlBusy(null);
    }
  }

  async function importCrawl() {
    setCrawlBusy("import");
    try {
      const res = await contentApi<ContentCrawlImportResult>("/api/dt/content/crawl/import", {
        method: "POST",
        body: { organisationId },
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const { imported, attached, skipped } = res.data;
      const parts = [
        imported > 0 ? `${pagesWord(imported)} neu in der Tabelle` : "Keine neue Seite",
        attached > 0 ? `${attached} vorhandene mit der Live-URL verknüpft` : "",
        skipped.redirected > 0 ? `${skipped.redirected} Weiterleitungen übersprungen` : "",
        skipped.over_limit > 0 ? `${skipped.over_limit} über dem Limit von 300` : "",
      ].filter(Boolean);
      toast.success("Seiten aus dem Crawl übernommen", { description: parts.join(" · ") });
      props.onChanged(res.data.overview);
      await loadCrawl();
    } finally {
      setCrawlBusy(null);
    }
  }

  const org = encodeURIComponent(organisationId);
  const structure = local?.structure ?? null;

  return (
    <section id="seitenquelle" aria-label="Seitenquelle" className={cn(cardClass, "scroll-mt-24")}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent dark:via-white/10" />
      <header className="border-b border-sbkm-navy/8 px-4 py-3.5 dark:border-white/8 sm:px-5">
        <h2 className="text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">Seitenquelle: Woher kommen die Seiten?</h2>
        <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/60">
          Zwei Wege, je nachdem, ob der Kunde schon eine Website hat. Beide füllen die Tabelle unten; dort haken Sie
          an, welche Seiten Texte bekommen.
        </p>
      </header>

      <div className="grid gap-3 px-4 py-4 sm:px-5">
        <div role="radiogroup" aria-label="Seitenquelle wählen" className="grid gap-3 sm:grid-cols-2">
          {MODES.map((option) => {
            const active = mode === option.id;
            const Icon = option.icon;
            const count = option.id === "structure" ? local?.pages.structure : local?.pages.crawl;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => chooseMode(option.id)}
                className={cn(
                  "grid gap-1.5 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45",
                  active
                    ? "border-sbkm-mint bg-sbkm-mint/[0.12] dark:border-sbkm-mint/70 dark:bg-sbkm-mint/[0.08]"
                    : "border-sbkm-navy/10 bg-white/60 hover:border-sbkm-navy/25 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/25",
                )}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-grid size-8 shrink-0 place-items-center rounded-lg",
                      active ? "bg-sbkm-mint/40 text-sbkm-navy" : "bg-sbkm-navy/[0.06] text-sbkm-ink-600 dark:bg-white/10 dark:text-white/70",
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="text-sm font-semibold text-sbkm-navy dark:text-white">{option.title}</span>
                  {count ? (
                    <span className="ml-auto rounded-pill bg-white/70 px-2 py-0.5 text-[11px] font-bold tabular-nums text-sbkm-navy dark:bg-white/10 dark:text-white">
                      {pagesWord(count)}
                    </span>
                  ) : null}
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-sbkm-ink-500 dark:text-white/45">
                  {option.when}
                </span>
                <span className="text-xs leading-relaxed text-sbkm-ink-600 dark:text-white/65">{option.text}</span>
              </button>
            );
          })}
        </div>

        {mode === "structure" ? (
          <div className="grid gap-3 rounded-xl border border-sbkm-navy/8 bg-sbkm-navy/[0.02] p-4 text-sm dark:border-white/8 dark:bg-white/[0.03]">
            <p className="text-xs text-sbkm-ink-600 dark:text-white/65">
              {props.loading && !local ? (
                "Lädt …"
              ) : structure ? (
                <>
                  Aktuell: <span className="font-semibold text-sbkm-navy dark:text-white">„{structure.filename?.trim() || "ohne Dateiname"}“</span>
                  {structure.nodeCount > 0 ? ` · ${structure.nodeCount} Einträge` : ""}
                  {structure.uploadedAt ? ` · hochgeladen ${formatContentDate(structure.uploadedAt)}` : ""}
                  {local ? ` · ${pagesWord(local.pages.structure)} in der Tabelle` : ""}
                </>
              ) : (
                "Noch keine Seitenstruktur hochgeladen."
              )}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept={WEBSITE_STRUCTURE_FILE_ACCEPT}
                className="sr-only"
                aria-label="Seitenstruktur-Datei wählen"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  void uploadStructure(file);
                }}
              />
              <DtPillButton type="button" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
                {structure ? "Neue Datei hochladen" : "Seitenstruktur hochladen"}
              </DtPillButton>
              <Link
                href={`/dashboard/verwaltung/seo?org=${org}&tab=struktur`}
                className="inline-flex items-center gap-1 text-xs font-semibold text-sbkm-navy underline-offset-2 hover:underline dark:text-sbkm-mint"
              >
                Als Text bearbeiten (SEO → Struktur)
                <ArrowRight className="size-3" aria-hidden />
              </Link>
            </div>
            <p className="text-[11px] leading-relaxed text-sbkm-ink-500 dark:text-white/45">
              {WEBSITE_STRUCTURE_FILE_HINT}. Die Vorlage: eine Zeile pro Seite, Spalten „Ebene 1 … Ebene 3“ (oder „Seite“ und „Pfad“).
              Nach dem Upload erscheinen die Seiten von selbst in der Tabelle; Seiten mit Text bleiben erhalten.
            </p>
          </div>
        ) : null}

        {mode === "crawl" ? (
          <div className="grid gap-3 rounded-xl border border-sbkm-navy/8 bg-sbkm-navy/[0.02] p-4 text-sm dark:border-white/8 dark:bg-white/[0.03]">
            {crawlError ? (
              <p className="text-xs text-red-700 dark:text-red-300">{crawlError}</p>
            ) : !crawl ? (
              <p className="flex items-center gap-2 text-xs text-sbkm-ink-600 dark:text-white/65">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Crawl-Status wird geladen …
              </p>
            ) : !crawl.website_url ? (
              <div className="grid gap-2">
                <p className="text-xs text-sbkm-ink-600 dark:text-white/65">
                  Für den Crawler braucht die Organisation eine Website-URL. Bitte unter SEO → Einstellungen hinterlegen.
                </p>
                <Link
                  href={`/dashboard/verwaltung/seo?org=${org}&tab=settings`}
                  className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-sbkm-navy underline-offset-2 hover:underline dark:text-sbkm-mint"
                >
                  Zu den SEO-Einstellungen
                  <ArrowRight className="size-3" aria-hidden />
                </Link>
              </div>
            ) : (
              <>
                <p className="text-xs text-sbkm-ink-600 dark:text-white/65">
                  Website: <span className="font-semibold text-sbkm-navy dark:text-white">{crawl.website_url}</span>
                  {crawl.page_count > 0 ? (
                    <>
                      {" · "}
                      {pagesWord(crawl.page_count)} im Crawl
                      {crawl.last_crawled_at ? ` (Stand ${formatContentDate(crawl.last_crawled_at)})` : ""}
                      {` · ${crawl.imported} davon in der Tabelle`}
                    </>
                  ) : (
                    " · noch nicht gecrawlt"
                  )}
                </p>
                {crawlActive && crawl.crawl ? (
                  <p className="flex items-center gap-2 text-xs text-sky-800 dark:text-sky-200">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    {crawl.crawl.status === "queued"
                      ? "Crawl in der Warteschlange …"
                      : `${crawl.crawl.pages_crawled} von ${crawl.crawl.pages_discovered} Seiten gelesen`}
                    {crawl.crawl.message ? ` – ${crawl.crawl.message}` : ""}
                  </p>
                ) : null}
                {!crawlActive && crawl.last_crawl_error ? (
                  <p className="text-xs text-red-700 dark:text-red-300">Letzter Crawl: {crawl.last_crawl_error}</p>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <DtPillButton
                    type="button"
                    size="sm"
                    variant={crawl.page_count > 0 ? "outline" : "mint"}
                    disabled={crawlBusy != null || crawlActive}
                    onClick={() => void startCrawl()}
                  >
                    {crawlBusy === "start" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Globe className="size-4" aria-hidden />}
                    {crawl.page_count > 0 ? "Erneut crawlen" : "Website crawlen"}
                  </DtPillButton>
                  <DtPillButton
                    type="button"
                    size="sm"
                    disabled={crawlBusy != null || crawlActive || crawl.page_count === 0}
                    onClick={() => void importCrawl()}
                  >
                    {crawlBusy === "import" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                    {crawl.page_count > 0 ? `${pagesWord(crawl.page_count)} übernehmen` : "Seiten übernehmen"}
                  </DtPillButton>
                </div>
                <p className="text-[11px] leading-relaxed text-sbkm-ink-500 dark:text-white/45">
                  Der Crawl läuft im Hintergrund (wie in SEO Modus). „Übernehmen“ legt für jede gecrawlte Seite eine Zeile an –
                  ohne AGB/Widerruf und Weiterleitungen, höchstens 300. Vorhandene Zeilen behalten ihren Text und bekommen nur die
                  Live-URL; der bisherige Seitentext fließt als Orientierung in die Schritte ein. Welche Seiten Texte bekommen,
                  wählen Sie unten per Häkchen.
                </p>
              </>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
