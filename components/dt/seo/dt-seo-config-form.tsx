"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";

import { DtPillButton } from "@/components/dt/dt-pill-button";
import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { checklistToText, textToChecklist } from "@/lib/dt/seo/seo-checklist";

type Config = {
  organisation_id: string;
  display_name: string;
  seo_enabled: boolean;
  website_url: string | null;
  ga4_property_id: string | null;
  gsc_site_url: string | null;
  sistrix_domain: string | null;
  sitemap_url: string | null;
  focus_keyword: string | null;
  report_recipient_email: string | null;
  report_timeframe: string;
  seo_checklist: unknown;
  seo_checklist_personalized: boolean;
};

type CrawlStatus = {
  id: string;
  status: string;
  pagesCrawled: number;
  pagesDiscovered: number;
  maxPages: number;
  message: string | null;
};

type CrawlInfo = {
  count: number;
  withTextCount: number;
  lastCrawledAt: string | null;
  crawl: CrawlStatus | null;
  lastCrawlError: string | null;
};

const ACTIVE_CRAWL_STATUSES = new Set(["queued", "running"]);

export function DtSeoConfigForm(props: {
  organisationId: string;
  canEdit: boolean;
  isPlatformAdmin?: boolean;
}) {
  const [config, setConfig] = useState<Config | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [crawlInfo, setCrawlInfo] = useState<CrawlInfo | null>(null);
  const [checklistText, setChecklistText] = useState("");
  const [globalChecklistText, setGlobalChecklistText] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadGlobalChecklist = useCallback(async () => {
    const res = await fetch("/api/dt/platform-settings/seo-checklist");
    const json = (await res.json()) as { ok?: boolean; checklist?: unknown };
    if (json.ok) {
      setGlobalChecklistText(checklistToText(json.checklist));
    }
  }, []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/dt/org-config/${props.organisationId}`);
    const json = (await res.json()) as { ok?: boolean; config?: Config };
    if (json.ok && json.config) {
      setConfig(json.config);
      setChecklistText(checklistToText(json.config.seo_checklist));
    }
  }, [props.organisationId]);

  const loadCrawlInfo = useCallback(async () => {
    const res = await fetch(`/api/dt/seo/crawl?org=${encodeURIComponent(props.organisationId)}`);
    const json = (await res.json()) as {
      ok?: boolean;
      count?: number;
      withTextCount?: number;
      lastCrawledAt?: string | null;
      crawl?: CrawlStatus | null;
      lastCrawlError?: string | null;
    };
    if (json.ok) {
      setCrawlInfo({
        count: json.count ?? 0,
        withTextCount: json.withTextCount ?? 0,
        lastCrawledAt: json.lastCrawledAt ?? null,
        crawl: json.crawl ?? null,
        lastCrawlError: json.lastCrawlError ?? null,
      });
      return json.crawl ?? null;
    }
    return null;
  }, [props.organisationId]);

  useEffect(() => {
    void load();
    void loadCrawlInfo();
    void loadGlobalChecklist();
  }, [load, loadCrawlInfo, loadGlobalChecklist]);

  useEffect(() => {
    const active = crawlInfo?.crawl && ACTIVE_CRAWL_STATUSES.has(crawlInfo.crawl.status);
    if (active) {
      pollRef.current = setInterval(() => {
        void loadCrawlInfo();
      }, 3000);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [crawlInfo?.crawl?.status, crawlInfo?.crawl?.id, loadCrawlInfo]);

  async function save(patch: Record<string, unknown>) {
    if (!props.canEdit) return;
    setBusy(true);
    setStatus(null);
    const res = await fetch(`/api/dt/org-config/${props.organisationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = (await res.json()) as { ok?: boolean; message?: string; config?: Config };
    setBusy(false);
    if (!json.ok) {
      setStatus(json.message ?? "Speichern fehlgeschlagen.");
      return;
    }
    if (json.config) {
      setConfig(json.config);
      if (json.config.seo_checklist !== undefined) {
        setChecklistText(checklistToText(json.config.seo_checklist));
      }
    }
    setStatus("Gespeichert.");
  }

  async function runCrawl() {
    setBusy(true);
    setStatus(null);
    const res = await fetch("/api/dt/seo/crawl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organisationId: props.organisationId }),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      message?: string;
      status?: string;
      pagesCrawled?: number;
      pagesDiscovered?: number;
    };
    setBusy(false);
    if (!json.ok) {
      setStatus(json.message ?? "Crawl fehlgeschlagen.");
      return;
    }
    setStatus(json.message ?? "Hintergrund-Crawl gestartet.");
    await loadCrawlInfo();
  }

  async function stopCrawl() {
    setBusy(true);
    const res = await fetch(
      `/api/dt/seo/crawl?action=stop&org=${encodeURIComponent(props.organisationId)}`,
      { method: "POST" },
    );
    const json = (await res.json()) as { ok?: boolean; message?: string };
    setBusy(false);
    setStatus(json.ok ? (json.message ?? "Crawl abgebrochen.") : (json.message ?? "Abbruch fehlgeschlagen."));
    await loadCrawlInfo();
  }

  function crawledHint(): string {
    if (crawlInfo?.lastCrawlError && !crawlInfo.crawl) {
      return crawlInfo.lastCrawlError;
    }
    const crawl = crawlInfo?.crawl;
    if (crawl && crawl.status === "error") {
      return crawl.message ?? "Crawl fehlgeschlagen. Bitte erneut starten.";
    }
    if (crawl && ACTIVE_CRAWL_STATUSES.has(crawl.status)) {
      const total = crawl.pagesDiscovered || crawl.maxPages;
      return `${crawl.pagesCrawled} von ${total} Seiten gecrawlt …${crawl.message ? ` ${crawl.message}` : ""}`;
    }
    if (!crawlInfo || crawlInfo.count === 0) {
      return config?.sitemap_url
        ? "Liest URLs aus der Sitemap (oder auto-entdeckt) und erfasst Titel, H1, Meta-Description und Textinhalt."
        : "Ohne Sitemap werden Sitemap und interne Links automatisch von der Website-URL entdeckt.";
    }
    const when = crawlInfo.lastCrawledAt
      ? new Date(crawlInfo.lastCrawledAt).toLocaleString("de-DE")
      : null;
    const textNote =
      crawlInfo.withTextCount > 0
        ? ` · ${crawlInfo.withTextCount} mit Textinhalt`
        : "";
    return `${crawlInfo.count} Seiten gespeichert${textNote}${when ? ` · zuletzt ${when}` : ""}.`;
  }

  const crawlViewerHref = `/dashboard/verwaltung/seo/crawl?org=${encodeURIComponent(props.organisationId)}`;
  const crawlActive = crawlInfo?.crawl && ACTIVE_CRAWL_STATUSES.has(crawlInfo.crawl.status);

  if (!config) {
    return <p className="text-sm text-sbkm-ink-600">Lade Einstellungen…</p>;
  }

  return (
    <DtGlassCard className="grid gap-4 p-5">
      <h2 className="text-lg font-bold text-sbkm-navy dark:text-white">SEO-Konfiguration</h2>
      {status ? <p className="text-sm text-sbkm-ink-600 dark:text-white/60">{status}</p> : null}

      {props.isPlatformAdmin ? (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={config.seo_enabled}
            disabled={!props.canEdit || busy}
            onCheckedChange={(v) => void save({ seoEnabled: v === true })}
          />
          SEO-Modus für diese Organisation aktivieren
        </label>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="dt-website">Website</Label>
          <Input
            id="dt-website"
            defaultValue={config.website_url ?? ""}
            disabled={!props.canEdit}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== (config.website_url ?? "")) void save({ websiteUrl: v || null });
            }}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="dt-sitemap">Sitemap-URL</Label>
          <Input
            id="dt-sitemap"
            defaultValue={config.sitemap_url ?? ""}
            disabled={!props.canEdit}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== (config.sitemap_url ?? "")) void save({ sitemapUrl: v || null });
            }}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="dt-focus">Fokus-Keyword</Label>
          <Input
            id="dt-focus"
            defaultValue={config.focus_keyword ?? ""}
            disabled={!props.canEdit}
            onBlur={(e) => void save({ focusKeyword: e.target.value.trim() || null })}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="dt-email">Report-E-Mail</Label>
          <Input
            id="dt-email"
            type="email"
            defaultValue={config.report_recipient_email ?? ""}
            disabled={!props.canEdit}
            onBlur={(e) => void save({ reportRecipientEmail: e.target.value.trim() || null })}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="dt-ga4">GA4 Property ID</Label>
          <Input
            id="dt-ga4"
            defaultValue={config.ga4_property_id ?? ""}
            disabled={!props.canEdit}
            onBlur={(e) => void save({ ga4PropertyId: e.target.value.trim() || null })}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="dt-gsc">GSC Site URL</Label>
          <Input
            id="dt-gsc"
            defaultValue={config.gsc_site_url ?? ""}
            disabled={!props.canEdit}
            onBlur={(e) => void save({ gscSiteUrl: e.target.value.trim() || null })}
          />
        </div>
        <div className="grid gap-1 sm:col-span-2">
          <Label htmlFor="dt-sistrix">Sistrix Domain</Label>
          <Input
            id="dt-sistrix"
            defaultValue={config.sistrix_domain ?? ""}
            disabled={!props.canEdit}
            onBlur={(e) => void save({ sistrixDomain: e.target.value.trim() || null })}
          />
        </div>
      </div>

      <div
        id="seo-checklist"
        className="grid scroll-mt-24 gap-3 border-t border-sbkm-navy/10 pt-4 dark:border-white/10"
      >
        <div>
          <p className="text-sm font-semibold text-sbkm-navy dark:text-white">SEO-Checkliste</p>
          <p className="mt-1 text-xs text-sbkm-ink-600 dark:text-white/55">
            Fließt in den SEO-Agent-Prompt ein — global für alle Orgs oder nur für diese Organisation.
          </p>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={config.seo_checklist_personalized}
            disabled={!props.canEdit || busy}
            onCheckedChange={(v) => void save({ seoChecklistPersonalized: v === true })}
          />
          <span>
            <span className="font-semibold text-sbkm-navy dark:text-white">
              Eigene Checkliste für diese Organisation
            </span>
            <span className="mt-0.5 block text-xs text-sbkm-ink-600 dark:text-white/55">
              {config.seo_checklist_personalized
                ? "Nur die Punkte unten gelten für diese Organisation."
                : "Es gilt die globale Plattform-Checkliste (unter Agenten → Globale Prompts)."}
            </span>
          </span>
        </label>

        {config.seo_checklist_personalized ? (
          <>
            <textarea
              value={checklistText}
              disabled={!props.canEdit || busy}
              onChange={(e) => setChecklistText(e.target.value)}
              rows={6}
              placeholder={"Meta-Titel pro Seite optimieren\nH1 enthält Fokus-Keyword\nInterne Verlinkung prüfen"}
              className="w-full resize-y rounded-xl border border-sbkm-navy/15 bg-white/80 px-3 py-2.5 text-sm text-sbkm-navy outline-none transition focus-visible:border-sbkm-mint/45 focus-visible:ring-2 focus-visible:ring-sbkm-mint/30 disabled:opacity-60 dark:border-white/15 dark:bg-white/5 dark:text-white"
            />
            {props.canEdit ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs tabular-nums text-sbkm-ink-500 dark:text-white/45">
                  {textToChecklist(checklistText).length}{" "}
                  {textToChecklist(checklistText).length === 1 ? "Punkt" : "Punkte"}
                </p>
                <DtPillButton
                  type="button"
                  disabled={
                    busy || checklistText === checklistToText(config.seo_checklist)
                  }
                  onClick={() => void save({ seoChecklist: textToChecklist(checklistText) })}
                >
                  Eigene Checkliste speichern
                </DtPillButton>
              </div>
            ) : null}
          </>
        ) : (
          <div className="rounded-xl border border-sbkm-navy/10 bg-white/40 p-3 dark:border-white/10 dark:bg-white/[0.03]">
            {globalChecklistText.trim() ? (
              <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-sbkm-navy dark:text-white/85">
                {globalChecklistText
                  .split("\n")
                  .map((line, i) => `${i + 1}. ${line}`)
                  .join("\n")}
              </pre>
            ) : (
              <p className="text-sm text-sbkm-ink-600 dark:text-white/55">
                Noch keine globale Checkliste hinterlegt.
              </p>
            )}
            {props.canEdit ? (
              <Link
                href={`/dashboard/verwaltung/agents?org=${encodeURIComponent(props.organisationId)}&view=prompts#global-seo-checklist`}
                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-sbkm-mint hover:underline"
              >
                Globale Checkliste bearbeiten
                <ExternalLink className="size-3" aria-hidden />
              </Link>
            ) : null}
          </div>
        )}
      </div>

      {props.canEdit ? (
        <div className="grid gap-2 border-t border-sbkm-navy/10 pt-4 dark:border-white/10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-sbkm-navy dark:text-white">Website crawlen</p>
              <p className="text-xs text-sbkm-ink-600 dark:text-white/55">{crawledHint()}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {crawlActive ? (
                <DtPillButton type="button" variant="outline" disabled={busy} onClick={() => void stopCrawl()}>
                  Stoppen
                </DtPillButton>
              ) : null}
              <DtPillButton
                type="button"
                disabled={busy || crawlActive || (!config.sitemap_url && !config.website_url)}
                onClick={() => void runCrawl()}
              >
                {crawlActive ? "Crawlt …" : busy ? "Startet …" : "Jetzt crawlen"}
              </DtPillButton>
            </div>
          </div>
          <p className="text-xs text-sbkm-ink-500 dark:text-white/45">
            Der Crawl läuft im Hintergrund und kann tausende Seiten erfassen. Pro Seite werden Titel, H1,
            Meta-Description und der vollständige Textinhalt gespeichert.
          </p>
          {crawlInfo && crawlInfo.count > 0 ? (
            <Link
              href={crawlViewerHref}
              className="inline-flex w-fit items-center gap-1.5 text-xs font-semibold text-sbkm-mint hover:underline"
            >
              Gecrawlte Inhalte ansehen ({crawlInfo.count} Seiten)
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </Link>
          ) : null}
        </div>
      ) : null}
    </DtGlassCard>
  );
}
