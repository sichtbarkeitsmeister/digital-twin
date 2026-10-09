"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Eraser, Loader2, RefreshCw, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/components/dt/cn";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { DtSelect } from "@/components/dt/dt-select";
import { contentApi, contentQuery } from "@/components/dt/content/content-api";
import { DtContentPageDrawer } from "@/components/dt/content/dt-content-page-drawer";
import { DtContentPagesSourceCard } from "@/components/dt/content/dt-content-pages-source-card";
import { DtContentPagesToolbar } from "@/components/dt/content/dt-content-pages-toolbar";
import {
  DtContentPagesTable,
  isContentPageSelectable,
} from "@/components/dt/content/dt-content-pages-table";
import { DtContentReadinessCard } from "@/components/dt/content/dt-content-readiness-card";
import { DtContentSettingsCard } from "@/components/dt/content/dt-content-settings-card";
import { DtContentTypePromptsCard } from "@/components/dt/content/dt-content-type-prompts-card";
import { CenteredModal } from "@/components/ui/centered-modal";
import type { ContentAvatarOption } from "@/lib/dt/content/load-sources";
import type { ContentTextSettings, ContentTextSettingsSuggestion } from "@/lib/dt/content/mapping";
import {
  EMPTY_CONTENT_PAGE_FILTER,
  anyContentPageRunning,
  filterContentPages,
  formatContentDate,
  isContentPageFilterActive,
  type ContentPageFilter,
} from "@/lib/dt/content/presentation";
import type {
  ContentClientPutBody,
  ContentClientPutResult,
  ContentLocalSources,
  ContentOverview,
  ContentReadiness,
  ContentReadinessResult,
  ContentResetResult,
  ContentReview,
  ContentRunThroughResult,
  ContentToolResetResult,
} from "@/lib/dt/content/types";

const POLL_MS = 10_000;

const cardClass =
  "relative overflow-hidden rounded-dt-lg border border-sbkm-navy/10 bg-white/55 shadow-dt backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.05]";

function SummaryChip(props: { value: string | number; label: string; tone?: "orange" }) {
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1.5 rounded-pill border px-3 py-1",
        props.tone === "orange"
          ? "border-orange-300/70 bg-orange-50 text-orange-900 dark:border-orange-400/30 dark:bg-orange-500/10 dark:text-orange-100"
          : "border-sbkm-navy/10 bg-white/60 text-sbkm-navy dark:border-white/10 dark:bg-white/[0.04] dark:text-white",
      )}
    >
      <span className="text-sm font-bold tabular-nums">{props.value}</span>
      <span className="text-xs opacity-75">{props.label}</span>
    </span>
  );
}

export function DtContentWorkspace(props: {
  organisationId: string;
  avatars: ContentAvatarOption[];
  suggestion: ContentTextSettingsSuggestion;
  /** Confirmed settings from `dt_content_settings`; null shows the settings card open. */
  initialSettings: ContentTextSettings | null;
  initialAvatarId: string | null;
}) {
  const { organisationId } = props;

  const [readiness, setReadiness] = useState<ContentReadiness | null>(null);
  const [local, setLocal] = useState<ContentLocalSources | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(true);
  const [readinessError, setReadinessError] = useState<string | null>(null);

  const [overview, setOverview] = useState<ContentOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  const [avatarId, setAvatarId] = useState(
    () =>
      (props.initialAvatarId && props.avatars.some((a) => a.id === props.initialAvatarId)
        ? props.initialAvatarId
        : props.avatars[0]?.id) ?? "",
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [starting, setStarting] = useState(false);
  const [resetting, setResetting] = useState<"reset" | "delete" | "all" | null>(null);
  /** Which bulk action waits for the person's confirmation in the modal; „all“ is the whole tool. */
  const [confirmBulk, setConfirmBulk] = useState<"reset" | "delete" | "all" | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const [settings, setSettings] = useState<ContentTextSettings | null>(props.initialSettings);
  const [editingSettings, setEditingSettings] = useState(false);
  const [sync, setSync] = useState<{ result: ContentClientPutResult; sent: ContentClientPutBody } | null>(null);
  const [openPage, setOpenPage] = useState<{ slug: string; name: string } | null>(null);
  const [filter, setFilter] = useState<ContentPageFilter>(EMPTY_CONTENT_PAGE_FILTER);

  const loadReadiness = useCallback(async () => {
    setReadinessLoading(true);
    const res = await contentApi<ContentReadinessResult>(
      `/api/dt/content/readiness?${contentQuery(organisationId)}`,
    );
    if (res.ok) {
      setReadiness(res.data.readiness);
      setLocal(res.data.local);
      setReadinessError(null);
    } else {
      setReadinessError(res.message);
    }
    setReadinessLoading(false);
  }, [organisationId]);

  const applyOverview = useCallback((next: ContentOverview) => {
    setOverview(next);
    setOverviewError(null);
    setRefreshedAt(new Date().toISOString());
    setSelected((prev) => {
      const allowed = new Set(next.pages.filter(isContentPageSelectable).map((p) => p.slug));
      const kept = new Set([...prev].filter((slug) => allowed.has(slug)));
      return kept.size === prev.size ? prev : kept;
    });
  }, []);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    const res = await contentApi<ContentOverview>(
      `/api/dt/content/overview?${contentQuery(organisationId)}`,
    );
    if (res.ok) {
      applyOverview(res.data);
    } else {
      setOverviewError(res.message);
    }
    setOverviewLoading(false);
  }, [organisationId, applyOverview]);

  useEffect(() => {
    void loadReadiness();
    void loadOverview();
  }, [loadReadiness, loadOverview]);

  const running = overview ? anyContentPageRunning(overview.pages) : false;

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadOverview();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, loadOverview]);

  const avatarOptions = useMemo(
    () =>
      props.avatars.map((a, index) => ({
        value: a.id,
        label: a.name,
        description: [a.role, index === 0 ? "neuester" : formatContentDate(a.createdAt).slice(0, 10)]
          .filter(Boolean)
          .join(" · "),
      })),
    [props.avatars],
  );

  const pages = useMemo(() => overview?.pages ?? [], [overview]);
  const visible = useMemo(() => filterContentPages(pages, filter), [pages, filter]);
  const filterActive = isContentPageFilterActive(filter);

  // Pages hidden by search or status filter leave the selection: bulk actions only hit what is visible.
  useEffect(() => {
    setSelected((prev) => {
      const allowed = new Set(visible.map((p) => p.slug));
      const next = new Set([...prev].filter((slug) => allowed.has(slug)));
      return next.size === prev.size ? prev : next;
    });
  }, [visible]);

  const selectedCount = selected.size;
  const notReady = readiness ? !readiness.ready : false;
  const settingsOpen = !settings || editingSettings;

  async function sendClientData(confirmed: ContentTextSettings): Promise<boolean> {
    const res = await contentApi<{ result: ContentClientPutResult; sent: ContentClientPutBody }>(
      "/api/dt/content/client",
      { method: "PUT", body: { organisationId, agentId: avatarId || null, settings: confirmed } },
    );
    if (!res.ok) {
      toast.error(res.message);
      return false;
    }
    setSync(res.data);
    if (res.data.result.problems.length > 0) {
      toast.warning("Einstellungen gespeichert, aber es fehlt noch etwas", {
        description: res.data.result.problems.join(" · "),
      });
    }
    return true;
  }

  async function confirmSettings(next: ContentTextSettings) {
    const previous = settings;
    setSettings(next);
    setEditingSettings(false);
    if (!(await sendClientData(next))) {
      setSettings(previous);
      setEditingSettings(true);
    }
  }

  async function startTexts() {
    if (!settings || settingsOpen || selectedCount === 0 || starting) return;
    setStarting(true);
    try {
      if (!(await sendClientData(settings))) return;
      const res = await contentApi<ContentRunThroughResult>("/api/dt/content/run-through", {
        method: "POST",
        body: { organisationId, pages: [...selected] },
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      announceRun(res.data);
    } finally {
      setStarting(false);
    }
  }

  /** „Stoppen“ in the table row: ends the job, the page pauses after its last finished step. */
  async function stopPage(slug: string) {
    setStopping(slug);
    try {
      const res = await contentApi<ContentReview>(`/api/dt/content/pages/${encodeURIComponent(slug)}/reset`, {
        method: "POST",
        body: { organisationId, mode: "stop" },
      });
      if (!res.ok) toast.error(res.message);
      else toast.success("Gestoppt – die Seite ist pausiert");
      await loadOverview();
    } finally {
      setStopping(null);
    }
  }

  /**
   * „Texte komplett zurücksetzen“: every page, open job, the settings and the uploaded
   * Seitenstruktur of this organisation go; the table is empty and the settings card opens again.
   */
  async function resetTool() {
    if (resetting) return;
    setResetting("all");
    try {
      const res = await contentApi<ContentToolResetResult>("/api/dt/content/reset-all", {
        method: "POST",
        body: { organisationId },
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const d = res.data;
      toast.success("Texte zurückgesetzt – bereit für einen neuen Start", {
        description: [
          `${d.pages} ${d.pages === 1 ? "Seite" : "Seiten"} gelöscht`,
          d.jobs > 0 ? `${d.jobs} laufende ${d.jobs === 1 ? "Schritt" : "Schritte"} gestoppt` : "",
          d.settings ? "Einstellungen verworfen" : "",
          d.structure ? "Seitenstruktur entfernt" : "",
        ]
          .filter(Boolean)
          .join(" · "),
      });
      setSelected(new Set());
      setFilter(EMPTY_CONTENT_PAGE_FILTER);
      setSync(null);
      setSettings(null);
      setEditingSettings(false);
      applyOverview(d.overview);
      setConfirmBulk(null);
      void loadReadiness();
    } finally {
      setResetting(null);
    }
  }

  /** „Auswahl zurücksetzen“ / „Auswahl löschen“ for the checked pages, after the modal was confirmed. */
  async function runBulk(modeKind: "reset" | "delete") {
    if (selectedCount === 0 || resetting) return;
    setResetting(modeKind);
    try {
      const res = await contentApi<ContentResetResult>("/api/dt/content/reset", {
        method: "POST",
        body: { organisationId, pages: [...selected], mode: modeKind },
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const done = `${res.data.affected} ${res.data.affected === 1 ? "Seite" : "Seiten"}`;
      toast.success(modeKind === "reset" ? `${done} zurückgesetzt` : `${done} gelöscht`, {
        description: res.data.skipped.length > 0 ? res.data.skipped.map((s) => `${s.page}: ${s.reason}`).join(" · ") : undefined,
      });
      setSelected(new Set());
      applyOverview(res.data.overview);
      setConfirmBulk(null);
    } finally {
      setResetting(null);
    }
  }

  function announceRun(data: ContentRunThroughResult) {
    const started = data.jobs.length;
    const head =
      started > 0
        ? `${started} ${started === 1 ? "Seite" : "Seiten"} gestartet`
        : "Keine Seite gestartet";
    toast.success(head, {
      description:
        data.skipped.length > 0
          ? data.skipped.map((s) => `${s.page}: ${s.reason}`).join(" · ")
          : undefined,
    });
    setSelected(new Set());
    void loadOverview();
  }

  const startHint = notReady
    ? "Erst alle drei Voraussetzungen erfüllen."
    : settingsOpen
      ? "Erst die Einstellungen für Texte bestätigen."
      : selectedCount === 0
        ? filterActive
          ? "Seiten in der gefilterten Tabelle anhaken – nur angehakte Seiten bekommen Texte."
          : "Seiten in der Tabelle anhaken – nur angehakte Seiten bekommen Texte."
        : "Läuft im Hintergrund durch acht Schritte. Die Seite meldet sich, wenn sie Sie braucht.";

  return (
    <div className="grid gap-5">
      <DtContentSettingsCard
        suggestion={props.suggestion}
        confirmed={settings}
        editing={editingSettings}
        onConfirm={(next) => void confirmSettings(next)}
        onEdit={() => setEditingSettings(true)}
      />

      <DtContentReadinessCard
        organisationId={organisationId}
        readiness={readiness}
        loading={readinessLoading}
        error={readinessError}
      />

      <DtContentPagesSourceCard
        organisationId={organisationId}
        local={local}
        loading={readinessLoading}
        onChanged={(next) => {
          if (next) applyOverview(next);
          void loadReadiness();
          void loadOverview();
        }}
      />

      <section className={cn(cardClass, "grid gap-4 p-4 sm:p-5")} aria-label="Texte erstellen">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <DtSelect
            label="Avatar"
            value={avatarId}
            onValueChange={setAvatarId}
            options={avatarOptions}
            placeholder="Kein Avatar vorhanden"
            disabled={avatarOptions.length === 0}
            className="sm:w-72"
            fullWidth
          />
          <div className="flex flex-col items-start gap-1.5 lg:items-end">
            <DtPillButton
              type="button"
              className="h-11"
              disabled={selectedCount === 0 || starting || notReady || settingsOpen}
              onClick={() => void startTexts()}
            >
              {starting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
              Texte erstellen ({selectedCount})
            </DtPillButton>
            <p className="max-w-md text-xs text-sbkm-ink-600 dark:text-white/55 lg:text-right">{startHint}</p>
          </div>
        </div>

        {sync && sync.result.problems.length > 0 ? (
          <ul className="list-disc rounded-xl border border-orange-300/60 bg-orange-50 py-2 pl-7 pr-3 text-xs text-orange-900 dark:border-orange-400/30 dark:bg-orange-500/10 dark:text-orange-100">
            {sync.result.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className={cardClass} aria-label="Seiten">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-sbkm-navy/8 px-4 py-3.5 dark:border-white/8 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-1 text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">Seiten</h2>
            {overview ? (
              <>
                {overview.needs_you > 0 ? (
                  <SummaryChip value={overview.needs_you} label="brauchen Sie" tone="orange" />
                ) : null}
                <SummaryChip value={overview.finished} label="fertig" />
                {overview.running > 0 ? <SummaryChip value={overview.running} label="laufen" /> : null}
                <SummaryChip value={overview.cost} label="Kosten gesamt" />
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-sbkm-ink-500 dark:text-white/45">
            <DtPillButton
              type="button"
              size="sm"
              variant="outline"
              disabled={selectedCount === 0 || resetting != null}
              onClick={() => setConfirmBulk("reset")}
              className="h-8 px-3 text-xs"
              title="Die angehakten Seiten komplett zurücksetzen (Text, Schritte, Fragen, Kosten)"
            >
              <RotateCcw className="size-3.5" aria-hidden />
              Auswahl zurücksetzen{selectedCount > 0 ? ` (${selectedCount})` : ""}
            </DtPillButton>
            <DtPillButton
              type="button"
              size="sm"
              variant="outline"
              disabled={selectedCount === 0 || resetting != null}
              onClick={() => setConfirmBulk("delete")}
              className="h-8 px-3 text-xs text-red-700 shadow-[inset_0_0_0_1.5px_#b91c1c] hover:bg-red-700 hover:text-white dark:text-red-300 dark:shadow-[inset_0_0_0_1.5px_rgba(252,165,165,0.6)] dark:hover:bg-red-700 dark:hover:text-white"
              title="Die angehakten Seiten aus der Tabelle entfernen"
            >
              <Trash2 className="size-3.5" aria-hidden />
              Auswahl löschen{selectedCount > 0 ? ` (${selectedCount})` : ""}
            </DtPillButton>
            <DtPillButton
              type="button"
              size="sm"
              variant="ghost"
              disabled={resetting != null}
              onClick={() => setConfirmBulk("all")}
              className="h-8 px-3 text-xs text-red-700 dark:text-red-300"
              title="Texte für diese Organisation komplett leeren: alle Seiten, Einstellungen und die hochgeladene Seitenstruktur"
            >
              <Eraser className="size-3.5" aria-hidden />
              Alles zurücksetzen
            </DtPillButton>
            {running ? <span>Aktualisiert sich automatisch</span> : null}
            <button
              type="button"
              onClick={() => void loadOverview()}
              disabled={overviewLoading}
              className="inline-flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-sbkm-navy/[0.06] hover:text-sbkm-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 disabled:opacity-50 dark:hover:bg-white/10 dark:hover:text-white"
              aria-label="Neu laden"
              title={refreshedAt ? `Zuletzt geladen: ${formatContentDate(refreshedAt)}` : "Neu laden"}
            >
              <RefreshCw className={cn("size-3.5", overviewLoading && "animate-spin")} aria-hidden />
            </button>
          </div>
        </header>
        {pages.length > 0 ? (
          <DtContentPagesToolbar pages={pages} visibleCount={visible.length} filter={filter} onChange={setFilter} />
        ) : null}
        <div className="p-2 sm:p-3">
          {overviewError ? (
            <p className="px-2 py-3 text-sm text-red-700 dark:text-red-300">{overviewError}</p>
          ) : !overview && overviewLoading ? (
            <div className="grid gap-2 p-2">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="h-11 animate-pulse rounded-lg bg-sbkm-navy/[0.05] dark:bg-white/[0.05]" />
              ))}
            </div>
          ) : pages.length > 0 && visible.length === 0 ? (
            <div className="grid gap-2 rounded-dt border border-dashed border-sbkm-navy/15 px-4 py-8 text-center dark:border-white/15">
              <p className="text-sm font-semibold text-sbkm-navy dark:text-white">Keine Seite passt zu Suche und Filter</p>
              <button
                type="button"
                onClick={() => setFilter(EMPTY_CONTENT_PAGE_FILTER)}
                className="mx-auto w-fit text-xs font-semibold text-sbkm-navy underline-offset-2 hover:underline dark:text-sbkm-mint"
              >
                Filter zurücksetzen
              </button>
            </div>
          ) : (
            <DtContentPagesTable
              pages={visible}
              selected={selected}
              onToggle={(slug) =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (next.has(slug)) next.delete(slug);
                  else next.add(slug);
                  return next;
                })
              }
              onToggleAll={(checked) =>
                setSelected(
                  checked ? new Set(visible.filter(isContentPageSelectable).map((p) => p.slug)) : new Set(),
                )
              }
              onOpen={(page) => setOpenPage({ slug: page.slug, name: page.name })}
              onStop={(page) => void stopPage(page.slug)}
              stopping={stopping}
            />
          )}
        </div>
      </section>

      <DtContentTypePromptsCard />

      <CenteredModal
        open={confirmBulk != null}
        onClose={() => {
          if (!resetting) setConfirmBulk(null);
        }}
        closeDisabled={resetting != null}
        titleId="content-bulk-confirm-title"
        title={
          confirmBulk === "all"
            ? "Texte komplett zurücksetzen?"
            : confirmBulk === "delete"
              ? `${selectedCount} ${selectedCount === 1 ? "Seite" : "Seiten"} löschen?`
              : `${selectedCount} ${selectedCount === 1 ? "Seite" : "Seiten"} zurücksetzen?`
        }
        description={
          confirmBulk === "all"
            ? "Alle Seiten dieser Organisation mit Texten, Schritten, Fragen und Kosten, die bestätigten Einstellungen und die hochgeladene Seitenstruktur werden gelöscht. Laufende Schritte werden gestoppt. Der Crawl der Website, Avatare und Anbieterfakten bleiben."
            : confirmBulk === "delete"
              ? "Die Seiten verschwinden aus der Tabelle – mit Text, Schritten und Fragen. Laufende Schritte werden gestoppt."
              : "Text, Schritte, Fragen und Anmerkungen gehen verloren; die Seiten bleiben in der Tabelle. Laufende Schritte werden gestoppt."
        }
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <DtPillButton type="button" size="sm" variant="ghost" disabled={resetting != null} onClick={() => setConfirmBulk(null)}>
              Abbrechen
            </DtPillButton>
            <DtPillButton
              type="button"
              size="sm"
              variant={confirmBulk === "delete" || confirmBulk === "all" ? "navy" : "mint"}
              className={confirmBulk === "delete" || confirmBulk === "all" ? "bg-red-600 text-white hover:bg-red-700 dark:hover:bg-red-700 dark:hover:text-white" : undefined}
              disabled={resetting != null || (confirmBulk !== "all" && selectedCount === 0)}
              onClick={() => {
                if (confirmBulk === "all") void resetTool();
                else if (confirmBulk) void runBulk(confirmBulk);
              }}
            >
              {resetting ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : confirmBulk === "all" ? (
                <Eraser className="size-3.5" aria-hidden />
              ) : confirmBulk === "delete" ? (
                <Trash2 className="size-3.5" aria-hidden />
              ) : (
                <RotateCcw className="size-3.5" aria-hidden />
              )}
              {confirmBulk === "all" ? "Alles löschen" : confirmBulk === "delete" ? "Endgültig löschen" : "Zurücksetzen"}
            </DtPillButton>
          </div>
        }
      >
        <ul className="grid gap-1 text-sm text-sbkm-navy dark:text-white">
          {confirmBulk === "all" ? (
            <>
              <li>{pages.length} {pages.length === 1 ? "Seite" : "Seiten"} in der Tabelle</li>
              {settings ? <li>Bestätigte Einstellungen für Texte</li> : null}
              {local?.structure ? <li>Seitenstruktur „{local.structure.filename?.trim() || "ohne Dateiname"}“</li> : null}
            </>
          ) : null}
          {(confirmBulk === "all" ? [] : pages)
            .filter((p) => selected.has(p.slug))
            .slice(0, 8)
            .map((p) => (
              <li key={p.slug} className="flex items-baseline gap-2">
                <span className="font-semibold">{p.name}</span>
                {p.source_url || p.path ? (
                  <span className="truncate font-mono text-[11px] text-sbkm-ink-500 dark:text-white/45">{p.source_url ?? p.path}</span>
                ) : null}
              </li>
            ))}
          {confirmBulk !== "all" && selectedCount > 8 ? (
            <li className="text-xs text-sbkm-ink-500 dark:text-white/45">… und {selectedCount - 8} weitere</li>
          ) : null}
        </ul>
      </CenteredModal>

      <DtContentPageDrawer
        organisationId={organisationId}
        page={openPage}
        open={openPage != null}
        onClose={() => setOpenPage(null)}
        onChanged={() => void loadOverview()}
      />
    </div>
  );
}
