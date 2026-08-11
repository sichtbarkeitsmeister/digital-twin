"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LayoutGroup } from "framer-motion";
import { FileSearch, Plus, Users } from "lucide-react";
import { toast } from "sonner";

import { DtAgentEditRequestModal } from "@/components/dt/agents/dt-agent-edit-request-modal";
import {
  DtAgentEditRequestsPanel,
  DtAgentsReadOnlyBanner,
} from "@/components/dt/agents/dt-agent-edit-requests-panel";
import {
  DtAgentListItem,
  agentFormValuesFromRow,
  type DtAgentListItemRow,
} from "@/components/dt/agents/dt-agent-list-item";
import { DtAgentCreateWizard } from "@/components/dt/agents/dt-agent-create-wizard";
import { DtAgentsSidebar } from "@/components/dt/agents/dt-agents-sidebar";
import { quickActionsFromForm } from "@/components/dt/agents/dt-agent-form-fields";
import { DtGlobalPromptsPanel } from "@/components/dt/agents/dt-global-prompts-panel";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtTabs } from "@/components/dt/dt-tabs";
import type { DtAgentEditRequestRow } from "@/lib/dt/agent-edit-requests";
import { filterAgentsHiddenFromOrgMembers } from "@/lib/dt/agents/seo-advisor";
import { isProtectedSeoAdvisorAgent } from "@/lib/dt/delete-agent-policy";
import { checklistToText } from "@/lib/dt/seo/seo-checklist";
import { readSelectedOrganisationId } from "@/lib/shared/selected-organisation-storage";
import { cn } from "@/components/dt/cn";

type AgentRow = DtAgentListItemRow;

type GlobalPrompts = {
  default: string;
  seo_advisor: string;
  survey_to_agent: string;
  survey_refine_agent: string;
};

type PageView = "agents" | "prompts";

function isProtectedAlwaysOn(agent: AgentRow): boolean {
  return isProtectedSeoAdvisorAgent(agent);
}

function globalPromptForAgent(agent: AgentRow, prompts: GlobalPrompts): string {
  if (agent.slug === "seo_advisor" || agent.kind === "seo_advisor") {
    return prompts.seo_advisor;
  }
  return prompts.default;
}

const SKELETON_ROW_COUNT = 6;
const SKELETON_ROW_HEIGHT_PX = 72;

function AgentsSkeleton() {
  return (
    <DtGlassCard variant="subtle" padding="none" className="overflow-hidden" aria-hidden>
      {Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "animate-pulse bg-white/20 dark:bg-white/[0.02]",
            i < SKELETON_ROW_COUNT - 1 && "border-b border-sbkm-navy/5 dark:border-white/5",
          )}
          style={{ height: SKELETON_ROW_HEIGHT_PX }}
        />
      ))}
    </DtGlassCard>
  );
}

function AgentsListSkeleton() {
  return (
    <div
      className="grid gap-4"
      style={{ minHeight: SKELETON_ROW_COUNT * SKELETON_ROW_HEIGHT_PX }}
      aria-hidden
    >
      <AgentsSkeleton />
    </div>
  );
}

function AgentsSidebarSkeleton() {
  return (
    <aside className="grid gap-4" aria-hidden>
      <div className="h-[148px] animate-pulse rounded-dt-lg bg-sbkm-navy/[0.04] dark:bg-white/[0.03]" />
      <div className="h-[132px] animate-pulse rounded-dt-lg bg-sbkm-navy/[0.04] dark:bg-white/[0.03]" />
    </aside>
  );
}

export function DtAgentsManager(props: {
  organisations: Array<{ id: string; name: string }>;
  initialOrgId: string;
  initialCanDirectlyEdit?: boolean;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [orgId, setOrgId] = useState(props.initialOrgId);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [canDirectlyEdit, setCanDirectlyEdit] = useState(
    props.initialCanDirectlyEdit ?? false,
  );
  const [editRequests, setEditRequests] = useState<DtAgentEditRequestRow[]>([]);
  const [requestAgent, setRequestAgent] = useState<AgentRow | null>(null);
  const [pageView, setPageView] = useState<PageView>(() =>
    searchParams.get("view") === "prompts" ? "prompts" : "agents",
  );

  useEffect(() => {
    const fromUrl = searchParams.get("org");
    if (
      fromUrl &&
      props.organisations.some((organisation) => organisation.id === fromUrl)
    ) {
      setOrgId(fromUrl);
      setEditingId(null);
      setInitialLoading(true);
      return;
    }

    const stored = readSelectedOrganisationId();
    if (stored && props.organisations.some((organisation) => organisation.id === stored)) {
      setOrgId(stored);
      setInitialLoading(true);
    }
  }, [searchParams, props.organisations]);

  useEffect(() => {
    if (searchParams.get("view") === "prompts") {
      setPageView("prompts");
    }
  }, [searchParams]);

  const [createWizardOpen, setCreateWizardOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState(agentFormValuesFromRow({
    name: "",
    role: null,
    prompt_template: "",
    prompt_append: null,
    uses_global_prompt: false,
    quick_actions: [],
    is_enabled: true,
    position: 0,
  }));
  const [busy, setBusy] = useState(false);
  const [globalPrompts, setGlobalPrompts] = useState<GlobalPrompts>({
    default: "",
    seo_advisor: "",
    survey_to_agent: "",
    survey_refine_agent: "",
  });

  // Keep Survey-KI focus in sync when opening an agent from deep links.
  useEffect(() => {
    const agentFromUrl = searchParams.get("agent");
    if (!agentFromUrl) return;
    if (editingId === agentFromUrl) return;
    const row = agents.find((a) => a.id === agentFromUrl);
    if (!row) return;
    setEditingId(row.id);
    setEditValues(agentFormValuesFromRow(row));
    setPageView("agents");
  }, [searchParams, agents, editingId]);

  const [globalPromptDraft, setGlobalPromptDraft] = useState<GlobalPrompts>({
    default: "",
    seo_advisor: "",
    survey_to_agent: "",
    survey_refine_agent: "",
  });
  const [globalChecklist, setGlobalChecklist] = useState("");
  const [globalChecklistDraft, setGlobalChecklistDraft] = useState("");

  const orgName =
    props.organisations.find((o) => o.id === orgId)?.name ?? "Organisation";

  const pendingByAgentId = useMemo(() => {
    const map = new Map<string, DtAgentEditRequestRow>();
    for (const r of editRequests) {
      if (r.status === "pending") map.set(r.agent_id, r);
    }
    return map;
  }, [editRequests]);

  const agentsById = useMemo(
    () => new Map(agents.map((a) => [a.id, { name: a.name }])),
    [agents],
  );

  const editingAgent = useMemo(
    () => agents.find((a) => a.id === editingId) ?? null,
    [agents, editingId],
  );

  const pageTabs = useMemo(
    () => [
      { id: "agents", label: "Agenten" },
      { id: "prompts", label: "Globale Prompts" },
    ],
    [],
  );

  const refreshRequests = useCallback(async () => {
    if (!orgId) return;
    const res = await fetch(`/api/dt/agents/edit-requests?org=${encodeURIComponent(orgId)}`);
    const json = (await res.json()) as { ok?: boolean; requests?: DtAgentEditRequestRow[] };
    if (json.ok && json.requests) setEditRequests(json.requests);
  }, [orgId]);

  const refresh = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setInitialLoading(true);

    const [manageRes, globalRes, checklistRes] = await Promise.all([
      fetch(`/api/dt/agents/manage?org=${encodeURIComponent(orgId)}`),
      fetch("/api/dt/agents/default-prompt"),
      fetch("/api/dt/platform-settings/seo-checklist"),
      refreshRequests(),
    ]);

    const manageJson = (await manageRes.json()) as {
      ok?: boolean;
      agents?: AgentRow[];
      canDirectlyEdit?: boolean;
    };
    if (manageJson.ok && manageJson.agents) {
      const nextAgents = manageJson.canDirectlyEdit
        ? manageJson.agents
        : filterAgentsHiddenFromOrgMembers(manageJson.agents);
      setAgents(nextAgents);
    }
    if (manageJson.ok) setCanDirectlyEdit(Boolean(manageJson.canDirectlyEdit));

    const globalJson = (await globalRes.json()) as {
      ok?: boolean;
      prompts?: Partial<GlobalPrompts>;
    };
    if (globalJson.ok && globalJson.prompts) {
      const next: GlobalPrompts = {
        default: globalJson.prompts.default ?? "",
        seo_advisor: globalJson.prompts.seo_advisor ?? "",
        survey_to_agent: globalJson.prompts.survey_to_agent ?? "",
        survey_refine_agent: globalJson.prompts.survey_refine_agent ?? "",
      };
      setGlobalPrompts(next);
      setGlobalPromptDraft(next);
    }

    const checklistJson = (await checklistRes.json()) as {
      ok?: boolean;
      checklist?: unknown;
    };
    if (checklistJson.ok) {
      const text = checklistToText(checklistJson.checklist);
      setGlobalChecklist(text);
      setGlobalChecklistDraft(text);
    }

    if (silent) setRefreshing(false);
    else setInitialLoading(false);
  }, [orgId, refreshRequests]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function writeAgentQuery(agentId: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (agentId) params.set("agent", agentId);
    else params.delete("agent");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function startEdit(agent: AgentRow) {
    setEditingId(agent.id);
    setEditValues(agentFormValuesFromRow(agent));
    setPageView("agents");
    writeAgentQuery(agent.id);
  }

  function cancelEdit() {
    setEditingId(null);
    writeAgentQuery(null);
  }

  async function deleteAgentChats(
    agent: AgentRow,
    opts?: { quiet?: boolean },
  ): Promise<{ ok: boolean; deletedCount: number }> {
    const res = await fetch("/api/dt/chats/bulk-delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organisationId: orgId, agentId: agent.id }),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      message?: string;
      deletedCount?: number;
    };
    if (!json.ok) {
      toast.error(json.message ?? "Chats des Agenten konnten nicht gelöscht werden.");
      return { ok: false, deletedCount: 0 };
    }
    const deletedCount = json.deletedCount ?? 0;
    if (!opts?.quiet && deletedCount > 0) {
      toast.success(
        `${deletedCount} Chat${deletedCount === 1 ? "" : "s"} von „${agent.name}" gelöscht.`,
      );
    }
    return { ok: true, deletedCount };
  }

  async function clearAgentChats(agent: AgentRow) {
    if (
      !window.confirm(
        `Alle Chats von „${agent.name}" wirklich löschen? Andere Agenten bleiben unberührt.`,
      )
    ) {
      return;
    }
    setBusy(true);
    await deleteAgentChats(agent);
    setBusy(false);
  }

  async function deleteAgent(agent: AgentRow) {
    if (isProtectedAlwaysOn(agent)) {
      toast.error("Der SEO-Berater kann nicht entfernt werden.");
      return;
    }
    const enabledCountLocal = agents.filter((a) => a.is_enabled).length;
    if (agent.is_enabled && enabledCountLocal <= 1) {
      toast.error("Mindestens ein aktiver Agent muss bleiben.");
      return;
    }
    if (
      !window.confirm(
        `Agent „${agent.name}" wirklich entfernen? Zugehörige Chats werden mitgelöscht.`,
      )
    ) {
      return;
    }
    setBusy(true);
    const chatsCleared = await deleteAgentChats(agent, { quiet: true });
    if (!chatsCleared.ok) {
      setBusy(false);
      return;
    }
    const res = await fetch(`/api/dt/agents/${agent.id}`, { method: "DELETE" });
    const json = (await res.json()) as { ok?: boolean; message?: string };
    setBusy(false);
    if (!json.ok) {
      toast.error(json.message ?? "Löschen fehlgeschlagen.");
      return;
    }
    toast.success(
      chatsCleared.deletedCount > 0
        ? `Agent „${agent.name}" und ${chatsCleared.deletedCount} Chat${chatsCleared.deletedCount === 1 ? "" : "s"} entfernt.`
        : `Agent „${agent.name}" entfernt.`,
    );
    if (editingId === agent.id) {
      setEditingId(null);
      writeAgentQuery(null);
    }
    await refresh(true);
  }

  async function saveEdit() {
    if (!editingId) return;
    setBusy(true);
    const body: Record<string, unknown> = {
      name: editValues.name,
      role: editValues.role || null,
      promptAppend: editValues.promptAppend.trim() || null,
      quickActions: quickActionsFromForm(editValues.quick),
      isEnabled: editValues.enabled,
      position: editValues.position,
    };
    if (editingAgent?.is_default) {
      body.usesGlobalPrompt = editValues.usesGlobalPrompt;
      if (!editValues.usesGlobalPrompt) {
        body.promptTemplate = editValues.prompt;
      }
    } else {
      body.promptTemplate = editValues.prompt;
    }
    const res = await fetch(`/api/dt/agents/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok?: boolean; message?: string };
    setBusy(false);
    if (!json.ok) {
      toast.error(json.message ?? "Speichern fehlgeschlagen.");
      return;
    }
    setEditingId(null);
    writeAgentQuery(null);
    toast.success("Agent gespeichert.");
    await refresh(true);
  }

  async function toggleEnabled(agent: AgentRow, next: boolean) {
    setBusy(true);
    const res = await fetch(`/api/dt/agents/${agent.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isEnabled: next }),
    });
    const json = (await res.json()) as { ok?: boolean; message?: string };
    setBusy(false);
    if (!json.ok) {
      toast.error(json.message ?? "Status konnte nicht geändert werden.");
      return;
    }
    await refresh(true);
  }

  async function saveGlobalPrompt(slug: keyof GlobalPrompts) {
    setBusy(true);
    const res = await fetch("/api/dt/agents/default-prompt", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, prompt: globalPromptDraft[slug] }),
    });
    const json = (await res.json()) as { ok?: boolean; message?: string };
    setBusy(false);
    if (!json.ok) {
      toast.error(json.message ?? "Globaler Prompt konnte nicht gespeichert werden.");
      return;
    }
    setGlobalPrompts((prev) => ({ ...prev, [slug]: globalPromptDraft[slug] }));
    toast.success("Globaler Prompt übernommen — gilt ab sofort für alle Organisationen.");
  }

  async function saveGlobalChecklist() {
    setBusy(true);
    const res = await fetch("/api/dt/platform-settings/seo-checklist", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        checklist: globalChecklistDraft
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      }),
    });
    const json = (await res.json()) as { ok?: boolean; message?: string };
    setBusy(false);
    if (!json.ok) {
      toast.error(json.message ?? "Globale Checkliste konnte nicht gespeichert werden.");
      return;
    }
    setGlobalChecklist(globalChecklistDraft);
    toast.success("Globale SEO-Checkliste gespeichert.");
  }

  async function cancelRequest(requestId: string) {
    setBusy(true);
    const res = await fetch(`/api/dt/agents/edit-requests/${requestId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });
    const json = (await res.json()) as { ok?: boolean; message?: string };
    setBusy(false);
    if (!json.ok) {
      toast.error(json.message ?? "Zurückziehen fehlgeschlagen.");
      return;
    }
    await refresh(true);
  }

  const canDisableAgent = (agent: AgentRow) =>
    !agent.is_enabled || agents.filter((a) => a.is_enabled).length > 1;

  const contextHref = `/dashboard/verwaltung/agent-kontext?org=${encodeURIComponent(orgId)}${editingId ? `&agent=${encodeURIComponent(editingId)}` : agents[0] ? `&agent=${encodeURIComponent(agents[0].id)}` : ""}`;

  const showAdminChrome =
    canDirectlyEdit || (initialLoading && (props.initialCanDirectlyEdit ?? false));

  const agentsMainContent = (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
      <section className="grid min-w-0 gap-4">
        <div className="relative">
          {initialLoading ? (
            <AgentsListSkeleton />
          ) : agents.length === 0 ? (
            <DtGlassCard
              variant="subtle"
              className="flex min-h-[288px] flex-col items-center justify-center gap-3 py-12 text-center"
            >
              <div className="flex size-12 items-center justify-center rounded-xl bg-sbkm-mint/15 text-sbkm-navy dark:text-sbkm-mint">
                <Users className="size-6" aria-hidden />
              </div>
              <p className="font-semibold tracking-tight text-sbkm-navy dark:text-white">
                Noch keine Agenten
              </p>
              <p className="max-w-sm text-sm text-sbkm-ink-600 dark:text-white/55">
                {canDirectlyEdit
                  ? "Erstelle einen neuen Agenten über „Neuer Agent“."
                  : "Agenten werden bei der Organisation automatisch angelegt."}
              </p>
              {canDirectlyEdit ? (
                <DtPillButton
                  type="button"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setCreateWizardOpen(true)}
                >
                  <Plus className="size-4" aria-hidden />
                  Neuer Agent
                </DtPillButton>
              ) : null}
            </DtGlassCard>
          ) : (
            <DtGlassCard
              variant="subtle"
              padding="none"
              className={cn(
                "relative overflow-hidden transition-opacity duration-150",
                refreshing && "opacity-60",
              )}
            >
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent dark:via-white/10" />
              <LayoutGroup id="agents-list">
                {agents.map((agent, i) => (
                <DtAgentListItem
                  key={agent.id}
                  agent={agent}
                  index={i}
                  compact
                  isLast={i === agents.length - 1}
                  busy={busy || refreshing}
                  canDirectlyEdit={canDirectlyEdit}
                  pendingReview={Boolean(pendingByAgentId.get(agent.id))}
                  isEditing={editingId === agent.id}
                  editValues={editValues}
                  onEditValuesChange={(patch) => setEditValues((v) => ({ ...v, ...patch }))}
                  onStartEdit={() => startEdit(agent)}
                  onSaveEdit={() => void saveEdit()}
                  onCancelEdit={cancelEdit}
                  onToggleEnabled={(next) => void toggleEnabled(agent, next)}
                  onDeleteChats={
                    canDirectlyEdit ? () => void clearAgentChats(agent) : undefined
                  }
                  onDelete={() => void deleteAgent(agent)}
                  onSourceSaved={(source) => {
                    setAgents((prev) =>
                      prev.map((a) =>
                        a.id === agent.id
                          ? {
                              ...a,
                              source_survey_id: source.sourceSurveyId,
                              source_survey_response_id: source.sourceSurveyResponseId,
                            }
                          : a,
                      ),
                    );
                    toast.success("Fragebogen-Herkunft gespeichert.");
                  }}
                  onRequestChange={() => setRequestAgent(agent)}
                  canDisable={canDisableAgent(agent)}
                  alwaysOn={isProtectedAlwaysOn(agent)}
                  globalPromptPreview={
                    agent.is_default
                      ? globalPromptForAgent(agent, globalPrompts)
                      : undefined
                  }
                />
                ))}
              </LayoutGroup>
            </DtGlassCard>
          )}

          {refreshing ? (
            <div
              className="pointer-events-none absolute inset-0 z-10 rounded-dt-lg"
              aria-hidden
            />
          ) : null}
        </div>

        {showAdminChrome ? (
          <div className="grid gap-2 lg:hidden">
            {initialLoading ? (
              <AgentsSidebarSkeleton />
            ) : (
              <DtAgentsSidebar
                busy={busy}
                onCreateAgent={() => setCreateWizardOpen(true)}
                onOpenGlobalPrompts={() => setPageView("prompts")}
              />
            )}
          </div>
        ) : null}
      </section>

      {showAdminChrome ? (
        <div className="hidden lg:block">
          {initialLoading ? (
            <AgentsSidebarSkeleton />
          ) : (
            <DtAgentsSidebar
              busy={busy}
              onCreateAgent={() => setCreateWizardOpen(true)}
              onOpenGlobalPrompts={() => setPageView("prompts")}
            />
          )}
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <header className="grid gap-4 border-b border-sbkm-navy/8 pb-6 dark:border-white/8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="grid gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-sbkm-ink-500 dark:text-white/40">
              {orgName}
            </p>
            <h1 className="text-2xl font-bold tracking-tight text-sbkm-navy dark:text-white">
              Agenten
            </h1>
            {!canDirectlyEdit ? (
              <p className="max-w-xl text-sm text-sbkm-ink-600 dark:text-white/60">
                {initialLoading ? (
                  <span className="inline-block h-4 w-full max-w-md animate-pulse rounded bg-sbkm-navy/10 dark:bg-white/10" />
                ) : (
                  "Übersicht der verfügbaren Agenten. Änderungen als Anfrage einreichen."
                )}
              </p>
            ) : null}
          </div>
          <div className="flex min-h-10 flex-wrap items-center gap-2 self-start">
            {showAdminChrome ? (
              <DtPillButton
                type="button"
                size="sm"
                className="gap-1.5"
                disabled={initialLoading || busy}
                onClick={() => setCreateWizardOpen(true)}
              >
                <Plus className="size-4" aria-hidden />
                Neuer Agent
              </DtPillButton>
            ) : null}
            {showAdminChrome ? (
              <Link
                href={contextHref}
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded-pill border border-sbkm-navy/15 bg-white/60 px-4 text-sm font-semibold text-sbkm-navy transition hover:bg-sbkm-mint/15 active:scale-[0.98] dark:border-white/15 dark:bg-white/5 dark:text-white"
              >
                <FileSearch className="size-4" aria-hidden />
                Kontext ansehen
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      {!canDirectlyEdit && !initialLoading ? <DtAgentsReadOnlyBanner /> : null}

      {!canDirectlyEdit && !initialLoading ? (
        <DtAgentEditRequestsPanel
          requests={editRequests}
          agentsById={agentsById}
          busy={busy}
          onCancel={cancelRequest}
        />
      ) : null}

      {showAdminChrome ? (
        <DtTabs
          tabs={pageTabs}
          active={pageView}
          onChange={(id) => setPageView(id as PageView)}
          layoutId="agents-page-tab"
          className="mb-0"
          disabled={initialLoading}
        />
      ) : null}

      {showAdminChrome ? (
        <div className="grid">
          <div
            className={cn(
              "col-start-1 row-start-1 transition-opacity duration-200",
              pageView !== "agents" && "pointer-events-none opacity-0",
            )}
            aria-hidden={pageView !== "agents"}
          >
            {agentsMainContent}
          </div>
          <div
            className={cn(
              "col-start-1 row-start-1 transition-opacity duration-200",
              pageView !== "prompts" && "pointer-events-none opacity-0",
            )}
            aria-hidden={pageView !== "prompts"}
          >
            <DtGlobalPromptsPanel
              drafts={globalPromptDraft}
              saved={globalPrompts}
              globalChecklistDraft={globalChecklistDraft}
              globalChecklistSaved={globalChecklist}
              busy={busy}
              onDraftChange={(slug, value) =>
                setGlobalPromptDraft((v) => ({ ...v, [slug]: value }))
              }
              onSave={(slug) => void saveGlobalPrompt(slug)}
              onGlobalChecklistDraftChange={setGlobalChecklistDraft}
              onSaveGlobalChecklist={() => void saveGlobalChecklist()}
            />
          </div>
        </div>
      ) : (
        agentsMainContent
      )}

      <DtAgentCreateWizard
        open={createWizardOpen}
        organisationId={orgId}
        organisationName={orgName}
        onClose={() => setCreateWizardOpen(false)}
        onCreated={() => {
          toast.success("Agent wurde angelegt.");
          void refresh(true);
        }}
      />

      <DtAgentEditRequestModal
        open={Boolean(requestAgent)}
        agent={requestAgent}
        organisationId={orgId}
        onClose={() => setRequestAgent(null)}
        onSubmitted={() => {
          toast.success("Änderungsanfrage gesendet — wir prüfen sie in Kürze.");
          void refresh(true);
        }}
      />
    </div>
  );
}
