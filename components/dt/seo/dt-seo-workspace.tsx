"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { DtChatShell } from "@/components/dt/chat/dt-chat-shell";
import { useDtSeoWorkspaceUrl } from "@/lib/dt/seo/workspace-url";
import { DtSeoConfigForm } from "@/components/dt/seo/dt-seo-config-form";
import { DtSeoReportsPanel } from "@/components/dt/seo/dt-seo-reports-panel";
import { DtSeoStatsOverview } from "@/components/dt/seo/dt-seo-stats-overview";
import { DtSeoTaskBoard } from "@/components/dt/seo/dt-seo-task-board";
import { DtPillButton } from "@/components/dt/dt-pill-button";
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const { writeUrl, tab } = useDtSeoWorkspaceUrl();

  const [orgFlags, setOrgFlags] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(props.organisations.map((o) => [o.id, o.seoEnabled])),
  );
  const [enabling, setEnabling] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);

  useEffect(() => {
    setOrgFlags(Object.fromEntries(props.organisations.map((o) => [o.id, o.seoEnabled])));
  }, [props.organisations]);

  const orgId = useMemo(() => {
    const fromUrl = searchParams.get("org");
    if (fromUrl && props.organisations.some((o) => o.id === fromUrl)) return fromUrl;
    return props.initialOrgId;
  }, [searchParams, props.organisations, props.initialOrgId]);

  const initialChatId = searchParams.get("chat") ?? props.initialChatId ?? null;

  const selected = props.organisations.find((o) => o.id === orgId) ?? props.organisations[0];
  const canManage = props.isPlatformAdmin;
  const seoEnabled = Boolean(
    orgFlags[orgId] ?? selected?.seoEnabled ?? false,
  );
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

  const markSeoEnabled = useCallback(
    (organisationId: string, enabled: boolean) => {
      setOrgFlags((prev) => ({ ...prev, [organisationId]: enabled }));
      router.refresh();
    },
    [router],
  );

  const enableSeoNow = useCallback(async () => {
    if (!canManage || !orgId) return;
    setEnabling(true);
    setEnableError(null);
    try {
      const res = await fetch(`/api/dt/org-config/${orgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seoEnabled: true }),
      });
      const json = (await res.json()) as { ok?: boolean; message?: string };
      if (!json.ok) {
        setEnableError(json.message ?? "Aktivierung fehlgeschlagen.");
        return;
      }
      markSeoEnabled(orgId, true);
      writeUrl({ org: orgId, tab: "chat" });
    } catch (err) {
      setEnableError(err instanceof Error ? err.message : "Aktivierung fehlgeschlagen.");
    } finally {
      setEnabling(false);
    }
  }, [canManage, orgId, markSeoEnabled, writeUrl]);

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
        <div className="mb-3 flex shrink-0 flex-col gap-3 rounded-dt border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
          <p>
            SEO ist für <span className="font-semibold">{selected.name}</span> noch nicht
            freigeschaltet.
            {canManage
              ? " Ohne Freischaltung sind Chat, Statistik, Aufgaben und Reports gesperrt."
              : " Bitte einen Administrator kontaktieren."}
          </p>
          {canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <DtPillButton
                type="button"
                size="sm"
                disabled={enabling}
                onClick={() => void enableSeoNow()}
              >
                {enabling ? "Aktiviere…" : "SEO jetzt aktivieren"}
              </DtPillButton>
              <button
                type="button"
                className="text-xs font-medium underline underline-offset-2"
                onClick={() => writeUrl({ org: orgId, tab: "settings" })}
              >
                Zu Einstellungen
              </button>
            </div>
          ) : null}
          {enableError ? <p className="w-full text-xs text-red-700 dark:text-red-300">{enableError}</p> : null}
        </div>
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
            isPlatformAdmin={props.isPlatformAdmin}
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
            onSeoEnabledChange={(enabled) => markSeoEnabled(orgId, enabled)}
          />
        </div>
      ) : null}
    </div>
  );
}
