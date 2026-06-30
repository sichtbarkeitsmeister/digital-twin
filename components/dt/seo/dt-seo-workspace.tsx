"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

import { DtChatShell } from "@/components/dt/chat/dt-chat-shell";
import { useDtSeoWorkspaceUrl } from "@/lib/dt/seo/workspace-url";
import { DtSeoConfigForm } from "@/components/dt/seo/dt-seo-config-form";
import { DtSeoReportsPanel } from "@/components/dt/seo/dt-seo-reports-panel";
import { DtSeoStatsOverview } from "@/components/dt/seo/dt-seo-stats-overview";
import { DtSeoTaskBoard } from "@/components/dt/seo/dt-seo-task-board";
import { DtTabs } from "@/components/dt/dt-tabs";
import { cn } from "@/components/dt/cn";
import type { DtSeoOrganisation } from "@/lib/dt/load-seo-organisations";

export function DtSeoWorkspace(props: {
  organisations: DtSeoOrganisation[];
  initialOrgId: string;
  initialChatId?: string | null;
  currentUserId: string;
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
  const canManage = props.isPlatformAdmin;
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
        "flex min-w-0 flex-col px-3 pt-3 sm:px-5 sm:pt-4",
        chatFocus
          ? "h-full min-h-0 flex-1 overflow-hidden"
          : "min-h-0 flex-1 overflow-y-auto scrollbar-subtle",
      )}
    >
      {!seoEnabled ? (
        <p className="mb-3 shrink-0 rounded-dt border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
          SEO ist für diese Organisation deaktiviert.
          {props.isPlatformAdmin
            ? " Aktiviere es unter Einstellungen."
            : " Bitte einen Administrator kontaktieren."}
        </p>
      ) : null}

      <DtTabs
        className="mb-3 shrink-0 sm:mb-4"
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
            org: orgId,
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
            currentUserId={props.currentUserId}
            initialOrgId={orgId}
            initialChatId={initialChatId}
            initialScope="all"
            embedded
            seoMode
            chromeless
            fillHeight
            lockOrganisation
            adminOversight={canManage}
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

      {tab === "stats" && seoEnabled ? (
        <div className="min-h-0 flex-1">
          <DtSeoStatsOverview organisationId={orgId} />
        </div>
      ) : null}

      {tab === "tasks" && seoEnabled ? (
        <div className="min-h-0 flex-1">
          <DtSeoTaskBoard organisationId={orgId} />
        </div>
      ) : null}

      {tab === "reports" && seoEnabled ? (
        <div className="min-h-0 flex-1">
          <DtSeoReportsPanel organisationId={orgId} canTrigger={canManage} />
        </div>
      ) : null}

      {tab === "settings" ? (
        <div className="min-h-0 flex-1">
          <DtSeoConfigForm
            organisationId={orgId}
            canEdit={props.isPlatformAdmin}
            isPlatformAdmin={props.isPlatformAdmin}
          />
        </div>
      ) : null}
    </div>
  );
}
