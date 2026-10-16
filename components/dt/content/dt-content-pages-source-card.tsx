"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, FilePlus2, FileSpreadsheet, Globe, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/components/dt/cn";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { contentApi, contentQuery } from "@/components/dt/content/content-api";
import { formatContentDate } from "@/lib/dt/content/presentation";
import {
  CONTENT_STRUCTURE_FILE_ACCEPT,
  CONTENT_STRUCTURE_FILE_HINT,
  readContentStructureFile,
} from "@/lib/dt/content/read-content-structure-file";
import type {
  ContentCrawlImportResult,
  ContentCrawlStatus,
  ContentLocalSources,
  ContentOverview,
  ContentStructureCreateResult,
  ContentStructurePlanResult,
  ContentStructureUploadResult,
} from "@/lib/dt/content/types";

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
    title: "Neue Website",
    when: "Kunde hat noch keine Website",
    text: "Seitenstruktur hochladen. Jede Zeile wird eine Seite, die neu geschrieben wird.",
    icon: FileSpreadsheet,
  },
  {
    id: "crawl",
    title: "Verbesserung",
    when: "Bestehende Website überarbeiten",
    text: "Website crawlen und die Seitenstruktur hochladen. Seiten, die es auf der Website noch nicht gibt, können angelegt werden.",
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

/**
 * „Verbesserung“: the pages of the Seitenstruktur that the website does not have (without a
 * crawl: that the table does not have), and the button that creates exactly those.
 */
function StructurePlanList(props: {
  plan: ContentStructurePlanResult;
  creating: boolean;
  onCreate: () => void;
}) {
  const { plan } = props;
  if (!plan.structure) return null;
  const empty = plan.missing.length === 0;
  return (
    <div className="grid gap-2 border-t border-sbkm-navy/8 pt-3 dark:border-white/8" data-testid="content-structure-plan">
      {empty ? (
        <p className="text-xs font-semibold text-sbkm-navy dark:text-white">
          {plan.crawled
            ? "Alle Seiten der Seitenstruktur gibt es bereits auf der Website."
            : "Alle Seiten der Seitenstruktur stehen bereits in der Tabelle."}
        </p>
      ) : (
        <>
          <p className="text-xs font-semibold text-sbkm-navy dark:text-white">
            {plan.crawled
              ? "Diese Seiten stehen in der Seitenstruktur, gibt es auf der Website aber noch nicht."
              : "Noch kein Crawl. Diese Seiten sind in der Seitenstruktur und können neu angelegt werden."}
          </p>
          <ul className="grid max-h-64 gap-1 overflow-y-auto rounded-lg border border-sbkm-navy/8 bg-white/70 p-2 text-xs scrollbar-subtle dark:border-white/8 dark:bg-white/[0.04]">
            {plan.missing.map((page) => (
              <li key={page.slug} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-1 py-0.5">
                <span className="font-semibold text-sbkm-navy dark:text-white">{page.name}</span>
                <span className="font-mono text-[11px] text-sbkm-ink-500 dark:text-white/45">{page.path ?? "ohne Pfad"}</span>
                <span className="ml-auto rounded-pill bg-sbkm-navy/[0.06] px-2 py-0.5 text-[10px] font-bold text-sbkm-ink-600 dark:bg-white/10 dark:text-white/70">
                  {page.page_type_label}
                </span>
              </li>
            ))}
          </ul>
          <div>
            <DtPillButton type="button" size="sm" disabled={props.creating} onClick={props.onCreate}>
              {props.creating ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FilePlus2 className="size-4" aria-hidden />}
              Diese Seiten anlegen
            </DtPillButton>
          </div>
        </>
      )}
      {plan.on_site > 0 ? (
        <p className="text-[11px] leading-relaxed text-sbkm-ink-500 dark:text-white/45">
          {pagesWord(plan.on_site)} der Seitenstruktur {plan.on_site === 1 ? "ist" : "sind"} im Crawl, aber noch nicht in der
          Tabelle. „Übernehmen“ legt sie mit dem Briefing aus der Datei an.
        </p>
      ) : null}
    </div>
  );
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
  const [plan, setPlan] = useState<ContentStructurePlanResult | null>(null);
  const [creating, setCreating] = useState(false);
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

  const loadPlan = useCallback(async () => {
    const res = await contentApi<ContentStructurePlanResult>(`/api/dt/content/structure?${contentQuery(organisationId)}`);
    if (res.ok) setPlan(res.data);
  }, [organisationId]);

  // The list follows the table, the uploaded structure and the crawl (also when a crawl ends).
  const structureStamp = local?.structure?.uploadedAt ?? null;
  const pageTotal = local?.pages.total ?? null;
  const crawlStamp = `${crawl?.page_count ?? ""}|${crawl?.last_crawled_at ?? ""}|${crawlActive}`;
  useEffect(() => {
    if (mode !== "crawl") return;
    void loadPlan();
  }, [mode, loadPlan, structureStamp, pageTotal, crawlStamp]);

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

  /**
   * Excel rows go to `/api/dt/content/structure`, which keeps every briefing column on the
   * page rows and hands SEO → Struktur the same pages as an outline.
   */
  async function uploadStructure(file: File | undefined) {
    if (!file) return;
    const uploadMode: ContentPagesMode = mode ?? "structure";
    setUploading(true);
    try {
      const payload = await readContentStructureFile(file);
      const res = await contentApi<ContentStructureUploadResult>("/api/dt/content/structure", {
        method: "POST",
        body: { organisationId, ...payload, mode: uploadMode },
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const d = res.data;
      if (d.mode === "crawl") {
        if (d.plan) setPlan(d.plan);
        const missing = d.plan?.missing.length ?? 0;
        const parts = [
          `${pagesWord(d.pages)} in der Datei`,
          d.updated > 0 ? `${d.updated} vorhandene mit Briefing aktualisiert` : "keine vorhandene Seite getroffen",
          missing > 0 ? `${missing} noch nicht auf der Website` : "",
          d.plan && d.plan.on_site > 0 ? `${d.plan.on_site} im Crawl, noch nicht übernommen` : "",
        ].filter(Boolean);
        toast.success(`Seitenstruktur „${payload.filename}“ gespeichert`, { description: parts.join(" · ") });
        props.onChanged(d.overview);
        return;
      }
      const parts = [
        `${pagesWord(d.pages)} in der Tabelle`,
        d.keywords > 0 ? `${d.keywords} mit Keywords` : "",
        d.questions > 0 ? `${d.questions} mit Nutzerfragen` : "",
        d.h1_options > 0 ? `${d.h1_options} mit H1-Optionen` : "",
        d.skipped > 0 ? `${d.skipped} nicht zu bearbeiten (Impressum, Kontakt …)` : "",
        d.layout === "text" || (d.layout === "template" && d.keywords === 0 && d.questions === 0)
          ? "ohne Briefing-Spalten – Keywords und Fragen erarbeitet die Analyse"
          : "",
      ].filter(Boolean);
      toast.success(`Seitenstruktur „${payload.filename}“ gespeichert`, { description: parts.join(" · ") });
      props.onChanged(d.overview);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Datei konnte nicht gelesen werden.");
    } finally {
      setUploading(false);
    }
  }

  /** „Diese Seiten anlegen“: exactly the listed pages become rows of the table. */
  async function createMissingPages() {
    if (!plan || plan.missing.length === 0) return;
    setCreating(true);
    try {
      const res = await contentApi<ContentStructureCreateResult>("/api/dt/content/structure/missing", {
        method: "POST",
        body: { organisationId, slugs: plan.missing.map((p) => p.slug) },
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setPlan(res.data.plan);
      toast.success(res.data.created > 0 ? `${pagesWord(res.data.created)} angelegt` : "Keine Seite angelegt", {
        description: res.data.created > 0 ? "Sie stehen jetzt in der Tabelle und können gestartet werden." : undefined,
      });
      props.onChanged(res.data.overview);
    } finally {
      setCreating(false);
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
      const { imported, attached, briefed, skipped } = res.data;
      const parts = [
        imported > 0 ? `${pagesWord(imported)} neu in der Tabelle` : "Keine neue Seite",
        attached > 0 ? `${attached} vorhandene mit der Live-URL verknüpft` : "",
        briefed > 0 ? `${briefed} mit Briefing aus der Seitenstruktur` : "",
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
        <h2 className="text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">Seitenquelle</h2>
        <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/60">
          Woher die Seiten kommen. Welche davon Texte bekommen, haken Sie unten in der Tabelle an.
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

        {/* One file input for both modes; the upload goes with the mode that is shown. */}
        <input
          ref={fileRef}
          type="file"
          accept={CONTENT_STRUCTURE_FILE_ACCEPT}
          className="sr-only"
          aria-label="Seitenstruktur-Datei wählen"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            void uploadStructure(file);
          }}
        />

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
              <DtPillButton type="button" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
                {structure ? "Neue Datei hochladen" : "Seitenstruktur hochladen"}
              </DtPillButton>
              <Link
                href={`/dashboard/verwaltung/seo?org=${org}&tab=struktur`}
                className="inline-flex items-center gap-1 text-xs font-semibold text-sbkm-navy underline-offset-2 hover:underline dark:text-sbkm-mint"
              >
                In SEO → Struktur bearbeiten
                <ArrowRight className="size-3" aria-hidden />
              </Link>
            </div>
            <p className="text-[11px] leading-relaxed text-sbkm-ink-500 dark:text-white/45">
              {CONTENT_STRUCTURE_FILE_HINT} Seiten mit Text bleiben erhalten; Keywords, Fragen und Seitentyp folgen der
              neuen Datei. Impressum, Datenschutz, Kontakt und Co. werden als „Nicht bearbeiten“ angelegt.
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
                  Dafür braucht es die Website-URL des Kunden – unter SEO → Einstellungen eintragen.
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
                      ? "Crawl startet …"
                      : `${crawl.crawl.pages_crawled} von ${crawl.crawl.pages_discovered} Seiten gelesen`}
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
                  „Übernehmen“ legt für jede gecrawlte Seite eine Zeile an (ohne AGB/Widerruf, höchstens 300). Seiten mit Text
                  bleiben erhalten.
                </p>
              </>
            )}
          </div>
        ) : null}

        {mode === "crawl" ? (
          <div className="grid gap-3 rounded-xl border border-sbkm-navy/8 bg-sbkm-navy/[0.02] p-4 text-sm dark:border-white/8 dark:bg-white/[0.03]">
            <p className="text-xs text-sbkm-ink-600 dark:text-white/65">
              {props.loading && !local ? (
                "Lädt …"
              ) : structure ? (
                <>
                  Seitenstruktur:{" "}
                  <span className="font-semibold text-sbkm-navy dark:text-white">„{structure.filename?.trim() || "ohne Dateiname"}“</span>
                  {structure.nodeCount > 0 ? ` · ${structure.nodeCount} Einträge` : ""}
                  {structure.uploadedAt ? ` · hochgeladen ${formatContentDate(structure.uploadedAt)}` : ""}
                </>
              ) : (
                "Noch keine Seitenstruktur hochgeladen."
              )}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <DtPillButton type="button" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
                {structure ? "Neue Seitenstruktur hochladen" : "Seitenstruktur hochladen"}
              </DtPillButton>
              <Link
                href={`/dashboard/verwaltung/seo?org=${org}&tab=struktur`}
                className="inline-flex items-center gap-1 text-xs font-semibold text-sbkm-navy underline-offset-2 hover:underline dark:text-sbkm-mint"
              >
                In SEO → Struktur ansehen
                <ArrowRight className="size-3" aria-hidden />
              </Link>
            </div>
            <p className="text-[11px] leading-relaxed text-sbkm-ink-500 dark:text-white/45">
              {CONTENT_STRUCTURE_FILE_HINT} Seiten, die es schon gibt (in der Tabelle oder im Crawl), bekommen Seitentyp,
              Hauptsilo, Keywords, H1-Optionen, Nutzerfragen, KI-Prompt und Linkziele aus der Datei; ihr Text und die Live-URL
              bleiben. Gecrawlte Seiten, die nicht in der Datei stehen, bleiben in der Tabelle. Neue Seiten entstehen nur über
              „Diese Seiten anlegen“.
            </p>
            {plan ? <StructurePlanList plan={plan} creating={creating} onCreate={() => void createMissingPages()} /> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
