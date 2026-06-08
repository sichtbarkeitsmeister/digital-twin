"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

import { DtChatShell } from "@/components/dt/chat/dt-chat-shell";
import { useDtSeoWorkspaceUrl } from "@/lib/dt/seo/workspace-url";
import { DtSeoConfigForm } from "@/components/dt/seo/dt-seo-config-form";
import { DtSeoReportsPanel } from "@/components/dt/seo/dt-seo-reports-panel";
import { DtSeoStatsOverview } from "@/components/dt/seo/dt-seo-stats-overview";
import { DtSeoTaskBoard } from "@/components/dt/seo/dt-seo-task-board";
import { PersistedOrganisationUrlSync } from "@/components/shared/persisted-organisation-url-sync";
import { DtSelect } from "@/components/dt/dt-select";
import { DtTabs } from "@/components/dt/dt-tabs";
import { cn } from "@/components/dt/cn";
import type { DtSeoOrganisation } from "@/lib/dt/load-seo-organisations";

export function DtSeoWorkspace(props: {
  organisations: DtSeoOrganisation[];
  initialOrgId: string;
  initialChatId?: string | null;
  isPlatformAdmin: boolean;
}) {
  const searchParams = useSearchParams();
  const { writeUrl, tab } = useDtSeoWorkspaceUrl();

  const orgId = useMemo(() => {
    const fromUrl = searchParams.get("org");
    if (fromUrl && props.organisations.some((o) => o.id === fromUrl)) return fromUrl;
    return props.initialOrgId;
  }, [searchParams, props.organisations, props.initialOrgId]);

  const initialChatId = searchParams.get("chat") ?? props.initialChatId ?? null;

  const selected = props.organisations.find((o) => o.id === orgId) ?? props.organisations[0];
  const canManage = Boolean(selected?.canManageAgents);
  const seoEnabled = Boolean(selected?.seoEnabled);
  const chatFocus = tab === "chat";

  const chatOrgs = useMemo(
    () =>
      props.organisations.map((o) => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        canManageAgents: o.canManageAgents,
      })),
    [props.organisations],
  );

  if (!selected) {
    return (
      <p className="text-sm text-sbkm-ink-600 dark:text-white/70">
        Keine Organisation mit SEO-Zugang.
      </p>
    );
  }

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col",
        chatFocus
          ? "h-full min-h-0 flex-1 gap-2 overflow-hidden"
          : "min-h-0 min-w-0 flex-1 gap-4 overflow-y-auto scrollbar-subtle sm:gap-6",
      )}
    >
      <PersistedOrganisationUrlSync
        allowedOrganisationIds={props.organisations.map((organisation) => organisation.id)}
      />
      {!chatFocus ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-sbkm-navy sm:text-2xl dark:text-white">
              SEO DigitalTwin
            </h1>
            <p className="text-sm text-sbkm-ink-600 dark:text-white/60">
              Berater-Chat, Aufgaben, Reports und Konfiguration.
            </p>
          </div>
          <DtSelect
            className="w-full sm:w-auto"
            label="Organisation"
            labelClassName="font-semibold normal-case tracking-normal text-sbkm-ink-600 dark:text-white/55"
            triggerClassName="w-full min-w-0 sm:min-w-[220px]"
            fullWidth
            menuMaxHeight="max-h-72"
            value={orgId}
            onValueChange={(id) => writeUrl({ org: id, chat: null, tab })}
            options={props.organisations.map((o) => ({
              value: o.id,
              label: o.name,
              description:
                !o.seoEnabled && props.isPlatformAdmin
                  ? "SEO deaktiviert"
                  : o.slug ?? undefined,
            }))}
          />
        </div>
      ) : null}

      {!seoEnabled ? (
        <p className="shrink-0 rounded-dt border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
          SEO ist für diese Organisation deaktiviert.
          {props.isPlatformAdmin
            ? " Aktiviere es unter Einstellungen."
            : " Bitte einen Administrator kontaktieren."}
        </p>
      ) : null}

      <DtTabs
        className={cn("mb-4 shrink-0 sm:mb-7", chatFocus && "mb-0")}
        layoutId="seo-workspace-tab"
        tabs={[
          { id: "chat", label: "Chat" },
          { id: "stats", label: "Statistik" },
          { id: "tasks", label: "Aufgaben" },
          { id: "reports", label: "Reports" },
          { id: "settings", label: "Einstellungen" },
        ]}
        active={tab}
        onChange={(id) => {
          writeUrl({
            tab: id as typeof tab,
            ...(id !== "chat" ? { chat: null } : {}),
          });
        }}
      />

      {tab === "chat" && seoEnabled ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <DtChatShell
            key={orgId}
            organisations={chatOrgs}
            initialOrgId={orgId}
            initialChatId={initialChatId}
            initialScope="mine"
            seoMode
            fillHeight
            onSaveTaskProposal={async ({ organisationId, chatId, messageId, proposal }) => {
              const res = await fetch("/api/dt/seo/tasks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  organisationId,
                  chatId,
                  messageId,
                  title: proposal.title,
                  keyword: proposal.keyword,
                  url: proposal.url,
                  currentStatus: proposal.current_status,
                  action: proposal.action,
                  priority: proposal.priority,
                  assignToSelf: true,
                }),
              });
              return (await res.json()) as {
                ok?: boolean;
                message?: string;
                alreadyExists?: boolean;
              };
            }}
            onSaveAllTaskProposals={async ({ organisationId, chatId, messageId, proposals }) => {
              for (const proposal of proposals) {
                const res = await fetch("/api/dt/seo/tasks", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    organisationId,
                    chatId,
                    messageId,
                    title: proposal.title,
                    keyword: proposal.keyword,
                    url: proposal.url,
                    currentStatus: proposal.current_status,
                    action: proposal.action,
                    priority: proposal.priority,
                    assignToSelf: true,
                  }),
                });
                const json = (await res.json()) as {
                  ok?: boolean;
                  message?: string;
                  alreadyExists?: boolean;
                };
                if (!json.ok) return json;
              }
              return { ok: true };
            }}
          />
        </div>
      ) : null}

      {tab === "stats" && seoEnabled ? <DtSeoStatsOverview organisationId={orgId} /> : null}

      {tab === "tasks" && seoEnabled ? <DtSeoTaskBoard organisationId={orgId} /> : null}

      {tab === "reports" && seoEnabled ? (
        <DtSeoReportsPanel organisationId={orgId} canTrigger={canManage} />
      ) : null}

      {tab === "settings" ? (
        <DtSeoConfigForm
          organisationId={orgId}
          canEdit={canManage || props.isPlatformAdmin}
          isPlatformAdmin={props.isPlatformAdmin}
        />
      ) : null}
    </div>
  );
}
