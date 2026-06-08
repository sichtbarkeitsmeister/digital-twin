"use client";

import { useCallback, useEffect, useState } from "react";

import { DtPillButton } from "@/components/dt/dt-pill-button";
import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
};

export function DtSeoConfigForm(props: {
  organisationId: string;
  canEdit: boolean;
  isPlatformAdmin?: boolean;
}) {
  const [config, setConfig] = useState<Config | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/dt/org-config/${props.organisationId}`);
    const json = (await res.json()) as { ok?: boolean; config?: Config };
    if (json.ok && json.config) setConfig(json.config);
  }, [props.organisationId]);

  useEffect(() => {
    void load();
  }, [load]);

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
    if (json.config) setConfig(json.config);
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
    const json = (await res.json()) as { ok?: boolean; message?: string };
    setBusy(false);
    setStatus(json.ok ? (json.message ?? "Crawl abgeschlossen.") : (json.message ?? "Crawl fehlgeschlagen."));
  }

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

      {props.canEdit ? (
        <DtPillButton type="button" disabled={busy} onClick={() => void runCrawl()}>
          Sitemap crawlen
        </DtPillButton>
      ) : null}
    </DtGlassCard>
  );
}
