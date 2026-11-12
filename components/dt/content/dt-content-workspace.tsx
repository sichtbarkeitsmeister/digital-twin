"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Eraser, Loader2, RefreshCw, RotateCcw, Sparkles, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/components/dt/cn";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { DtSelect } from "@/components/dt/dt-select";
import { contentApi, contentQuery } from "@/components/dt/content/content-api";
import { DtContentBulkStepsPanel } from "@/components/dt/content/dt-content-bulk-steps-panel";
import { DtContentContactCard } from "@/components/dt/content/dt-content-contact-card";
import { DtContentOrgQuestionsCard } from "@/components/dt/content/dt-content-org-questions-card";
import { DtContentPageDrawer } from "@/components/dt/content/dt-content-page-drawer";
import { ZielgruppenBudgetWarning } from "@/components/dt/content/dt-content-zielgruppen-panel";
import { DtContentPagesSourceCard } from "@/components/dt/content/dt-content-pages-source-card";
import { DtContentPagesToolbar } from "@/components/dt/content/dt-content-pages-toolbar";
import {
  DtContentPagesTable,
  isContentPageSelectable,
} from "@/components/dt/content/dt-content-pages-table";
import { DtContentReadinessCard } from "@/components/dt/content/dt-content-readiness-card";
import { DtContentSettingsCard } from "@/components/dt/content/dt-content-settings-card";
import { DtContentTypePromptsCard } from "@/components/dt/content/dt-content-type-prompts-card";
import { DtContentWishesCard } from "@/components/dt/content/dt-content-wishes-card";
import { DtTexterPromptCard } from "@/components/dt/content/dt-texter-prompt-card";
import { CenteredModal } from "@/components/ui/centered-modal";
import { withZielgruppeLevel, zielgruppeLevel, type ContentZielgruppeLevel } from "@/lib/dt/content/zielgruppen";
import { defaultAvatarOptionId } from "@/lib/dt/agents/mix";
import type { ContentAvatarOption } from "@/lib/dt/content/load-sources";
import type { ContentTextSettings, ContentTextSettingsSuggestion } from "@/lib/dt/content/mapping";
import { CONTENT_PAGE_TYPE_LABELS, type ContentPageType } from "@/lib/dt/content/page-types";
import { CONTENT_STEP_COUNT } from "@/lib/dt/content/pipeline/steps";
import {
  EMPTY_CONTENT_PAGE_FILTER,
  anyContentPageRunning,
  contentBulkSkipStepsForPage,
  currentContentProblems,
  describeEmptyContentFilter,
  filterContentPages,
  formatContentDate,
  isContentPageFilterActive,
  type ContentBulkSteps,
  type ContentPageFilter,
} from "@/lib/dt/content/presentation";
import type {
  ContentClientPutBody,
  ContentClientPutResult,
  ContentLocalSources,
  ContentOverview,
  ContentPagePatchResult,
  ContentPageSummary,
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
  /** „Kundenwünsche“ of the organisation (`dt_content_settings.client_wishes`). */
  initialWishes: string;
}) {
  const { organisationId } = props;
  /** Bumped when the page source changed (crawl finished, pages taken over): the Kontaktdaten reload. */
  const [contactRefresh, setContactRefresh] = useState(0);
  /** Bumped after each overview load: pages that ran may have raised company questions. */
  const [orgQuestionsRefresh, setOrgQuestionsRefresh] = useState(0);

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
        : defaultAvatarOptionId(props.avatars)) ?? "",
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [starting, setStarting] = useState(false);
  const [resetting, setResetting] = useState<"reset" | "delete" | "all" | null>(null);
  /** Which bulk action waits for the person's confirmation in the modal; „all“ is the whole tool. */
  const [confirmBulk, setConfirmBulk] = useState<"reset" | "delete" | "all" | null>(null);
  /** „Zielgruppen festlegen“ for the ticked pages: the choice in the dialog (null = closed). */
  const [bulkZielgruppen, setBulkZielgruppen] = useState<{ primary: string[]; secondary: string[] } | null>(null);
  /** „Zielgruppen vorschlagen / festlegen“ running over the ticked pages: page n of total. */
  const [zielgruppenRun, setZielgruppenRun] = useState<{ done: number; total: number } | null>(null);
  /** „Schritte“ under the Standard-Zielgruppe: null = untouched, every page keeps its own setting. */
  const [bulkSteps, setBulkSteps] = useState<ContentBulkSteps | null>(null);
  /** The „Schritte“ choice being written to the ticked pages: page n of total. */
  const [stepsRun, setStepsRun] = useState<{ done: number; total: number } | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const [changingType, setChangingType] = useState<string | null>(null);
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
    setOrgQuestionsRefresh((n) => n + 1);
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

  const avatarOptions = useMemo(() => {
    const newestId = defaultAvatarOptionId(props.avatars);
    return props.avatars.map((a) => ({
      value: a.id,
      label: a.label,
      description: [a.isMix ? null : a.role, a.id === newestId ? "neuester" : formatContentDate(a.createdAt).slice(0, 10)]
        .filter(Boolean)
        .join(" · "),
    }));
  }, [props.avatars]);

  /** The Zielgruppen avatars (everything in the dropdown but the Mix), for „Zielgruppen je Seite“. */
  const zielgruppenOptions = useMemo(
    () => props.avatars.filter((a) => !a.isMix).map((a) => ({ id: a.id, name: a.name, role: a.role, chars: a.profileChars })),
    [props.avatars],
  );
  const zielgruppenNames = useMemo(() => new Map(zielgruppenOptions.map((o) => [o.id, o.name])), [zielgruppenOptions]);

  const pages = useMemo(() => overview?.pages ?? [], [overview]);
  const visible = useMemo(() => filterContentPages(pages, filter), [pages, filter]);
  const filterActive = isContentPageFilterActive(filter);
  const confirmedProblems = sync ? currentContentProblems(readiness, sync.result.problems) : [];
  const hiddenByFilter = pages.length > 0 && visible.length === 0;
  const emptyFilterCopy = hiddenByFilter ? describeEmptyContentFilter(filter, pages.length) : null;

  // Pages hidden by search or status filter leave the selection: bulk actions only hit what is visible.
  useEffect(() => {
    setSelected((prev) => {
      const allowed = new Set(visible.map((p) => p.slug));
      const next = new Set([...prev].filter((slug) => allowed.has(slug)));
      return next.size === prev.size ? prev : next;
    });
  }, [visible]);

  const selectedCount = selected.size;

  /**
   * „Blättern“ in the page window: through every page of the table as it is filtered (search,
   * status), in its order. Pages without a text are included; the status filter narrows it.
   */
  const pager = useMemo(() => {
    if (!openPage) return undefined;
    const list = visible;
    const index = list.findIndex((p) => p.slug === openPage.slug);
    if (index < 0) return undefined;
    const go = (to: number) => {
      const next = list[to];
      return next ? () => setOpenPage({ slug: next.slug, name: next.name }) : undefined;
    };
    return { position: index + 1, total: list.length, onPrev: go(index - 1), onNext: go(index + 1) };
  }, [openPage, visible]);

  /**
   * „Zielgruppen vorschlagen“ / „Zielgruppen festlegen“ for every ticked page, one request per page
   * (a suggestion is a short call each). A confirmed choice stays when only suggesting.
   */
  async function runZielgruppen(kind: "suggest" | "set", choice?: { primary: string[]; secondary: string[] }) {
    const slugs = [...selected];
    if (slugs.length === 0) return;
    setZielgruppenRun({ done: 0, total: slugs.length });
    const failed: string[] = [];
    for (const [i, slug] of slugs.entries()) {
      const base = `/api/dt/content/pages/${encodeURIComponent(slug)}`;
      const res =
        kind === "suggest"
          ? await contentApi(`${base}/zielgruppen`, { method: "POST", body: { organisationId, force: false } })
          : await contentApi(base, { method: "PATCH", body: { organisationId, zielgruppen: choice } });
      if (!res.ok) failed.push(`${pages.find((p) => p.slug === slug)?.name ?? slug}: ${res.message}`);
      setZielgruppenRun({ done: i + 1, total: slugs.length });
    }
    setZielgruppenRun(null);
    setBulkZielgruppen(null);
    void loadOverview();
    const ok = slugs.length - failed.length;
    if (ok > 0) toast.success(kind === "suggest" ? `Zielgruppen für ${ok} ${ok === 1 ? "Seite" : "Seiten"} vorgeschlagen` : `Zielgruppen für ${ok} ${ok === 1 ? "Seite" : "Seiten"} festgelegt`);
    if (failed.length > 0) toast.error(`Nicht geklappt: ${failed.join(" · ")}`, { duration: 15_000 });
  }

  /**
   * Writes the dashboard's „Schritte“ choice to the given pages (the same PATCH as the switches
   * in the page window, one request per page). Returns the pages that took it: a page that
   * refused must not start, it would run steps the editor switched off.
   */
  async function applyBulkSteps(slugs: string[], choice: ContentBulkSteps): Promise<string[]> {
    setStepsRun({ done: 0, total: slugs.length });
    const okSlugs: string[] = [];
    const failed: string[] = [];
    for (const [i, slug] of slugs.entries()) {
      const page = pages.find((p) => p.slug === slug);
      const res = await contentApi(`/api/dt/content/pages/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        body: {
          organisationId,
          skip_steps: page ? contentBulkSkipStepsForPage(page, choice.skip_steps) : choice.skip_steps,
          review_stop: choice.review_stop,
        },
      });
      if (res.ok) okSlugs.push(slug);
      else failed.push(`${page?.name ?? slug}: ${res.message}`);
      setStepsRun({ done: i + 1, total: slugs.length });
    }
    setStepsRun(null);
    if (failed.length > 0) toast.error(`Schritte nicht übernommen: ${failed.join(" · ")}`, { duration: 15_000 });
    return okSlugs;
  }

  /** „Jetzt anwenden“: the choice goes to the ticked pages without starting them. */
  async function applyBulkStepsNow() {
    if (!bulkSteps || selectedCount === 0 || stepsRun || starting) return;
    const done = await applyBulkSteps([...selected], bulkSteps);
    if (done.length > 0) toast.success(`Schritte für ${done.length} ${done.length === 1 ? "Seite" : "Seiten"} übernommen`);
    void loadOverview();
  }

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
      let slugs = [...selected];
      if (bulkSteps) {
        slugs = await applyBulkSteps(slugs, bulkSteps);
        if (slugs.length === 0) {
          void loadOverview();
          return;
        }
      }
      const res = await contentApi<ContentRunThroughResult>("/api/dt/content/run-through", {
        method: "POST",
        body: { organisationId, pages: slugs },
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

  /** „Seitentyp“ in the table row: the same PATCH as the drawer; the answer carries the fresh table. */
  async function changePageType(page: ContentPageSummary, pageType: ContentPageType) {
    setChangingType(page.slug);
    try {
      const res = await contentApi<ContentPagePatchResult>(`/api/dt/content/pages/${encodeURIComponent(page.slug)}`, {
        method: "PATCH",
        body: { organisationId, page_type: pageType },
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      applyOverview(res.data.overview);
      toast.success(`Seitentyp: ${CONTENT_PAGE_TYPE_LABELS[pageType]}`, { description: page.name });
    } finally {
      setChangingType(null);
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
        ? hiddenByFilter
          ? "Der Filter blendet alle Seiten aus. Unten „Filter zurücksetzen“, dann die Seiten anhaken."
          : filterActive
            ? "Seiten in der gefilterten Tabelle anhaken – nur angehakte Seiten bekommen Texte."
            : "Seiten in der Tabelle anhaken – nur angehakte Seiten bekommen Texte."
        : `Läuft im Hintergrund durch ${CONTENT_STEP_COUNT} Schritte. Die Seite meldet sich, wenn sie Sie braucht.`;

  return (
    <div className="grid gap-5">
      <DtContentSettingsCard
        suggestion={props.suggestion}
        confirmed={settings}
        editing={editingSettings}
        onConfirm={(next) => void confirmSettings(next)}
        onEdit={() => setEditingSettings(true)}
      />
      <DtContentWishesCard organisationId={organisationId} initial={props.initialWishes} settingsConfirmed={Boolean(settings)} />

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
          setFilter(EMPTY_CONTENT_PAGE_FILTER);
          setContactRefresh((n) => n + 1);
          void loadReadiness();
          void loadOverview();
        }}
      />
      <DtContentContactCard organisationId={organisationId} refreshKey={contactRefresh} />
      <DtContentOrgQuestionsCard organisationId={organisationId} refreshKey={orgQuestionsRefresh} />

      <section className={cn(cardClass, "grid gap-4 p-4 sm:p-5")} aria-label="Texte erstellen">
        <div className="grid gap-5 lg:grid-cols-[19rem_minmax(0,1fr)] lg:gap-0">
          <div className="grid content-start gap-2.5 lg:pr-6">
            <div className="grid gap-0.5">
              <h2 className="text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">Standard-Zielgruppe</h2>
              <p className="text-xs text-sbkm-ink-600 dark:text-white/60">Für Seiten ohne eigene Zielgruppen.</p>
            </div>
            <DtSelect
              srLabel="Standard-Zielgruppe (für Seiten ohne eigene)"
              value={avatarId}
              onValueChange={setAvatarId}
              options={avatarOptions}
              placeholder="Kein Avatar vorhanden"
              disabled={avatarOptions.length === 0}
              fullWidth
            />
          </div>
          <div className="border-t border-sbkm-navy/8 pt-4 dark:border-white/8 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <DtContentBulkStepsPanel
              value={bulkSteps}
              onChange={setBulkSteps}
              selectedCount={selectedCount}
              progress={stepsRun}
              disabled={starting}
              onApply={() => void applyBulkStepsNow()}
            />
          </div>
        </div>
        <div className="flex flex-col gap-4 border-t border-sbkm-navy/8 pt-4 dark:border-white/8 lg:flex-row lg:items-center lg:justify-between">
        {zielgruppenOptions.length > 0 ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-sbkm-navy dark:text-white">Zielgruppen der angehakten Seiten:</span>
            <DtPillButton
              type="button"
              size="sm"
              variant="outline"
              disabled={selectedCount === 0 || zielgruppenRun != null}
              onClick={() => void runZielgruppen("suggest")}
              title="Der Zwilling schlägt für jede angehakte Seite Zielgruppen vor (wenige Cent je Seite). Festgelegte bleiben."
            >
              <Sparkles className="size-3.5" aria-hidden />
              Vorschlagen ({selectedCount})
            </DtPillButton>
            <DtPillButton
              type="button"
              size="sm"
              variant="outline"
              disabled={selectedCount === 0 || zielgruppenRun != null}
              onClick={() => setBulkZielgruppen({ primary: [], secondary: [] })}
              title="Dieselben Zielgruppen für alle angehakten Seiten festlegen."
            >
              <Users className="size-3.5" aria-hidden />
              Festlegen ({selectedCount})
            </DtPillButton>
            {zielgruppenRun ? (
              <span className="inline-flex items-center gap-1 text-xs text-sky-700 dark:text-sky-300">
                <Loader2 className="size-3 animate-spin" aria-hidden />
                Seite {Math.min(zielgruppenRun.done + 1, zielgruppenRun.total)} von {zielgruppenRun.total} …
              </span>
            ) : (
              <span className="text-xs text-sbkm-ink-500 dark:text-white/45">
                Seiten ohne eigene Zielgruppen bekommen beim Start automatisch den Vorschlag des Zwillings.
              </span>
            )}
          </div>
        ) : null}
          <div className="flex shrink-0 flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3 lg:ml-auto">
            <p className="max-w-xs text-xs text-sbkm-ink-600 dark:text-white/55 sm:order-first lg:text-right">{startHint}</p>
            <DtPillButton
              type="button"
              className="h-11 shrink-0"
              disabled={selectedCount === 0 || starting || stepsRun != null || notReady || settingsOpen}
              onClick={() => void startTexts()}
            >
              {starting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
              Texte erstellen ({selectedCount})
            </DtPillButton>
          </div>
        </div>

        {confirmedProblems.length > 0 ? (
          <ul className="list-disc rounded-xl border border-orange-300/60 bg-orange-50 py-2 pl-7 pr-3 text-xs text-orange-900 dark:border-orange-400/30 dark:bg-orange-500/10 dark:text-orange-100">
            {confirmedProblems.map((p) => (
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
          ) : emptyFilterCopy ? (
            <div className="grid gap-2 rounded-dt border border-dashed border-sbkm-navy/15 px-4 py-8 text-center dark:border-white/15">
              <p className="text-sm font-semibold text-sbkm-navy dark:text-white">{emptyFilterCopy.title}</p>
              <p className="mx-auto max-w-md text-xs leading-relaxed text-sbkm-ink-600 dark:text-white/60">
                {emptyFilterCopy.detail}
              </p>
              <DtPillButton
                type="button"
                size="sm"
                variant="outline"
                className="mt-1 justify-self-center"
                onClick={() => setFilter(EMPTY_CONTENT_PAGE_FILTER)}
              >
                Filter zurücksetzen
              </DtPillButton>
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
              onTypeChange={(page, pageType) => void changePageType(page, pageType)}
              changingType={changingType}
              zielgruppenNames={zielgruppenNames}
            />
          )}
        </div>
      </section>

      <DtTexterPromptCard placement="texte" />
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
            ? "Alle Seiten dieser Organisation mit Texten, Schritten, Fragen und Kosten, die bestätigten Einstellungen und die hochgeladene Seitenstruktur werden gelöscht. Laufende Schritte werden gestoppt. Der Crawl der Website, die Kontaktdaten, Avatare und Anbieterfakten bleiben."
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
              {settings ? <li>Bestätigte Einstellungen für Texte (mit den Kundenwünschen)</li> : null}
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

      <CenteredModal
        open={bulkZielgruppen != null}
        onClose={() => {
          if (!zielgruppenRun) setBulkZielgruppen(null);
        }}
        closeDisabled={zielgruppenRun != null}
        titleId="content-bulk-zielgruppen-title"
        title={`Zielgruppen für ${selectedCount} ${selectedCount === 1 ? "Seite" : "Seiten"} festlegen`}
        description="Gilt für alle angehakten Seiten und ersetzt deren bisherige Zielgruppen. Primär: für sie wird geschrieben – bei Startseite, Hauptsilo-Seite und Ratgeberartikel ohne Obergrenze, bei allen anderen Seitentypen höchstens zwei (dort zählen weitere als sekundär). Sekundär: höchstens drei, werden mitbedient."
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <DtPillButton type="button" size="sm" variant="ghost" disabled={zielgruppenRun != null} onClick={() => setBulkZielgruppen(null)}>
              Abbrechen
            </DtPillButton>
            <DtPillButton
              type="button"
              size="sm"
              disabled={zielgruppenRun != null || !bulkZielgruppen || bulkZielgruppen.primary.length === 0}
              onClick={() => bulkZielgruppen && void runZielgruppen("set", bulkZielgruppen)}
            >
              {zielgruppenRun ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Für {selectedCount} {selectedCount === 1 ? "Seite" : "Seiten"} festlegen
            </DtPillButton>
          </div>
        }
      >
        <ul className="grid gap-2">
          {zielgruppenOptions.map((o) => {
            const level = bulkZielgruppen ? zielgruppeLevel(bulkZielgruppen, o.id) : "off";
            return (
              <li key={o.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0 text-sm text-sbkm-navy dark:text-white">
                  <span className="font-semibold">{o.name}</span>
                  {o.role ? <span className="block truncate text-xs text-sbkm-ink-500 dark:text-white/45">{o.role}</span> : null}
                </span>
                <div className="flex shrink-0 overflow-hidden rounded-pill border border-sbkm-navy/15 dark:border-white/15" role="group" aria-label={`Zielgruppe ${o.name}`}>
                  {(
                    [
                      ["primary", "Primär"],
                      ["secondary", "Sekundär"],
                      ["off", "Aus"],
                    ] as Array<[ContentZielgruppeLevel, string]>
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={level === value}
                      disabled={zielgruppenRun != null}
                      // No limit here: each page applies its own type's limit when it is saved.
                      onClick={() => setBulkZielgruppen((prev) => (prev ? withZielgruppeLevel(prev, o.id, value, null) : prev))}
                      className={cn(
                        "px-2.5 py-1 text-xs font-semibold transition-colors",
                        level === value
                          ? value === "primary"
                            ? "bg-emerald-600 text-white"
                            : value === "secondary"
                              ? "bg-sky-600 text-white"
                              : "bg-sbkm-navy/10 text-sbkm-navy dark:bg-white/15 dark:text-white"
                          : "bg-white text-sbkm-ink-600 hover:bg-sbkm-navy/5 dark:bg-transparent dark:text-white/60",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
        {bulkZielgruppen ? (
          <div className="mt-3">
            <ZielgruppenBudgetWarning primary={bulkZielgruppen.primary} secondary={bulkZielgruppen.secondary} options={zielgruppenOptions} />
          </div>
        ) : null}
      </CenteredModal>

      <DtContentPageDrawer
        organisationId={organisationId}
        page={openPage}
        open={openPage != null}
        onClose={() => setOpenPage(null)}
        onChanged={() => void loadOverview()}
        zielgruppenOptions={zielgruppenOptions}
        pager={pager}
      />
    </div>
  );
}
