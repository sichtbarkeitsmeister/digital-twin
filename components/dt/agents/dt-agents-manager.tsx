"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";

import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { DtSelect } from "@/components/dt/dt-select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { parseQuickActions } from "@/lib/dt/types";
import {
  readSelectedOrganisationId,
  writeSelectedOrganisationId,
} from "@/lib/shared/selected-organisation-storage";

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
  const [orgId, setOrgId] = useState(props.initialOrgId);
  const [agents, setAgents] = useState<AgentRow[]>([]);

  useEffect(() => {
    const stored = readSelectedOrganisationId();
    if (stored && props.organisations.some((organisation) => organisation.id === stored)) {
      setOrgId(stored);
    }
  }, [props.organisations]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [editQuick, setEditQuick] = useState("");
  const [editEnabled, setEditEnabled] = useState(true);
  const [editPosition, setEditPosition] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [manageRes, templatesRes] = await Promise.all([
      fetch(`/api/dt/agents/manage?org=${encodeURIComponent(orgId)}`),
      fetch("/api/dt/agents/templates"),
    ]);

    const manageJson = (await manageRes.json()) as { ok?: boolean; agents?: AgentRow[] };
    if (manageJson.ok && manageJson.agents) setAgents(manageJson.agents);

    const templatesJson = (await templatesRes.json()) as {
      ok?: boolean;
      templates?: TemplateRow[];
    };
    if (templatesJson.ok && templatesJson.templates) {
      setTemplates(templatesJson.templates);
    }
  }, [orgId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function startEdit(agent: AgentRow) {
    setEditingId(agent.id);
    setEditName(agent.name);
    setEditRole(agent.role ?? "");
    setEditPrompt(agent.prompt_template);
    setEditQuick(parseQuickActions(agent.quick_actions).join("\n"));
    setEditEnabled(agent.is_enabled);
    setEditPosition(agent.position);
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
    const quickActions = editQuick
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const res = await fetch(`/api/dt/agents/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName,
        role: editRole || null,
        promptTemplate: editPrompt,
        quickActions,
        isEnabled: editEnabled,
        position: editPosition,
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
            Marketplace abonnieren und Agenten pro Organisation anpassen.
          </p>
        </div>
        <DtSelect
          label="Organisation"
          labelClassName="font-semibold normal-case tracking-normal text-sbkm-ink-600 dark:text-white/55"
          triggerClassName="min-w-[200px]"
          value={orgId}
          onValueChange={(id) => {
            setOrgId(id);
            writeSelectedOrganisationId(id);
            setEditingId(null);
          }}
          options={props.organisations.map((o) => ({
            value: o.id,
            label: o.name,
          }))}
        />
      </div>

      {status ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {status}
        </p>
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
            {agents.map((agent) => (
              <DtGlassCard key={agent.id} className="p-4">
                {editingId === agent.id ? (
                  <div className="grid gap-3">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="h-10 rounded-pill border border-sbkm-navy/15 px-3 text-sm dark:border-white/15 dark:bg-white/5 dark:text-white"
                      placeholder="Name"
                    />
                    <input
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value)}
                      className="h-10 rounded-pill border border-sbkm-navy/15 px-3 text-sm dark:border-white/15 dark:bg-white/5 dark:text-white"
                      placeholder="Rolle"
                    />
                    <Textarea
                      value={editPrompt}
                      onChange={(e) => setEditPrompt(e.target.value)}
                      className="min-h-[120px] text-sm"
                      placeholder="Prompt"
                    />
                    <Textarea
                      value={editQuick}
                      onChange={(e) => setEditQuick(e.target.value)}
                      className="min-h-[80px] text-sm"
                      placeholder="Schnellaktionen (eine pro Zeile)"
                    />
                    <label className="grid gap-1 text-sm">
                      <span className="font-semibold text-sbkm-ink-600 dark:text-white/55">
                        Reihenfolge
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={999}
                        value={editPosition}
                        onChange={(e) => setEditPosition(Number(e.target.value) || 0)}
                        className="h-10 w-24 rounded-pill border border-sbkm-navy/15 px-3 text-sm dark:border-white/15 dark:bg-white/5 dark:text-white"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={editEnabled}
                        onCheckedChange={(v) => setEditEnabled(v === true)}
                      />
                      Aktiv
                    </label>
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
                      <p className="font-semibold text-sbkm-navy dark:text-white">
                        {agent.name}
                        {!agent.is_enabled ? (
                          <span className="ml-2 text-xs font-normal text-sbkm-ink-500">
                            (deaktiviert)
                          </span>
                        ) : null}
                      </p>
                      <p className="text-xs text-sbkm-ink-600 dark:text-white/50">
                        {agent.slug} · {agent.kind}
                        {agent.role ? ` · ${agent.role}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <DtPillButton type="button" onClick={() => startEdit(agent)}>
                        Bearbeiten
                      </DtPillButton>
                      <DtPillButton
                        type="button"
                        variant="ghost"
                        disabled={busy || (agent.is_enabled && agents.filter((a) => a.is_enabled).length <= 1)}
                        onClick={() => void deleteAgent(agent)}
                      >
                        Entfernen
                      </DtPillButton>
                    </div>
                  </div>
                )}
              </DtGlassCard>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
