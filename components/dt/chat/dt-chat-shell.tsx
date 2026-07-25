"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Menu } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import {
  DtAgentSwitcher,
  getQuickActionsForAgent,
  type DtAgentOption,
} from "@/components/dt/chat/dt-agent-switcher";
import { DtWunschkundenPanel } from "@/components/dt/chat/dt-wunschkunden-panel";
import { DtChatComposer } from "@/components/dt/chat/dt-chat-composer";
import { DtChatLightbox } from "@/components/dt/chat/dt-chat-lightbox";
import { DtGhostBanner } from "@/components/dt/chat/dt-ghost-banner";
import {
  DtChatSidebar,
  type DtChatSearchHit,
  type DtOrgOption,
} from "@/components/dt/chat/dt-chat-sidebar";
import { DtChatSkeleton } from "@/components/dt/chat/dt-chat-skeleton";
import { DtChatThread } from "@/components/dt/chat/dt-chat-thread";
import { DtChatParticipantsBadge } from "@/components/dt/chat/dt-chat-participants-badge";
import type { DtChatMessageItem } from "@/components/dt/chat/dt-chat-message";
import { DashboardButton } from "@/components/dashboard-button";
import { DtLogo } from "@/components/dt/dt-logo";
import { DtThemeToggle } from "@/components/dt/dt-theme-toggle";
import { UserMenu } from "@/components/user-menu";
import { readDtLastChatId, writeDtLastChatId } from "@/lib/dt/client-storage";
import { emojiForAgent, extractAgentDisg } from "@/lib/dt/agent-display";
import {
  readSelectedOrganisationId,
  writeSelectedOrganisationId,
} from "@/lib/shared/selected-organisation-storage";
import {
  DT_MAX_ATTACHMENTS,
} from "@/lib/dt/attachments-shared";
import type { DtAttachmentDraft, DtStoredAttachment } from "@/lib/dt/client-attachments";
import {
  fileToDtAttachmentDraft,
  revokeDtDraftPreview,
} from "@/lib/dt/client-attachments";
import type { DtChatListScope } from "@/lib/dt/db";
import { cn } from "@/components/dt/cn";
import { useDtChatUrlWriter } from "@/lib/dt/use-dt-chat-url";
import type { DtChatMode, DtChatRow } from "@/lib/dt/types";
import type { DtChatParticipant, DtOversightMember } from "@/lib/dt/oversight";
import {
  filterUnsavedSeoTaskProposals,
  type DtSeoChatTaskProposal,
  type DtSeoTaskProposalMatchRow,
} from "@/lib/dt/seo/chat-task-proposals";
import { filterAgentsHiddenFromOrgMembers } from "@/lib/dt/agents/seo-advisor";

export type DtOrgOptionWithRole = DtOrgOption & { canManageAgents?: boolean };

function pickSeoAdvisorAgentId(agents: DtAgentOption[]): string | null {
  const advisor = agents.find(
    (agent) => agent.slug === "seo_advisor" || agent.kind === "seo_advisor",
  );
  return advisor?.id ?? null;
}

function resolveDefaultAgentId(
  agents: DtAgentOption[],
  options: { seoMode?: boolean; currentId?: string; hasActiveChat?: boolean },
): string {
  if (agents.length === 0) return "";

  if (options.seoMode && !options.hasActiveChat) {
    return pickSeoAdvisorAgentId(agents) ?? agents[0]!.id;
  }

  if (options.currentId && agents.some((agent) => agent.id === options.currentId)) {
    return options.currentId;
  }

  if (options.seoMode) {
    return pickSeoAdvisorAgentId(agents) ?? agents[0]!.id;
  }

  return agents[0]!.id;
}

export function DtChatShell(props: {
  organisations: DtOrgOptionWithRole[];
  currentUserId?: string;
  initialScope?: DtChatListScope;
  initialOrgId?: string;
  /** Deep link: active chat id (`?chat=`). */
  initialChatId?: string | null;
  /** Sync org/chat/scope to the URL (default on). */
  syncUrl?: boolean;
  /** Homepage: shared team chats for the whole organisation. */
  embedded?: boolean;
  /** SEO workspace: private seo-mode chats with SEO advisor agent. */
  seoMode?: boolean;
  /** Platform-admin: browse and reply in any org member's chats. */
  adminOversight?: boolean;
  /** Embedded layout without marketing header (dashboard SEO chat). */
  chromeless?: boolean;
  /** Use full available height (dashboard SEO chat focus). */
  fillHeight?: boolean;
  /** Parent controls organisation (e.g. SEO workspace header). */
  lockOrganisation?: boolean;
  onSaveTaskProposal?: (input: {
    organisationId: string;
    chatId: string;
    messageId: string;
    proposal: DtSeoChatTaskProposal;
  }) => Promise<{ ok?: boolean; message?: string; alreadyExists?: boolean }>;
  onSaveAllTaskProposals?: (input: {
    organisationId: string;
    chatId: string;
    messageId: string;
    proposals: DtSeoChatTaskProposal[];
  }) => Promise<{ ok?: boolean; message?: string; alreadyExists?: boolean }>;
}) {
  const initialOrgId =
    props.initialOrgId && props.organisations.some((o) => o.id === props.initialOrgId)
      ? props.initialOrgId
      : (props.organisations[0]?.id ?? "");
  const [selectedOrgId, setSelectedOrgId] = useState(initialOrgId);
  const defaultScope: DtChatListScope = props.adminOversight
    ? (props.initialScope ?? "all")
    : props.seoMode
      ? "mine"
      : props.initialScope ?? (props.embedded ? "team" : "all");
  const [chatScope, setChatScope] = useState<DtChatListScope>(defaultScope);
  const [ownerFilterUserId, setOwnerFilterUserId] = useState<string | null>(null);
  const oversightActive = Boolean(props.adminOversight) && chatScope === "org";
  const [orgMembers, setOrgMembers] = useState<DtOversightMember[]>([]);
  const [ownerLabels, setOwnerLabels] = useState<Record<string, string>>({});
  const [participants, setParticipants] = useState<DtChatParticipant[]>([]);
  const [authorLabels, setAuthorLabels] = useState<Record<string, string>>({});
  const [agents, setAgents] = useState<DtAgentOption[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [chats, setChats] = useState<DtChatRow[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DtChatMessageItem[]>([]);
  const [attachmentsByMessage, setAttachmentsByMessage] = useState<
    Map<string, DtStoredAttachment[]>
  >(new Map());
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<DtAttachmentDraft[]>([]);
  const [ghostMode, setGhostMode] = useState(false);
  const [textMode, setTextMode] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [dropHighlight, setDropHighlight] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<DtChatSearchHit[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [seoTasks, setSeoTasks] = useState<DtSeoTaskProposalMatchRow[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const syncUrl = props.syncUrl !== false;
  const includeScopeInUrl = !props.seoMode || Boolean(props.adminOversight);
  const includeOwnerInUrl = Boolean(props.adminOversight);
  const { writeUrl, searchParams } = useDtChatUrlWriter({
    includeScope: includeScopeInUrl,
    includeOwner: includeOwnerInUrl,
  });

  const syncChatUrl = useCallback(
    (patch: {
      org?: string | null;
      chat?: string | null;
      scope?: DtChatListScope | null;
      owner?: string | null;
    }) => {
      if (!syncUrl) return;
      writeUrl(patch);
    },
    [syncUrl, writeUrl],
  );

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );

  const quickActions = useMemo(() => getQuickActionsForAgent(selectedAgent), [selectedAgent]);

  const wunschkundePersonas = useMemo(
    () => agents.filter((a) => a.kind === "wunschkunde"),
    [agents],
  );
  const showWunschkundenPanel =
    !props.seoMode &&
    !props.adminOversight &&
    !ghostMode &&
    selectedAgent?.kind === "wunschkunde" &&
    wunschkundePersonas.length > 1;

  const activeChat = useMemo(
    () => chats.find((c) => c.id === selectedChatId) ?? null,
    [chats, selectedChatId],
  );

  const isSeoChat = activeChat?.mode === "seo";
  const showChatAuthors = Boolean(
    activeChat &&
      (activeChat.mode === "team" ||
        activeChat.mode === "seo" ||
        activeChat.shared_to_team_at ||
        oversightActive),
  );

  const displayAgentName = selectedAgent?.name ?? "DigitalTwin";
  const displayAgentRole = selectedAgent?.role ?? null;
  const displayAgentDisg = selectedAgent
    ? extractAgentDisg(selectedAgent.avatar_data)
    : null;
  const displayAgentEmoji = selectedAgent ? emojiForAgent(selectedAgent) : null;
  const chatModeForCreate: DtChatMode = props.adminOversight
    ? selectedAgent?.slug === "seo_advisor"
      ? "seo"
      : chatScope === "team"
        ? "team"
        : "default"
    : props.seoMode
      ? "seo"
      : chatScope === "team"
        ? "team"
        : "default";
  const selectedOrg = props.organisations.find((o) => o.id === selectedOrgId);
  const canManageAgents = Boolean(selectedOrg?.canManageAgents);
  const contextMode = isSeoChat
    ? "seo"
    : chatScope === "team"
      ? "team"
      : "default";
  const contextHref =
    canManageAgents && selectedOrgId && selectedAgentId
      ? `/dashboard/verwaltung/agent-kontext?org=${encodeURIComponent(selectedOrgId)}&agent=${encodeURIComponent(selectedAgentId)}&mode=${contextMode}`
      : null;

  const refreshChats = useCallback(async () => {
    if (!selectedOrgId || ghostMode) return;
    const isOrgScope = Boolean(props.adminOversight) && chatScope === "org";
    const q = new URLSearchParams({
      org: selectedOrgId,
      scope: props.seoMode && !props.adminOversight ? "mine" : chatScope,
      ...(props.seoMode && !props.adminOversight ? { mode: "seo" } : {}),
      ...(isOrgScope ? { oversight: "1" } : {}),
      ...(isOrgScope && ownerFilterUserId ? { owner: ownerFilterUserId } : {}),
      ...(showArchived ? { archived: "1" } : {}),
    });
    const res = await fetch(`/api/dt/chats?${q}`);
    const json = (await res.json()) as {
      ok?: boolean;
      chats?: DtChatRow[];
      ownerLabels?: Record<string, string>;
    };
    if (json.ok && json.chats) {
      setChats(json.chats);
      setOwnerLabels(json.ownerLabels ?? {});
    }
  }, [
    selectedOrgId,
    showArchived,
    ghostMode,
    chatScope,
    props.seoMode,
    props.adminOversight,
    ownerFilterUserId,
  ]);

  const refreshAgents = useCallback(async () => {
    if (!selectedOrgId) return;
    const res = await fetch(`/api/dt/agents?org=${encodeURIComponent(selectedOrgId)}`);
    const json = (await res.json()) as { ok?: boolean; agents?: DtAgentOption[] };
    // SEO advisor is only available inside the SEO workspace (platform admins).
    const visible = props.seoMode
      ? (json.agents ?? [])
      : filterAgentsHiddenFromOrgMembers(json.agents ?? []);
    if (json.ok && visible.length) {
      setAgents(visible);
      setSelectedAgentId((prev) =>
        resolveDefaultAgentId(visible, {
          seoMode: props.seoMode,
          currentId: prev,
          hasActiveChat: Boolean(selectedChatId),
        }),
      );
    } else {
      setAgents([]);
      setSelectedAgentId("");
    }
  }, [selectedOrgId, props.seoMode, selectedChatId]);

  const refreshSeoTasks = useCallback(async () => {
    if (!selectedOrgId) return;
    if (!props.seoMode && !isSeoChat) return;
    const res = await fetch(`/api/dt/seo/tasks?org=${encodeURIComponent(selectedOrgId)}`);
    const json = (await res.json()) as {
      ok?: boolean;
      tasks?: Array<{
        id: string;
        message_id: string | null;
        title: string;
        keyword: string | null;
        url: string | null;
        action: string | null;
      }>;
    };
    if (json.ok && json.tasks) {
      setSeoTasks(json.tasks);
    }
  }, [props.seoMode, selectedOrgId, isSeoChat]);

  const refreshOrgMembers = useCallback(async () => {
    if (!props.adminOversight || !selectedOrgId) return;
    const res = await fetch(
      `/api/dt/chats/participants?org=${encodeURIComponent(selectedOrgId)}`,
    );
    const json = (await res.json()) as {
      ok?: boolean;
      members?: DtOversightMember[];
    };
    if (json.ok && json.members) setOrgMembers(json.members);
  }, [props.adminOversight, selectedOrgId]);

  const loadChat = useCallback(async (chatId: string) => {
    const res = await fetch(`/api/dt/chats/${chatId}`);
    const json = (await res.json()) as {
      ok?: boolean;
      messages?: DtChatMessageItem[];
      chat?: DtChatRow;
      attachments?: DtStoredAttachment[];
      authorLabels?: Record<string, string>;
      participants?: DtChatParticipant[];
      seoTasks?: DtSeoTaskProposalMatchRow[];
      message?: string;
    };
    if (!json.ok) {
      writeDtLastChatId(null);
      setStatus(json.message ?? "Chat konnte nicht geladen werden.");
      return false;
    }
    setMessages(json.messages ?? []);
    setAuthorLabels(json.authorLabels ?? {});
    setParticipants(json.participants ?? []);
    if (json.seoTasks) setSeoTasks(json.seoTasks);
    const map = new Map<string, DtStoredAttachment[]>();
    for (const row of json.attachments ?? []) {
      if (!row.message_id) continue;
      const list = map.get(row.message_id) ?? [];
      list.push(row);
      map.set(row.message_id, list);
    }
    setAttachmentsByMessage(map);
    if (json.chat?.agent_id) setSelectedAgentId(json.chat.agent_id);
    writeDtLastChatId(chatId);
    return true;
  }, []);

  useEffect(() => {
    if (!props.initialOrgId || props.initialOrgId === selectedOrgId) return;
    setSelectedOrgId(props.initialOrgId);
    setSearchQuery("");
    startNewChat();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional external org change only
  }, [props.initialOrgId]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        setIsInitialLoading(true);

        const allowedOrgIds = new Set(props.organisations.map((organisation) => organisation.id));
        let resolvedOrgId = initialOrgId;

        if (props.lockOrganisation) {
          resolvedOrgId = initialOrgId;
        } else {
          const urlOrg = searchParams.get("org")?.trim() || null;
          if (urlOrg && allowedOrgIds.has(urlOrg)) {
            resolvedOrgId = urlOrg;
            writeSelectedOrganisationId(urlOrg);
          } else if (!urlOrg) {
            const storedOrg = readSelectedOrganisationId();
            if (storedOrg && allowedOrgIds.has(storedOrg)) {
              resolvedOrgId = storedOrg;
            }
          }
        }

        if (resolvedOrgId !== selectedOrgId) {
          setSelectedOrgId(resolvedOrgId);
        }

        if (resolvedOrgId) {
          const scopeForList = props.adminOversight
            ? defaultScope
            : props.seoMode
              ? "mine"
              : defaultScope;
          const bootstrapOversight = props.adminOversight && scopeForList === "org";
          const chatQuery = new URLSearchParams({
            org: resolvedOrgId,
            scope: scopeForList,
            ...(props.seoMode && !props.adminOversight ? { mode: "seo" } : {}),
            ...(bootstrapOversight ? { oversight: "1" } : {}),
          });

          const [agentsRes, chatsRes] = await Promise.all([
            fetch(`/api/dt/agents?org=${encodeURIComponent(resolvedOrgId)}`),
            ghostMode
              ? Promise.resolve(null)
              : fetch(`/api/dt/chats?${chatQuery}`),
          ]);

          if (cancelled) return;

          const agentsJson = (await agentsRes.json()) as {
            ok?: boolean;
            agents?: DtAgentOption[];
          };
          if (agentsJson.ok && agentsJson.agents?.length) {
            setAgents(agentsJson.agents);
            setSelectedAgentId((prev) =>
              resolveDefaultAgentId(agentsJson.agents!, {
                seoMode: props.seoMode,
                currentId: prev,
                hasActiveChat: false,
              }),
            );
          } else {
            setAgents([]);
            setSelectedAgentId("");
          }

          if (chatsRes) {
            const chatsJson = (await chatsRes.json()) as {
              ok?: boolean;
              chats?: DtChatRow[];
              ownerLabels?: Record<string, string>;
            };
            if (chatsJson.ok && chatsJson.chats) setChats(chatsJson.chats);
            if (chatsJson.ownerLabels) setOwnerLabels(chatsJson.ownerLabels);
          }
        }

        const urlScope = searchParams.get("scope");
        if (
          urlScope === "mine" ||
          urlScope === "team" ||
          urlScope === "all" ||
          (urlScope === "org" && props.adminOversight)
        ) {
          setChatScope(urlScope);
        }
        const urlOwner = searchParams.get("owner");
        if (urlOwner) setOwnerFilterUserId(urlOwner);

        if (!ghostMode) {
          const urlChat = props.initialChatId?.trim() || null;
          const storedChat = readDtLastChatId();
          const preferred = urlChat || storedChat;
          if (preferred) {
            const loaded = await loadChat(preferred);
            if (cancelled) return;
            if (loaded) {
              setSelectedChatId(preferred);
            } else if (urlChat) {
              syncChatUrl({ chat: null });
            }
          }
        }
      } catch {
        if (!cancelled) {
          setStatus("Chat konnte nicht geladen werden.");
        }
      } finally {
        if (!cancelled) setIsInitialLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrap on mount / org or deep-link chat change
  }, [initialOrgId, props.initialChatId, props.seoMode, props.adminOversight, props.lockOrganisation]);

  useEffect(() => {
    if (isInitialLoading || !syncUrl) return;
    syncChatUrl({
      ...(props.lockOrganisation ? {} : { org: selectedOrgId || null }),
      chat: ghostMode ? null : selectedChatId,
      ...(includeScopeInUrl ? { scope: chatScope } : {}),
      ...(includeOwnerInUrl ? { owner: ownerFilterUserId } : {}),
    });
  }, [
    selectedOrgId,
    selectedChatId,
    chatScope,
    ownerFilterUserId,
    ghostMode,
    isInitialLoading,
    syncUrl,
    syncChatUrl,
    includeScopeInUrl,
    includeOwnerInUrl,
    props.lockOrganisation,
  ]);

  useEffect(() => {
    if (isInitialLoading) return;
    void refreshOrgMembers();
  }, [isInitialLoading, refreshOrgMembers]);

  useEffect(() => {
    if (isInitialLoading || (!props.seoMode && !isSeoChat)) return;
    void refreshSeoTasks();
  }, [isInitialLoading, props.seoMode, isSeoChat, refreshSeoTasks]);

  useEffect(() => {
    if (isInitialLoading) return;
    refreshChats();
    refreshAgents();
  }, [
    selectedOrgId,
    showArchived,
    chatScope,
    ownerFilterUserId,
    refreshChats,
    refreshAgents,
    isInitialLoading,
  ]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/dt/user-preferences", { cache: "no-store" });
      const json = (await res.json()) as {
        ok?: boolean;
        preferences?: { showArchivedChats: boolean };
      };
      if (cancelled || !json.ok || !json.preferences) return;
      setShowArchived(json.preferences.showArchivedChats);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2 || ghostMode || !selectedOrgId) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const timer = setTimeout(() => {
      void (async () => {
        setIsSearching(true);
        const isOrgScope = Boolean(props.adminOversight) && chatScope === "org";
        const params = new URLSearchParams({
          org: selectedOrgId,
          scope: props.seoMode && !props.adminOversight ? "mine" : chatScope,
          q,
        });
        if (props.seoMode && !props.adminOversight) params.set("mode", "seo");
        if (isOrgScope) {
          params.set("oversight", "1");
          if (ownerFilterUserId) params.set("owner", ownerFilterUserId);
        }
        if (showArchived) params.set("archived", "1");
        const res = await fetch(`/api/dt/chats/search?${params}`);
        const json = (await res.json()) as {
          ok?: boolean;
          results?: DtChatSearchHit[];
        };
        if (json.ok && json.results) setSearchResults(json.results);
        else setSearchResults([]);
        setIsSearching(false);
      })();
    }, 320);

    return () => clearTimeout(timer);
  }, [searchQuery, selectedOrgId, showArchived, ghostMode, chatScope, props.seoMode, props.adminOversight, ownerFilterUserId]);

  const handleToggleArchived = useCallback(
    async (next: boolean) => {
      setShowArchived(next);
      await fetch("/api/dt/user-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showArchivedChats: next }),
      });
      await refreshChats();
    },
    [refreshChats],
  );

  const handleRenameChat = useCallback(
    async (chatId: string, title: string) => {
      const res = await fetch(`/api/dt/chats/${chatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const json = (await res.json()) as { ok?: boolean; message?: string };
      if (!json.ok) {
        setStatus(json.message ?? "Umbenennen fehlgeschlagen.");
        return false;
      }
      setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title } : c)));
      await refreshChats();
      return true;
    },
    [refreshChats],
  );

  const handleArchiveChat = useCallback(
    async (chatId: string, archived: boolean) => {
      const res = await fetch(`/api/dt/chats/${chatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      const json = (await res.json()) as { ok?: boolean; message?: string };
      if (!json.ok) {
        setStatus(json.message ?? "Archivieren fehlgeschlagen.");
        return false;
      }
      if (archived && selectedChatId === chatId) startNewChat();
      await refreshChats();
      return true;
    },
    [refreshChats, selectedChatId],
  );

  const handleShareChat = useCallback(
    async (chatId: string) => {
      const res = await fetch(`/api/dt/chats/${encodeURIComponent(chatId)}/share`, {
        method: "POST",
      });
      const json = (await res.json()) as {
        ok?: boolean;
        chat?: DtChatRow;
        message?: string;
      };
      if (!json.ok) {
        setStatus(json.message ?? "Teilen fehlgeschlagen.");
        return false;
      }
      if (json.chat) {
        setChats((prev) => prev.map((c) => (c.id === chatId ? json.chat! : c)));
      }
      setStatus(json.message ?? "Chat mit dem Team geteilt.");
      void refreshChats();
      return true;
    },
    [refreshChats],
  );

  const clearComposerAttachments = useCallback(() => {
    setAttachments((prev) => {
      prev.forEach(revokeDtDraftPreview);
      return [];
    });
  }, []);

  const startNewChat = () => {
    abortRef.current?.abort();
    if (!ghostMode) {
      setSelectedChatId(null);
      writeDtLastChatId(null);
      syncChatUrl({ chat: null });
    }
    setMessages([]);
    setAttachmentsByMessage(new Map());
    setPrompt("");
    clearComposerAttachments();
    setStatus(null);
    setMobileSidebarOpen(false);
    if (props.seoMode) {
      const seoAdvisorId = pickSeoAdvisorAgentId(agents);
      if (seoAdvisorId) setSelectedAgentId(seoAdvisorId);
    }
  };

  const handleGhostToggle = (next: boolean) => {
    if (!next && ghostMode && messages.length > 0) {
      const ok = window.confirm(
        "Ghost-Modus beenden? Der sichtbare Verlauf wird gelöscht und nicht wiederhergestellt.",
      );
      if (!ok) return;
    }
    if (next) {
      abortRef.current?.abort();
      setSelectedChatId(null);
      writeDtLastChatId(null);
      setMessages([]);
      setAttachmentsByMessage(new Map());
    } else {
      startNewChat();
      void refreshChats();
    }
    setGhostMode(next);
    setStatus(null);
  };

  const handleSelectChat = async (chatId: string) => {
    if (ghostMode) return;
    if (chatId === selectedChatId) {
      setMobileSidebarOpen(false);
      return;
    }
    setSelectedChatId(chatId);
    setStatus(null);
    setMobileSidebarOpen(false);
    syncChatUrl({ chat: chatId });
    await loadChat(chatId);
  };

  const handleDeleteChat = async (chatId: string) => {
    if (ghostMode) return;
    if (!window.confirm("Diesen Chat wirklich löschen?")) return;
    const res = await fetch(`/api/dt/chats/${chatId}`, { method: "DELETE" });
    const json = (await res.json()) as { ok?: boolean; message?: string };
    if (!json.ok) {
      setStatus(json.message ?? "Löschen fehlgeschlagen.");
      return;
    }
    if (selectedChatId === chatId) startNewChat();
    await refreshChats();
  };

  const processFiles = async (files: File[]) => {
    if (files.length === 0) return;
    if (attachments.length >= DT_MAX_ATTACHMENTS) {
      setStatus(`Höchstens ${DT_MAX_ATTACHMENTS} Anhänge pro Nachricht.`);
      return;
    }
    const slots = DT_MAX_ATTACHMENTS - attachments.length;
    const drafts: DtAttachmentDraft[] = [];
    for (const f of files) {
      if (drafts.length >= slots) break;
      const result = await fileToDtAttachmentDraft(f);
      if (!result.ok) {
        setStatus(result.message);
        continue;
      }
      drafts.push(result.draft);
    }
    if (drafts.length === 0) return;
    setAttachments((prev) => [...prev, ...drafts.slice(0, slots)]);
  };

  const ensureChatId = async (): Promise<string | null> => {
    if (ghostMode) return null;
    if (selectedChatId) return selectedChatId;
    if (!selectedOrgId || !selectedAgentId) {
      setStatus("Bitte Organisation und Agent wählen.");
      return null;
    }
    const res = await fetch("/api/dt/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationId: selectedOrgId,
        agentId: selectedAgentId,
        mode: chatModeForCreate,
        title: chatScope === "team" ? "Team-Chat" : "Neuer Chat",
      }),
    });
    const json = (await res.json()) as { ok?: boolean; chat?: DtChatRow; message?: string };
    if (!json.ok || !json.chat?.id) {
      setStatus(json.message ?? "Chat konnte nicht erstellt werden.");
      return null;
    }
    setSelectedChatId(json.chat.id);
    setChats((prev) => [json.chat!, ...prev]);
    writeDtLastChatId(json.chat.id);
    return json.chat.id;
  };

  const handleSend = async () => {
    const text = prompt.trim();
    if ((!text && attachments.length === 0) || isBusy) return;
    if (!selectedAgentId) {
      setStatus("Bitte einen Agenten wählen.");
      return;
    }

    const outgoingAttachments = [...attachments];
    const previewCleanup = outgoingAttachments
      .map((a) => a.previewObjectUrl)
      .filter((u): u is string => Boolean(u));

    const optimisticId = `tmp-${Date.now()}`;
    const optimistic: DtChatMessageItem = {
      id: optimisticId,
      role: "user",
      content: text || "(Anhang)",
      metadata: {
        attachments: outgoingAttachments.map((a) => ({
          fileName: a.fileName,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          ...(a.previewObjectUrl ? { previewUrl: a.previewObjectUrl } : {}),
        })),
      },
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setPrompt("");
    clearComposerAttachments();
    setIsBusy(true);
    setStatus(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (ghostMode) {
        const history = messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }));

        const res = await fetch("/api/dt/ghost/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organisationId: selectedOrgId,
            agentId: selectedAgentId,
            content: text,
            history,
            attachments: outgoingAttachments,
            textMode,
          }),
          signal: controller.signal,
        });
        const json = (await res.json()) as {
          ok?: boolean;
          assistantMessage?: DtChatMessageItem;
          via?: string;
          message?: string;
        };
        if (!json.ok) {
          setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
          setStatus(json.message ?? "Antwort fehlgeschlagen.");
          return;
        }
        setMessages((prev) => {
          const next = prev.filter((m) => m.id !== optimisticId);
          next.push(optimistic);
          if (json.assistantMessage) next.push(json.assistantMessage);
          return next;
        });
        return;
      }

      const chatId = await ensureChatId();
      if (!chatId) {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        return;
      }

      const res = await fetch(`/api/dt/chats/${chatId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: text,
          attachments: outgoingAttachments,
          ghostMode: false,
          textMode,
        }),
        signal: controller.signal,
      });
      const json = (await res.json()) as {
        ok?: boolean;
        userMessage?: DtChatMessageItem;
        assistantMessage?: DtChatMessageItem;
        titleSuggestion?: string | null;
        via?: string;
        message?: string;
      };

      if (!json.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        setStatus(json.message ?? "Antwort fehlgeschlagen.");
        return;
      }

      setMessages((prev) => {
        const next = prev.filter((m) => m.id !== optimisticId);
        if (json.userMessage) {
          next.push(json.userMessage);
        } else {
          next.push({ ...optimistic, id: `user-${Date.now()}` });
        }
        if (json.assistantMessage) next.push(json.assistantMessage);
        return next;
      });

      if (json.titleSuggestion) {
        setChats((prev) =>
          prev.map((c) => (c.id === chatId ? { ...c, title: json.titleSuggestion! } : c)),
        );
      } else {
        setChats((prev) =>
          prev.map((c) =>
            c.id === chatId ? { ...c, updated_at: new Date().toISOString() } : c,
          ),
        );
      }

      void refreshChats();
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setStatus("Antwort gestoppt.");
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        setStatus("Netzwerkfehler — bitte erneut versuchen.");
      }
    } finally {
      for (const u of previewCleanup) URL.revokeObjectURL(u);
      setIsBusy(false);
      abortRef.current = null;
    }
  };

  const handleSelectAgent = useCallback(
    async (agentId: string) => {
      if (agentId === selectedAgentId || isBusy) return;

      if (!selectedChatId || ghostMode) {
        setSelectedAgentId(agentId);
        return;
      }

      const previousAgentId = selectedAgentId;
      setSelectedAgentId(agentId);

      const res = await fetch(`/api/dt/chats/${encodeURIComponent(selectedChatId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId }),
      });
      const json = (await res.json()) as { ok?: boolean; message?: string; chat?: DtChatRow };

      if (!res.ok || !json.ok) {
        setSelectedAgentId(previousAgentId);
        setStatus(json.message ?? "Agent konnte nicht gewechselt werden.");
        return;
      }

      setChats((prev) =>
        prev.map((c) =>
          c.id === selectedChatId ? { ...c, agent_id: agentId } : c,
        ),
      );
    },
    [selectedAgentId, selectedChatId, ghostMode, isBusy],
  );

  const chatGptLayout = Boolean(props.embedded);
  const showMarketingHeader = chatGptLayout && !props.chromeless;
  const chromelessLayout = chatGptLayout && Boolean(props.chromeless);
  const sidebarTopClass = chromelessLayout ? "top-0" : "top-[4.25rem]";

  const sidebarNode = (
    <DtChatSidebar
      flush={chatGptLayout}
      onClose={chatGptLayout ? () => setMobileSidebarOpen(false) : undefined}
      compact={props.fillHeight || props.seoMode || props.adminOversight}
      organisations={props.organisations}
      selectedOrgId={selectedOrgId}
      hideOrgSelector={props.lockOrganisation}
      onOrgChange={(id) => {
        if (props.lockOrganisation) return;
        setSelectedOrgId(id);
        writeSelectedOrganisationId(id);
        setSearchQuery("");
        setOwnerFilterUserId(null);
        setChats([]);
        syncChatUrl({ org: id, chat: null, owner: null });
        startNewChat();
      }}
      chats={ghostMode ? [] : chats}
      selectedChatId={ghostMode ? null : selectedChatId}
      onSelectChat={handleSelectChat}
      onNewChat={startNewChat}
      onDeleteChat={handleDeleteChat}
      onRenameChat={handleRenameChat}
      onShareChat={handleShareChat}
      currentUserId={props.currentUserId ?? null}
      onArchiveChat={handleArchiveChat}
      showArchived={showArchived}
      onToggleArchived={(next) => void handleToggleArchived(next)}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      searchResults={searchResults}
      isSearching={isSearching}
      chatScope={chatScope}
      onChatScopeChange={(scope) => {
        setChatScope(scope);
        setChats([]);
        syncChatUrl({ scope, chat: null });
        startNewChat();
      }}
      hideScopeTabs={props.seoMode && !props.adminOversight}
      showOrgTab={props.adminOversight}
      adminOversight={oversightActive}
      orgMembers={orgMembers}
      ownerFilterUserId={ownerFilterUserId}
      onOwnerFilterChange={(userId) => {
        setOwnerFilterUserId(userId);
        setChats([]);
        syncChatUrl({ owner: userId, chat: null });
        startNewChat();
      }}
      ownerLabels={ownerLabels}
      ghostMode={ghostMode}
      hideFooter={chromelessLayout}
      wunschkundenPanel={
        showWunschkundenPanel ? (
          <DtWunschkundenPanel
            personas={wunschkundePersonas}
            selectedAgentId={selectedAgentId}
            onSelectAgent={(id) => {
              void handleSelectAgent(id);
            }}
          />
        ) : null
      }
    />
  );

  if (props.organisations.length === 0) {
    return (
      <p className="text-sm text-sbkm-ink-600 dark:text-white/70">
        Keine Organisation verfügbar.
      </p>
    );
  }

  return (
    <>
      <DtChatLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          "w-full min-w-0 max-w-full overflow-hidden",
          props.fillHeight
            ? "flex h-full min-h-0 flex-col"
            : "min-h-[calc(100vh-5rem)]",
        )}
      >
        {showMarketingHeader ? (
          <header className="sticky top-0 z-20 flex shrink-0 items-center gap-2 border-b border-sbkm-navy/[0.08] bg-white/45 px-5 py-3 backdrop-blur-[28px] backdrop-saturate-[180%] dark:border-white/10 dark:bg-sbkm-ink-900/55 sm:gap-3 sm:px-8">
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(true)}
                aria-label="Chats öffnen"
                className="inline-grid h-9 w-9 shrink-0 place-items-center rounded-pill text-sbkm-navy transition hover:bg-sbkm-navy/10 dark:text-white dark:hover:bg-white/10 lg:hidden"
              >
                <Menu className="h-[18px] w-[18px]" strokeWidth={2} />
              </button>
              <DtLogo size="sidebar" className="shrink-0" />
            </div>

            <div className="scrollbar-subtle min-w-0 flex-1 overflow-x-auto">
              <DtAgentSwitcher
                agents={agents}
                selectedAgentId={selectedAgentId}
                onSelect={(id) => void handleSelectAgent(id)}
                disabled={isBusy}
                manageAgentsHref={
                  canManageAgents ? "/dashboard/verwaltung/agents" : null
                }
                contextHref={contextHref}
              />
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
              <DtChatParticipantsBadge participants={participants} />
              {activeChat?.title && !ghostMode ? (
                <p className="hidden max-w-[8rem] truncate text-xs font-semibold tabular-nums text-sbkm-ink-600 dark:text-white/55 md:block lg:max-w-[12rem]">
                  {activeChat.title}
                </p>
              ) : null}
              <DtThemeToggle />
              {!chromelessLayout ? <DashboardButton /> : null}
              <UserMenu />
            </div>
          </header>
        ) : null}

        <div
          className={cn(
            "flex min-h-0 min-w-0",
            chatGptLayout
              ? "relative min-h-0 flex-1 overflow-hidden"
              : props.fillHeight
                ? "h-full flex-1 flex-col gap-4 overflow-hidden lg:flex-row lg:items-stretch"
                : "grid min-h-0 gap-4 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)] lg:items-stretch",
          )}
        >
          {chatGptLayout ? (
            <>
              <div
                onClick={() => setMobileSidebarOpen(false)}
                aria-hidden
                className={cn(
                  "fixed inset-x-0 bottom-0 z-40 bg-sbkm-navy/30 backdrop-blur-sm transition-opacity duration-300 lg:hidden",
                  sidebarTopClass,
                  mobileSidebarOpen
                    ? "opacity-100"
                    : "pointer-events-none opacity-0",
                )}
              />
              <div
                className={cn(
                  "z-50 flex min-h-0 min-w-0 flex-col",
                  "fixed bottom-0 left-0 w-[86%] max-w-[320px] transition-transform duration-300 ease-dt",
                  sidebarTopClass,
                  mobileSidebarOpen ? "translate-x-0" : "-translate-x-full",
                  "lg:static lg:top-auto lg:z-auto lg:w-[300px] lg:max-w-none lg:translate-x-0 lg:shrink-0",
                )}
              >
                {sidebarNode}
              </div>
            </>
          ) : (
            <div
              className={cn(
                "flex min-h-0 min-w-0 flex-col overflow-hidden",
                props.fillHeight
                  ? "h-full max-h-full w-full shrink-0 lg:h-full lg:max-h-full lg:w-[300px]"
                  : "h-full max-h-full lg:min-h-0",
              )}
            >
              {sidebarNode}
            </div>
          )}

          <main
            className={cn(
              "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
              chatGptLayout
                ? "bg-transparent"
                : "rounded-dt border border-sbkm-navy/10 bg-white/55 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(46,46,80,0.08)] backdrop-blur-xl before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-20 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/25 before:to-transparent dark:border-white/10 dark:bg-white/[0.06] dark:before:via-white/20",
              props.fillHeight && "h-full max-h-full min-h-0",
              !props.fillHeight && "min-h-[680px]",
            )}
          >
            {!chatGptLayout || chromelessLayout ? (
            <header className="relative z-30 flex shrink-0 flex-wrap items-center justify-between gap-3 overflow-visible border-b border-sbkm-navy/10 bg-white/30 px-4 py-2.5 backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.03] sm:px-5 sm:py-3">
              {chromelessLayout ? (
                <button
                  type="button"
                  onClick={() => setMobileSidebarOpen(true)}
                  aria-label="Chats öffnen"
                  className="inline-grid h-9 w-9 shrink-0 place-items-center rounded-pill text-sbkm-navy transition hover:bg-sbkm-navy/10 dark:text-white dark:hover:bg-white/10 lg:hidden"
                >
                  <Menu className="h-[18px] w-[18px]" strokeWidth={2} />
                </button>
              ) : null}
              <DtAgentSwitcher
                agents={agents}
                selectedAgentId={selectedAgentId}
                onSelect={(id) => void handleSelectAgent(id)}
                disabled={isBusy}
                manageAgentsHref={
                  canManageAgents ? "/dashboard/verwaltung/agents" : null
                }
                contextHref={contextHref}
              />
              <div className="ml-auto flex min-w-0 items-center gap-2">
                <DtChatParticipantsBadge participants={participants} />
                {activeChat?.title && !ghostMode ? (
                  <p className="max-w-[10rem] truncate text-xs font-semibold tabular-nums text-sbkm-ink-600 dark:text-white/55 sm:max-w-[14rem]">
                    {activeChat.title}
                  </p>
                ) : null}
              </div>
            </header>
            ) : null}

            <AnimatePresence>{ghostMode ? <DtGhostBanner /> : null}</AnimatePresence>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {isInitialLoading && !ghostMode ? (
                <DtChatSkeleton />
              ) : (
                <DtChatThread
                  messages={messages}
                  isThinking={isBusy}
                  agentName={displayAgentName}
                  agentRole={displayAgentRole}
                  agentDisg={displayAgentDisg}
                  agentEmoji={displayAgentEmoji}
                  teamMode={showChatAuthors}
                  authorLabels={authorLabels}
                  suggestedFollowUps={quickActions}
                  onSuggestedFollowUp={(text) => setPrompt(text)}
                  seoTasks={props.seoMode || isSeoChat ? seoTasks : undefined}
                  emptyHint={
                    ghostMode
                      ? "Probiere etwas aus — nichts wird in der Datenbank gespeichert."
                      : props.adminOversight && chatScope === "org"
                        ? "Alle Chats der Organisation — wähle einen Verlauf, um mitzulesen oder zu antworten."
                        : chatScope === "team"
                          ? "Team-Chat: alle Mitglieder der Organisation sehen diesen Verlauf."
                          : undefined
                  }
                  attachmentsByMessageId={attachmentsByMessage}
                  onImageClick={(src) => setLightboxSrc(src)}
                  onSaveTaskProposal={
                    (props.seoMode || isSeoChat) &&
                    props.onSaveTaskProposal &&
                    selectedChatId
                      ? async (_messageId, proposal) => {
                          const result = await props.onSaveTaskProposal!({
                            organisationId: selectedOrgId,
                            chatId: selectedChatId,
                            messageId: _messageId,
                            proposal,
                          });
                          if (result.ok) {
                            await refreshSeoTasks();
                            setStatus(
                              result.alreadyExists
                                ? "Aufgabe ist bereits im Board."
                                : "Aufgabe gespeichert und dir zugewiesen.",
                            );
                          } else {
                            setStatus(result.message ?? "Aufgabe konnte nicht gespeichert werden.");
                          }
                          return result;
                        }
                      : undefined
                  }
                  onSaveAllTaskProposals={
                    (props.seoMode || isSeoChat) &&
                    props.onSaveAllTaskProposals &&
                    selectedChatId
                      ? async (_messageId, proposals) => {
                          const pending = filterUnsavedSeoTaskProposals({
                            proposals,
                            messageId: _messageId,
                            tasks: seoTasks,
                          });
                          if (pending.length === 0) {
                            return { ok: true, alreadyExists: true };
                          }
                          const result = await props.onSaveAllTaskProposals!({
                            organisationId: selectedOrgId,
                            chatId: selectedChatId,
                            messageId: _messageId,
                            proposals: pending,
                          });
                          if (result.ok) {
                            await refreshSeoTasks();
                            setStatus(
                              pending.length === proposals.length
                                ? `${pending.length} Aufgaben gespeichert und dir zugewiesen.`
                                : `${pending.length} neue Aufgaben gespeichert — übrige waren schon im Board.`,
                            );
                          } else {
                            setStatus(result.message ?? "Aufgaben konnten nicht gespeichert werden.");
                          }
                          return result;
                        }
                      : undefined
                  }
                />
              )}
            </div>

            {status ? (
              <p className="shrink-0 px-6 pb-2 text-sm text-red-600 dark:text-red-400" role="alert">
                {status}
              </p>
            ) : null}

            <DtChatComposer
              value={prompt}
              onChange={setPrompt}
              onSend={handleSend}
              onStop={() => abortRef.current?.abort()}
              isBusy={isBusy}
              quickActions={quickActions}
              disabled={!selectedAgentId || (isInitialLoading && !ghostMode)}
              ghostMode={ghostMode}
              onGhostModeChange={handleGhostToggle}
              textMode={textMode}
              onTextModeChange={setTextMode}
              attachments={attachments}
              onAddFiles={(files) => void processFiles(files)}
              onRemoveAttachment={(index) => {
                setAttachments((prev) => {
                  const copy = [...prev];
                  const removed = copy.splice(index, 1)[0];
                  if (removed) revokeDtDraftPreview(removed);
                  return copy;
                });
              }}
              dropHighlight={dropHighlight}
              onDragHighlight={setDropHighlight}
            />
          </main>
        </div>
      </motion.div>
    </>
  );
}
