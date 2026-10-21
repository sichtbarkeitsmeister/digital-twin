"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Globe, Loader2, RefreshCw, Search, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/components/dt/cn";
import { contentApi, contentQuery } from "@/components/dt/content/content-api";
import { DtInput, DtInputWrap } from "@/components/dt/dt-field";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { CONTENT_PAGE_TYPE_LABELS } from "@/lib/dt/content/page-types";
import { formatContentDate } from "@/lib/dt/content/presentation";
import type { ContentCrawlStatus } from "@/lib/dt/content/types";
import type { CrawlSourcePage, CrawlSourcePagesResult } from "@/lib/dt/text-tools/crawl-source";
import { TEXT_TOOL_ACCEPT, TEXT_TOOL_MAX_FILE_BYTES } from "@/lib/dt/text-tools/ingest";

/** What a tool sends: the uploaded file, or the URL of a page from the crawl. */
export type TextToolSourceValue = { kind: "file"; file: File } | { kind: "crawl"; page: CrawlSourcePage };

type Mode = "file" | "crawl";

const CRAWL_POLL_MS = 5_000;
const hintClass = "text-[11px] leading-relaxed text-sbkm-ink-500 dark:text-white/45";
const panelClass = "grid gap-3 rounded-xl border border-sbkm-navy/8 bg-sbkm-navy/[0.02] p-4 text-sm dark:border-white/8 dark:bg-white/[0.03]";

const MODES: ReadonlyArray<{ id: Mode; title: string; text: string; icon: typeof Upload }> = [
  { id: "file", title: "Datei hochladen", text: ".txt, .html, .pdf oder .docx vom Rechner.", icon: Upload },
  { id: "crawl", title: "Website crawlen", text: "Eine Seite der Website wählen – derselbe Crawl wie in Texte.", icon: Globe },
];

function pagesWord(n: number): string {
  return `${n.toLocaleString("de-DE")} ${n === 1 ? "Seite" : "Seiten"}`;
}

function storageKey(tool: string, organisationId: string): string {
  return `dt-text-tool-source:${tool}:${organisationId}`;
}

/** Applies to the form in the parent: the file goes as `file`, a crawled page as `crawlUrl`. */
export function appendTextToolSource(form: FormData, value: TextToolSourceValue | null): void {
  if (!value) return;
  if (value.kind === "file") form.set("file", value.file);
  else form.set("crawlUrl", value.page.url);
}

/**
 * The input of the text tools SEO, GEO and Hormozi: upload a file as before, or pick a page
 * of the crawled website. The crawl is the one of Texte (`/api/dt/content/crawl`: same
 * button, same background job, same pages); the table lists the pages Texte would take over
 * (`/api/dt/text-tools/crawl-pages`), without copying anything into Texte.
 */
export function DtTextToolSource(props: {
  /** Tool key for the remembered choice („seo“, „geo“, „hormozi“). */
  tool: string;
  organisationId: string;
  value: TextToolSourceValue | null;
  onChange: (value: TextToolSourceValue | null) => void;
  disabled?: boolean;
  /** Under the file button; what the upload is for in this tool. */
  fileHint: React.ReactNode;
  /** Under the page table; what the chosen page is used for in this tool. */
  crawlHint: React.ReactNode;
}) {
  const { organisationId, value, onChange, disabled } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("file");
  const [crawl, setCrawl] = useState<ContentCrawlStatus | null>(null);
  const [crawlError, setCrawlError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [pages, setPages] = useState<CrawlSourcePagesResult | null>(null);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey(props.tool, organisationId));
      if (stored === "crawl" || stored === "file") setMode(stored);
    } catch {
      /* private mode: start with the upload */
    }
  }, [props.tool, organisationId]);

  function chooseMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    onChange(null);
    try {
      window.localStorage.setItem(storageKey(props.tool, organisationId), next);
    } catch {
      /* the choice just does not stick */
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

  const loadPages = useCallback(async () => {
    setPagesLoading(true);
    const res = await contentApi<CrawlSourcePagesResult>(`/api/dt/text-tools/crawl-pages?${contentQuery(organisationId)}`);
    setPagesLoading(false);
    if (res.ok) {
      setPages(res.data);
      setPagesError(null);
    } else {
      setPagesError(res.message);
    }
  }, [organisationId]);

  const crawlActive = Boolean(crawl?.crawl && (crawl.crawl.status === "queued" || crawl.crawl.status === "running"));
  // The table follows the crawl: a new list when the page count or the crawl date changes.
  const crawlStamp = `${crawl?.page_count ?? ""}|${crawl?.last_crawled_at ?? ""}|${crawlActive}`;

  useEffect(() => {
    if (mode !== "crawl") return;
    void loadCrawl();
  }, [mode, loadCrawl]);

  const crawlLoaded = crawl !== null;
  useEffect(() => {
    if (mode !== "crawl" || !crawlLoaded || crawlActive) return;
    void loadPages();
  }, [mode, loadPages, crawlStamp, crawlLoaded, crawlActive]);

  useEffect(() => {
    if (mode !== "crawl" || !crawlActive) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadCrawl();
    }, CRAWL_POLL_MS);
    return () => window.clearInterval(timer);
  }, [mode, crawlActive, loadCrawl]);

  async function startCrawl() {
    setStarting(true);
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
      setStarting(false);
    }
  }

  function pickFile(next: File | undefined) {
    if (!next) return;
    if (next.size > TEXT_TOOL_MAX_FILE_BYTES) {
      toast.error(`„${next.name}“ ist zu groß (max. ${Math.round(TEXT_TOOL_MAX_FILE_BYTES / (1024 * 1024))} MB).`);
      return;
    }
    onChange({ kind: "file", file: next });
  }

  const filtered = useMemo(() => {
    const list = pages?.pages ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) => `${p.name} ${p.path}`.toLowerCase().includes(q));
  }, [pages, query]);

  const selectedUrl = value?.kind === "crawl" ? value.page.url : null;
  const org = encodeURIComponent(organisationId);

  return (
    <div className="grid gap-3">
      <div role="radiogroup" aria-label="Quelle wählen" className="grid gap-2 sm:grid-cols-2">
        {MODES.map((option) => {
          const active = mode === option.id;
          const Icon = option.icon;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => chooseMode(option.id)}
              className={cn(
                "flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 disabled:opacity-60",
                active
                  ? "border-sbkm-mint bg-sbkm-mint/[0.12] dark:border-sbkm-mint/70 dark:bg-sbkm-mint/[0.08]"
                  : "border-sbkm-navy/10 bg-white/60 hover:border-sbkm-navy/25 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/25",
              )}
            >
              <span
                className={cn(
                  "inline-grid size-8 shrink-0 place-items-center rounded-lg",
                  active ? "bg-sbkm-mint/40 text-sbkm-navy" : "bg-sbkm-navy/[0.06] text-sbkm-ink-600 dark:bg-white/10 dark:text-white/70",
                )}
              >
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="grid gap-0.5">
                <span className="text-sm font-semibold text-sbkm-navy dark:text-white">{option.title}</span>
                <span className="text-xs leading-relaxed text-sbkm-ink-600 dark:text-white/65">{option.text}</span>
              </span>
            </button>
          );
        })}
      </div>

      {mode === "file" ? (
        <div className="grid gap-1.5">
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
            <DtPillButton type="button" size="sm" variant="outline" disabled={disabled} onClick={() => fileRef.current?.click()}>
              <Upload className="size-3.5" aria-hidden />
              {value?.kind === "file" ? "Andere Datei" : "Datei hochladen"}
            </DtPillButton>
            {value?.kind === "file" ? (
              <>
                <span className="truncate text-xs text-sbkm-navy dark:text-white/85" title={value.file.name}>
                  {value.file.name} · {Math.max(1, Math.round(value.file.size / 1024))} KB
                </span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[11px] text-sbkm-ink-500 hover:text-sbkm-navy dark:text-white/45 dark:hover:text-white"
                  disabled={disabled}
                  onClick={() => onChange(null)}
                >
                  <X className="size-3" aria-hidden />
                  Entfernen
                </button>
              </>
            ) : null}
          </div>
          <p className={hintClass}>{props.fileHint}</p>
        </div>
      ) : (
        <div className="grid gap-3">
          <div className={panelClass}>
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
                    disabled={disabled || starting || crawlActive}
                    onClick={() => void startCrawl()}
                  >
                    {starting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Globe className="size-4" aria-hidden />}
                    {crawl.page_count > 0 ? "Erneut crawlen" : "Website crawlen"}
                  </DtPillButton>
                  {crawl.page_count > 0 ? (
                    <DtPillButton type="button" size="sm" variant="ghost" disabled={pagesLoading || crawlActive} onClick={() => void loadPages()}>
                      {pagesLoading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
                      Liste neu laden
                    </DtPillButton>
                  ) : null}
                </div>
                <p className={hintClass}>
                  Derselbe Crawl wie in Texte (Sitemap und interne Links). Die Liste zeigt die Seiten, die Texte übernehmen
                  würde – ohne AGB/Widerruf, Weiterleitungen und Doppelte. Hier wird nichts in Texte angelegt.
                </p>
              </>
            )}
          </div>

          {crawl?.website_url && crawl.page_count > 0 ? (
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-sbkm-navy dark:text-white">
                  {pages ? `${pagesWord(pages.pages.length)} zur Auswahl` : "Seiten werden geladen …"}
                </p>
                <DtInputWrap icon={<Search className="size-3.5" aria-hidden />} className="w-full sm:w-64">
                  <DtInput
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Seite suchen"
                    aria-label="Seite suchen"
                  />
                </DtInputWrap>
              </div>
              {pagesError ? <p className="text-xs text-red-700 dark:text-red-300">{pagesError}</p> : null}
              <div className="max-h-80 overflow-y-auto rounded-xl border border-sbkm-navy/10 dark:border-white/10">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-white/95 text-[11px] uppercase tracking-wider text-sbkm-ink-500 backdrop-blur dark:bg-sbkm-navy/95 dark:text-white/45">
                    <tr>
                      <th scope="col" className="w-8 px-3 py-2">
                        <span className="sr-only">Gewählt</span>
                      </th>
                      <th scope="col" className="px-3 py-2">Seite</th>
                      <th scope="col" className="hidden px-3 py-2 sm:table-cell">Seitentyp</th>
                      <th scope="col" className="hidden px-3 py-2 text-right sm:table-cell">Ebene</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((page) => {
                      const selected = page.url === selectedUrl;
                      return (
                        <tr
                          key={page.url}
                          aria-selected={selected}
                          tabIndex={disabled ? -1 : 0}
                          onClick={() => !disabled && onChange({ kind: "crawl", page })}
                          onKeyDown={(event) => {
                            if (disabled) return;
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onChange({ kind: "crawl", page });
                            }
                          }}
                          className={cn(
                            "cursor-pointer border-t border-sbkm-navy/6 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sbkm-mint/45 dark:border-white/6",
                            selected ? "bg-sbkm-mint/[0.18] dark:bg-sbkm-mint/[0.12]" : "hover:bg-sbkm-navy/[0.03] dark:hover:bg-white/[0.04]",
                          )}
                        >
                          <td className="px-3 py-2 align-top">
                            <span
                              className={cn(
                                "inline-grid size-4 place-items-center rounded-full border",
                                selected ? "border-sbkm-mint bg-sbkm-mint text-sbkm-navy" : "border-sbkm-navy/25 dark:border-white/30",
                              )}
                            >
                              {selected ? <Check className="size-3" aria-hidden /> : null}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span className="block font-semibold text-sbkm-navy dark:text-white">{page.name}</span>
                            <span className="block truncate text-[11px] text-sbkm-ink-500 dark:text-white/45" title={page.url}>
                              {page.path}
                            </span>
                          </td>
                          <td className="hidden px-3 py-2 align-top text-sbkm-ink-600 dark:text-white/65 sm:table-cell">
                            {CONTENT_PAGE_TYPE_LABELS[page.page_type]}
                          </td>
                          <td className="hidden px-3 py-2 text-right align-top tabular-nums text-sbkm-ink-600 dark:text-white/65 sm:table-cell">
                            {page.level}
                          </td>
                        </tr>
                      );
                    })}
                    {pages && filtered.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-4 text-center text-sbkm-ink-500 dark:text-white/45">
                          {query ? "Keine Seite passt zur Suche." : "Der Crawl hat keine Seite, die sich bearbeiten lässt."}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <p className={hintClass}>
                {value?.kind === "crawl" ? (
                  <>
                    Gewählt: <span className="font-semibold text-sbkm-navy dark:text-white">{value.page.name}</span> ({value.page.path}).{" "}
                  </>
                ) : (
                  "Eine Zeile anklicken, um die Seite zu wählen. "
                )}
                {props.crawlHint}
              </p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
