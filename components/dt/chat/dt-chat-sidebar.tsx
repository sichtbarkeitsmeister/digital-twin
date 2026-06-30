"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  LayoutDashboard,
  Pencil,
  Plus,
  Search,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { cn } from "@/components/dt/cn";
import { DtSelect } from "@/components/dt/dt-select";
import { DtChatPeopleFilter } from "@/components/dt/chat/dt-chat-people-filter";
import { DtChatScopeTabs } from "@/components/dt/chat/dt-chat-scope-tabs";
import type { DtChatListScope } from "@/lib/dt/db";
import type { DtOversightMember } from "@/lib/dt/oversight";
import type { DtChatRow } from "@/lib/dt/types";

export type DtOrgOption = { id: string; name: string; slug: string | null };

export type DtChatSearchHit = {
  chatId: string;
  title: string;
  snippet: string;
  updatedAt: string;
  archivedAt: string | null;
};

const listVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.02 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 6 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const },
  },
};

export function DtChatSidebar(props: {
  organisations: DtOrgOption[];
  selectedOrgId: string;
  onOrgChange: (id: string) => void;
  chats: DtChatRow[];
  selectedChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onDeleteChat: (id: string) => void;
  onRenameChat: (chatId: string, title: string) => Promise<boolean>;
  onShareChat?: (chatId: string) => Promise<boolean>;
  currentUserId?: string | null;
  onArchiveChat: (chatId: string, archived: boolean) => Promise<boolean>;
  showArchived: boolean;
  onToggleArchived: (next: boolean) => void;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  searchResults: DtChatSearchHit[];
  isSearching: boolean;
  chatScope: DtChatListScope;
  onChatScopeChange: (scope: DtChatListScope) => void;
  hideScopeTabs?: boolean;
  showOrgTab?: boolean;
  adminOversight?: boolean;
  orgMembers?: DtOversightMember[];
  ownerFilterUserId?: string | null;
  onOwnerFilterChange?: (userId: string | null) => void;
  ownerLabels?: Record<string, string>;
  ghostMode?: boolean;
  compact?: boolean;
  /** Full-bleed app look (no floating card) for the ChatGPT-style layout. */
  flush?: boolean;
  /** Mobile drawer close handler (shown only on small screens). */
  onClose?: () => void;
  wunschkundenPanel?: React.ReactNode;
  hideFooter?: boolean;
  /** SEO workspace: org is chosen in the dashboard header. */
  hideOrgSelector?: boolean;
}) {
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const dense = props.compact;

  useEffect(() => {
    if (props.searchQuery.trim()) setSearchOpen(true);
  }, [props.searchQuery]);

  useEffect(() => {
    if (editingChatId) renameInputRef.current?.focus();
  }, [editingChatId]);

  const showSearchResults = props.searchQuery.trim().length >= 2;

  async function commitRename(chatId: string) {
    const next = editTitle.trim();
    setEditingChatId(null);
    if (!next || next.length > 120) return;
    const chat = props.chats.find((c) => c.id === chatId);
    if (chat && chat.title === next) return;
    await props.onRenameChat(chatId, next);
  }

  return (
    <aside
      className={cn(
        "relative flex h-full max-h-full min-h-0 w-full min-w-0 max-w-full flex-1 flex-col overflow-hidden",
        props.flush
          ? "border-r border-sbkm-navy/10 bg-sbkm-canvas/80 shadow-dt-lg backdrop-blur-xl dark:border-white/10 dark:bg-sbkm-ink-900/60 lg:shadow-none"
          : "rounded-dt border border-sbkm-navy/10 bg-white/55 shadow-dt backdrop-blur-xl before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/30 before:to-transparent dark:border-white/10 dark:bg-white/[0.06] dark:before:via-white/15",
      )}
    >
      <div
        className={cn(
          "min-w-0 shrink-0",
          dense ? "px-3 py-2" : "px-4 py-5",
        )}
      >
        {!dense ? (
        <div
          className={cn(
            "flex items-center justify-between gap-2",
            props.flush && "lg:hidden",
          )}
        >
          {props.flush ? (
            <p className="text-xl font-bold leading-none tracking-tight text-sbkm-navy dark:text-white">
              digital<span className="text-sbkm-mint">twin.</span>
            </p>
          ) : (
            <p className="text-2xl font-bold leading-none tracking-tight text-sbkm-mint">
              digital
              <br />
              <span className="text-sbkm-navy dark:text-white">twin.</span>
            </p>
          )}
          {props.onClose ? (
            <button
              type="button"
              onClick={props.onClose}
              aria-label="Seitenleiste schließen"
              className="inline-grid h-9 w-9 shrink-0 place-items-center rounded-pill text-sbkm-navy transition hover:bg-sbkm-navy/10 dark:text-white dark:hover:bg-white/10 lg:hidden"
            >
              <X className="h-5 w-5" strokeWidth={2} />
            </button>
          ) : null}
        </div>
        ) : props.onClose ? (
          <div className="mb-2 flex justify-end lg:hidden">
            <button
              type="button"
              onClick={props.onClose}
              aria-label="Seitenleiste schließen"
              className="inline-grid h-8 w-8 place-items-center rounded-pill text-sbkm-navy transition hover:bg-sbkm-navy/10 dark:text-white dark:hover:bg-white/10"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        ) : null}

        {!props.ghostMode ? (
          dense ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={props.onNewChat}
                className="inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-pill border border-sbkm-navy/15 bg-white/70 text-xs font-bold text-sbkm-navy transition hover:bg-sbkm-mint/20 active:scale-[0.98] dark:border-white/15 dark:bg-white/5 dark:text-white"
              >
                <Plus className="h-3.5 w-3.5 text-sbkm-mint" aria-hidden />
                Neuer Chat
              </button>
              <button
                type="button"
                onClick={() => setSearchOpen((open) => !open)}
                aria-label="Suche einblenden"
                aria-pressed={searchOpen}
                className={cn(
                  "inline-grid h-8 w-8 shrink-0 place-items-center rounded-pill border border-sbkm-navy/15 transition hover:bg-sbkm-mint/15 dark:border-white/15",
                  searchOpen || props.searchQuery
                    ? "border-sbkm-mint/40 bg-sbkm-mint/15 text-sbkm-navy dark:text-white"
                    : "bg-white/70 text-sbkm-ink-600 dark:bg-white/5 dark:text-white/70",
                )}
              >
                <Search className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
          <button
            type="button"
            onClick={props.onNewChat}
            className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-pill border border-sbkm-navy/15 bg-white/70 text-sm font-bold text-sbkm-navy transition hover:bg-sbkm-mint/20 active:scale-[0.98] dark:border-white/15 dark:bg-white/5 dark:text-white"
          >
            <Plus className="h-4 w-4 text-sbkm-mint" aria-hidden />
            Neuer Chat
          </button>
          )
        ) : null}
        {!props.hideOrgSelector ? (
          <DtSelect
            className={dense ? "mt-2" : "mt-5"}
            label={dense ? undefined : "Organisation"}
            srLabel="Organisation"
            size={dense ? "sm" : "default"}
            labelClassName="text-xs font-semibold normal-case tracking-normal text-sbkm-ink-500 dark:text-white/50"
            fullWidth
            menuMaxHeight="max-h-72"
            value={props.selectedOrgId}
            onValueChange={props.onOrgChange}
            options={props.organisations.map((org) => ({
              value: org.id,
              label: org.name,
              description: org.slug ?? undefined,
            }))}
          />
        ) : null}

        {!props.ghostMode ? (
          <>
            <AnimatePresence initial={false}>
              {(dense ? searchOpen : true) ? (
                <motion.div
                  key="chat-search"
                  initial={dense ? { height: 0, opacity: 0 } : false}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={dense ? { height: 0, opacity: 0 } : undefined}
                  transition={{ duration: 0.15 }}
                  className={cn("relative overflow-hidden", dense ? "mt-2" : "mt-4")}
                >
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sbkm-ink-500"
                    aria-hidden
                  />
                  <input
                    type="search"
                    value={props.searchQuery}
                    onChange={(e) => props.onSearchQueryChange(e.target.value)}
                    placeholder="Chats durchsuchen …"
                    className={cn(
                      "w-full rounded-pill border border-sbkm-navy/15 bg-white/80 pl-8 pr-8 text-sbkm-navy outline-none focus:border-sbkm-mint focus:shadow-dt-focus dark:border-white/15 dark:bg-white/10 dark:text-white",
                      dense ? "h-8 text-xs" : "h-10 text-sm",
                    )}
                    aria-label="Chat-Verlauf durchsuchen"
                  />
                  {props.searchQuery ? (
                    <button
                      type="button"
                      aria-label="Suche leeren"
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-sbkm-ink-500 hover:bg-sbkm-navy/10"
                      onClick={() => props.onSearchQueryChange("")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </motion.div>
              ) : null}
            </AnimatePresence>

            {!props.hideScopeTabs || props.showOrgTab ? (
              <DtChatScopeTabs
                scope={props.chatScope}
                onScopeChange={props.onChatScopeChange}
                showOrgTab={props.showOrgTab}
                compact={dense}
              />
            ) : (
              <p className="mt-3 text-xs text-sbkm-ink-600 dark:text-white/55">
                SEO-Chats sind nur für Organisations-Administratoren sichtbar.
              </p>
            )}

            {props.adminOversight && props.orgMembers && props.onOwnerFilterChange ? (
              <DtChatPeopleFilter
                members={props.orgMembers}
                selectedUserId={props.ownerFilterUserId ?? null}
                onChange={props.onOwnerFilterChange}
                compact={dense}
              />
            ) : null}

            {!dense ? (
              <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-xs text-sbkm-ink-600 dark:text-white/60">
                <input
                  type="checkbox"
                  checked={props.showArchived}
                  onChange={() => props.onToggleArchived(!props.showArchived)}
                  className="rounded border-sbkm-navy/20"
                />
                Archivierte anzeigen
              </label>
            ) : null}

            {props.wunschkundenPanel}
          </>
        ) : null}
      </div>

      <div
        data-dt-chat-history-scroll
        className={cn(
          "scrollbar-subtle flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain border-t border-sbkm-navy/10 dark:border-white/10",
          dense ? "px-3 py-2" : "px-4 py-4",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold text-sbkm-ink-500 dark:text-white/50">
            {showSearchResults ? "Suchergebnisse" : "Chat-Verlauf"}
          </p>
          {dense ? (
            <button
              type="button"
              onClick={() => props.onToggleArchived(!props.showArchived)}
              aria-label={props.showArchived ? "Archivierte ausblenden" : "Archivierte anzeigen"}
              aria-pressed={props.showArchived}
              title={props.showArchived ? "Archivierte ausblenden" : "Archivierte anzeigen"}
              className={cn(
                "inline-grid h-7 w-7 shrink-0 place-items-center rounded-pill transition",
                props.showArchived
                  ? "bg-sbkm-mint/20 text-sbkm-navy dark:text-white"
                  : "text-sbkm-ink-500 hover:bg-sbkm-navy/10 dark:text-white/50 dark:hover:bg-white/10",
              )}
            >
              <Archive className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        {props.ghostMode ? (
          <p className="mt-3 text-sm text-sbkm-ink-600 dark:text-white/55">
            Im Ghost-Modus gibt es keinen gespeicherten Verlauf.
          </p>
        ) : showSearchResults ? (
          <div className="mt-3 grid min-w-0 gap-2">
            {props.isSearching ? (
              <p className="text-sm text-sbkm-ink-600 dark:text-white/55">Suche …</p>
            ) : props.searchResults.length === 0 ? (
              <p className="text-sm text-sbkm-ink-600 dark:text-white/55">Keine Treffer.</p>
            ) : (
              props.searchResults.map((hit) => (
                <button
                  key={hit.chatId}
                  type="button"
                  onClick={() => {
                    props.onSearchQueryChange("");
                    props.onSelectChat(hit.chatId);
                  }}
                  className={cn(
                    "w-full min-w-0 max-w-full overflow-hidden rounded-xl border px-3.5 py-3 text-left transition hover:bg-sbkm-mint/10",
                    hit.chatId === props.selectedChatId
                      ? "border-sbkm-mint bg-sbkm-mint/15"
                      : "border-sbkm-navy/10 bg-white/50 dark:border-white/10 dark:bg-white/5",
                  )}
                >
                  <p className="truncate text-sm font-semibold text-sbkm-navy dark:text-white">
                    {hit.title}
                  </p>
                  <p className="line-clamp-2 text-xs text-sbkm-ink-600 dark:text-white/50">
                    {hit.snippet}
                  </p>
                </button>
              ))
            )}
          </div>
        ) : props.chats.length === 0 ? (
          <div className="mt-3 text-center">
            <p className="text-sm font-medium text-sbkm-navy dark:text-white">
              {props.adminOversight
                ? "Noch keine Chats in dieser Organisation"
                : "Noch keine Chats."}
            </p>
            {props.adminOversight ? (
              <p className="mt-1 text-xs text-sbkm-ink-600 dark:text-white/50">
                Wähle einen anderen Tab oder eine andere Person.
              </p>
            ) : null}
          </div>
        ) : (
          <motion.div
            key={`${props.selectedOrgId}-${props.showArchived}-${props.chats.length}`}
            className={cn(
              "grid min-w-0 max-w-full pb-1",
              dense ? "mt-2 gap-1.5" : "mt-4 gap-2.5",
            )}
            variants={listVariants}
            initial="hidden"
            animate="show"
          >
            {props.chats.map((c) => {
              const active = c.id === props.selectedChatId;
              const isEditing = editingChatId === c.id;
              const isArchived = Boolean(c.archived_at);
              return (
                <motion.div
                  key={c.id}
                  variants={itemVariants}
                  className="relative min-w-0 max-w-full overflow-hidden"
                >
                  {isEditing ? (
                    <div className="rounded-xl border border-sbkm-mint bg-white/90 p-2 dark:bg-white/10">
                      <input
                        ref={renameInputRef}
                        value={editTitle}
                        maxLength={120}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void commitRename(c.id);
                          if (e.key === "Escape") setEditingChatId(null);
                        }}
                        onBlur={() => void commitRename(c.id)}
                        className="w-full rounded-lg border border-sbkm-navy/15 px-2 py-1.5 text-sm text-sbkm-navy dark:border-white/15 dark:bg-white/5 dark:text-white"
                      />
                    </div>
                  ) : (
                    <div
                      className={cn(
                        "group/card flex w-full min-w-0 max-w-full items-start gap-1 overflow-hidden rounded-xl border transition hover:bg-sbkm-mint/10",
                        dense ? "px-2.5 py-2" : "px-3.5 py-3",
                        active
                          ? "border-sbkm-mint bg-sbkm-mint/15 shadow-sm"
                          : "border-sbkm-navy/10 bg-white/50 hover:bg-sbkm-mint/10 dark:border-white/10 dark:bg-white/5",
                        isArchived && "opacity-75",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => props.onSelectChat(c.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex min-w-0 items-start gap-1.5">
                          <span
                            className={cn(
                              "min-w-0 flex-1 font-semibold leading-snug text-sbkm-navy dark:text-white",
                              dense
                                ? "truncate text-xs leading-tight"
                                : "text-sm line-clamp-2",
                            )}
                            title={c.title}
                          >
                            {c.title}
                          </span>
                          {c.mode === "team" ? (
                            <span className="shrink-0 text-[10px] font-normal text-sbkm-mint">
                              Team
                            </span>
                          ) : c.mode === "seo" ? (
                            <span className="shrink-0 text-[10px] font-normal text-sbkm-mint">
                              SEO
                            </span>
                          ) : c.shared_to_team_at ? (
                            <span
                              className="shrink-0 text-[10px] font-normal text-sbkm-mint"
                              title="Mit dem Team geteilt"
                            >
                              Geteilt
                            </span>
                          ) : null}
                          {isArchived ? (
                            <span className="shrink-0 text-[10px] font-normal text-sbkm-ink-500">
                              (archiv)
                            </span>
                          ) : null}
                        </div>
                        <div
                          className={cn(
                            "flex flex-wrap items-center gap-x-2 gap-y-0.5",
                            dense ? "mt-1" : "mt-1.5",
                          )}
                        >
                          <p className="tabular-nums text-[10px] text-sbkm-ink-500 dark:text-white/45">
                            {new Date(c.updated_at).toLocaleDateString("de-DE")}
                          </p>
                          {props.adminOversight &&
                          c.owner_user_id &&
                          props.ownerLabels?.[c.owner_user_id] ? (
                            <p className="truncate text-[10px] text-sbkm-ink-500 dark:text-white/45">
                              von {props.ownerLabels[c.owner_user_id]}
                            </p>
                          ) : null}
                        </div>
                      </button>

                      <div className="invisible flex shrink-0 gap-0.5 group-hover/card:visible group-focus-within/card:visible">
                        <button
                          type="button"
                          aria-label="Chat umbenennen"
                          className="rounded p-1 hover:bg-sbkm-navy/10"
                          onClick={() => {
                            setEditingChatId(c.id);
                            setEditTitle(c.title);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5 text-sbkm-navy dark:text-white" />
                        </button>
                        {c.mode === "default" &&
                        !c.shared_to_team_at &&
                        props.currentUserId &&
                        c.owner_user_id === props.currentUserId &&
                        props.onShareChat ? (
                          <button
                            type="button"
                            aria-label="Mit Team teilen"
                            className="rounded p-1 hover:bg-sbkm-mint/20"
                            onClick={() => void props.onShareChat?.(c.id)}
                          >
                            <Share2 className="h-3.5 w-3.5 text-sbkm-mint" />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          aria-label={isArchived ? "Chat wiederherstellen" : "Chat archivieren"}
                          className="rounded p-1 hover:bg-sbkm-mint/20"
                          onClick={() => void props.onArchiveChat(c.id, !isArchived)}
                        >
                          {isArchived ? (
                            <ArchiveRestore className="h-3.5 w-3.5 text-sbkm-navy dark:text-white" />
                          ) : (
                            <Archive className="h-3.5 w-3.5 text-sbkm-navy dark:text-white" />
                          )}
                        </button>
                        <button
                          type="button"
                          aria-label="Chat löschen"
                          className="rounded p-1 hover:bg-red-500/10"
                          onClick={() => props.onDeleteChat(c.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-600" />
                        </button>
                      </div>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </div>

      {!props.hideFooter ? (
      <div
        className={cn(
          "shrink-0 border-t border-sbkm-navy/10 dark:border-white/10",
          dense ? "px-3 py-2" : "px-4 py-4",
        )}
      >
        <Link
          href="/dashboard"
          prefetch
          className={cn(
            "inline-flex w-full items-center justify-center gap-2 rounded-pill border border-sbkm-navy/15 bg-white/70 font-bold text-sbkm-navy transition hover:bg-sbkm-mint/15 dark:border-white/15 dark:bg-white/5 dark:text-white",
            dense ? "h-8 text-xs" : "h-10 text-sm",
          )}
        >
          <LayoutDashboard className={dense ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden />
          Dashboard
        </Link>
        {!dense ? (
        <Link
          href="/settings#digital-twin-settings"
          className="mt-2 block text-center text-xs font-semibold text-sbkm-ink-600 underline-offset-2 hover:text-sbkm-navy hover:underline dark:text-white/55"
        >
          DigitalTwin-Einstellungen
        </Link>
        ) : null}
      </div>
      ) : null}
    </aside>
  );
}
