"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, FileSearch, Plus, Send } from "lucide-react";

import { DtAgentEditRequestModal } from "@/components/dt/agents/dt-agent-edit-request-modal";
import {
  DtAgentEditRequestsPanel,
  DtAgentsReadOnlyBanner,
} from "@/components/dt/agents/dt-agent-edit-requests-panel";
import {
  DtAgentFormFields,
  agentFormValuesFromRow,
  quickActionsFromForm,
} from "@/components/dt/agents/dt-agent-form-fields";
import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { Badge } from "@/components/ui/badge";
import type { DtAgentEditRequestRow } from "@/lib/dt/agent-edit-requests";
import { readSelectedOrganisationId } from "@/lib/shared/selected-organisation-storage";

type AgentRow = {
  id: string;
  slug: string;
  name: string;
  role: string | null;
  kind: string;
  is_enabled: boolean;
  position: number;
  prompt_template: string;
  quick_actions: unknown;
};

type TemplateRow = {
  id: string;
  slug: string;
  name: string;
  short_description: string;
  kind: string;
};

export function DtAgentsManager(props: {
  organisations: Array<{ id: string; name: string }>;
  initialOrgId: string;
}) {
  const searchParams = useSearchParams();
  const [orgId, setOrgId] = useState(props.initialOrgId);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [canDirectlyEdit, setCanDirectlyEdit] = useState(false);
  const [editRequests, setEditRequests] = useState<DtAgentEditRequestRow[]>([]);
  const [requestAgent, setRequestAgent] = useState<AgentRow | null>(null);

  useEffect(() => {
    const fromUrl = searchParams.get("org");
    if (
      fromUrl &&
      props.organisations.some((organisation) => organisation.id === fromUrl)
    ) {
      setOrgId(fromUrl);
      setEditingId(null);
      return;
    }

    const stored = readSelectedOrganisationId();
    if (stored && props.organisations.some((organisation) => organisation.id === stored)) {
      setOrgId(stored);
    }
  }, [searchParams, props.organisations]);

  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState(agentFormValuesFromRow({
    name: "",
    role: null,
    prompt_template: "",
    quick_actions: [],
    is_enabled: true,
    position: 0,
  }));
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const refreshRequests = useCallback(async () => {
    if (!orgId) return;
    const res = await fetch(`/api/dt/agents/edit-requests?org=${encodeURIComponent(orgId)}`);
    const json = (await res.json()) as { ok?: boolean; requests?: DtAgentEditRequestRow[] };
    if (json.ok && json.requests) setEditRequests(json.requests);
  }, [orgId]);

  const refresh = useCallback(async () => {
    const [manageRes, templatesRes] = await Promise.all([
      fetch(`/api/dt/agents/manage?org=${encodeURIComponent(orgId)}`),
      fetch("/api/dt/agents/templates"),
      refreshRequests(),
    ]);

    const manageJson = (await manageRes.json()) as {
      ok?: boolean;
      agents?: AgentRow[];
      canDirectlyEdit?: boolean;
    };
    if (manageJson.ok && manageJson.agents) setAgents(manageJson.agents);
    if (manageJson.ok) setCanDirectlyEdit(Boolean(manageJson.canDirectlyEdit));

    const templatesJson = (await templatesRes.json()) as {
      ok?: boolean;
      templates?: TemplateRow[];
    };
    if (templatesJson.ok && templatesJson.templates) {
      setTemplates(templatesJson.templates);
    }
  }, [orgId, refreshRequests]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function startEdit(agent: AgentRow) {
    setEditingId(agent.id);
    setEditValues(agentFormValuesFromRow(agent));
    setStatus(null);
  }

  async function deleteAgent(agent: AgentRow) {
    const enabledCount = agents.filter((a) => a.is_enabled).length;
    if (agent.is_enabled && enabledCount <= 1) {
      setStatus("Mindestens ein aktiver Agent muss bleiben.");
      return;
    }
    if (
      !window.confirm(
        `Agent „${agent.name}" wirklich entfernen? Nur möglich ohne zugehörige Chats.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setStatus(null);
    const res = await fetch(`/api/dt/agents/${agent.id}`, { method: "DELETE" });
    const json = (await res.json()) as { ok?: boolean; message?: string };
    setBusy(false);
    if (!json.ok) {
      setStatus(json.message ?? "Löschen fehlgeschlagen.");
      return;
    }
    if (editingId === agent.id) setEditingId(null);
    await refresh();
  }

  async function saveEdit() {
    if (!editingId) return;
    setBusy(true);
    setStatus(null);
    const res = await fetch(`/api/dt/agents/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editValues.name,
        role: editValues.role || null,
        promptTemplate: editValues.prompt,
        quickActions: quickActionsFromForm(editValues.quick),
        isEnabled: editValues.enabled,
        position: editValues.position,
      }),
    });
    const json = (await res.json()) as { ok?: boolean; message?: string };
    setBusy(false);
    if (!json.ok) {
      setStatus(json.message ?? "Speichern fehlgeschlagen.");
      return;
    }
    setEditingId(null);
    await refresh();
  }

  async function subscribeTemplate(templateId: string) {
    setBusy(true);
    setStatus(null);
    const res = await fetch("/api/dt/agents/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organisationId: orgId, templateId }),
    });
    const json = (await res.json()) as { ok?: boolean; message?: string };
    setBusy(false);
    if (!json.ok) {
      setStatus(json.message ?? "Agent konnte nicht hinzugefügt werden.");
      return;
    }
    await refresh();
  }

  async function cancelRequest(requestId: string) {
    setBusy(true);
    setStatus(null);
    const res = await fetch(`/api/dt/agents/edit-requests/${requestId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });
    const json = (await res.json()) as { ok?: boolean; message?: string };
    setBusy(false);
    if (!json.ok) {
      setStatus(json.message ?? "Zurückziehen fehlgeschlagen.");
      return;
    }
    await refresh();
  }

  const subscribedSlugs = new Set(agents.map((a) => a.slug));

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-semibold text-sbkm-ink-600 hover:text-sbkm-navy dark:text-white/60"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Zurück zum Chat
        </Link>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-sbkm-navy dark:text-white">
            DigitalTwin-Agenten
          </h1>
          <p className="text-sm text-sbkm-ink-600 dark:text-white/60">
            {canDirectlyEdit
              ? "Marketplace verwalten und Agenten direkt bearbeiten."
              : "Marketplace-Agenten aktivieren und Änderungen bei uns anfragen."}
          </p>
        </div>
        <Link
          href={`/dashboard/verwaltung/agent-kontext?org=${encodeURIComponent(orgId)}${editingId ? `&agent=${encodeURIComponent(editingId)}` : agents[0] ? `&agent=${encodeURIComponent(agents[0].id)}` : ""}`}
          className="inline-flex h-10 items-center gap-2 rounded-pill border border-sbkm-navy/15 bg-white/60 px-4 text-sm font-semibold text-sbkm-navy transition hover:bg-sbkm-mint/15 active:scale-[0.98] dark:border-white/15 dark:bg-white/5 dark:text-white"
        >
          <FileSearch className="size-4" aria-hidden />
          Kontext ansehen
        </Link>
      </div>

      {!canDirectlyEdit ? <DtAgentsReadOnlyBanner /> : null}

      {status ? (
        <p
          className={`text-sm ${status.includes("gesendet") || status.includes("übernommen") ? "text-sbkm-mint" : "text-red-600 dark:text-red-400"}`}
          role="alert"
        >
          {status}
        </p>
      ) : null}

      {!canDirectlyEdit ? (
        <DtAgentEditRequestsPanel
          requests={editRequests}
          agentsById={agentsById}
          busy={busy}
          onCancel={cancelRequest}
        />
      ) : null}

      <section className="grid gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/50">
          Marketplace
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((tpl) => {
            const has = subscribedSlugs.has(tpl.slug);
            return (
              <DtGlassCard key={tpl.id} className="flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-sbkm-navy dark:text-white">{tpl.name}</p>
                  <Badge variant="secondary">{tpl.kind}</Badge>
                </div>
                <p className="flex-1 text-xs text-sbkm-ink-600 dark:text-white/55">
                  {tpl.short_description}
                </p>
                <DtPillButton
                  type="button"
                  disabled={busy || has}
                  onClick={() => void subscribeTemplate(tpl.id)}
                  className="w-full justify-center gap-2"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  {has ? "Bereits aktiv" : "Abonnieren"}
                </DtPillButton>
              </DtGlassCard>
            );
          })}
        </div>
      </section>

      <section className="grid gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/50">
          Aktive Agenten
        </h2>
        {agents.length === 0 ? (
          <p className="text-sm text-sbkm-ink-600 dark:text-white/55">Noch keine Agenten.</p>
        ) : (
          <div className="grid gap-3">
            {agents.map((agent) => {
              const pending = pendingByAgentId.get(agent.id);
              return (
                <DtGlassCard key={agent.id} className="p-4">
                  {canDirectlyEdit && editingId === agent.id ? (
                    <div className="grid gap-3">
                      <DtAgentFormFields
                        values={editValues}
                        onChange={(patch) => setEditValues((v) => ({ ...v, ...patch }))}
                        disabled={busy}
                      />
                      <div className="flex gap-2">
                        <DtPillButton type="button" disabled={busy} onClick={() => void saveEdit()}>
                          Speichern
                        </DtPillButton>
                        <DtPillButton
                          type="button"
                          variant="ghost"
                          onClick={() => setEditingId(null)}
                        >
                          Abbrechen
                        </DtPillButton>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-sbkm-navy dark:text-white">
                            {agent.name}
                            {!agent.is_enabled ? (
                              <span className="ml-2 text-xs font-normal text-sbkm-ink-500">
                                (deaktiviert)
                              </span>
                            ) : null}
                          </p>
                          {pending ? (
                            <Badge variant="secondary">In Prüfung</Badge>
                          ) : null}
                        </div>
                        <p className="text-xs text-sbkm-ink-600 dark:text-white/50">
                          {agent.slug} · {agent.kind}
                          {agent.role ? ` · ${agent.role}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {canDirectlyEdit ? (
                          <>
                            <DtPillButton type="button" onClick={() => startEdit(agent)}>
                              Bearbeiten
                            </DtPillButton>
                            <DtPillButton
                              type="button"
                              variant="ghost"
                              disabled={
                                busy ||
                                (agent.is_enabled && agents.filter((a) => a.is_enabled).length <= 1)
                              }
                              onClick={() => void deleteAgent(agent)}
                            >
                              Entfernen
                            </DtPillButton>
                          </>
                        ) : (
                          <DtPillButton
                            type="button"
                            disabled={busy || Boolean(pending)}
                            className="gap-1.5"
                            onClick={() => setRequestAgent(agent)}
                          >
                            <Send className="h-4 w-4" />
                            {pending ? "Anfrage läuft" : "Änderung vorschlagen"}
                          </DtPillButton>
                        )}
                      </div>
                    </div>
                  )}
                </DtGlassCard>
              );
            })}
          </div>
        )}
      </section>

      <DtAgentEditRequestModal
        open={Boolean(requestAgent)}
        agent={requestAgent}
        organisationId={orgId}
        onClose={() => setRequestAgent(null)}
        onSubmitted={() => {
          setStatus("Änderungsanfrage gesendet — wir prüfen sie in Kürze.");
          void refresh();
        }}
      />
    </div>
  );
}
