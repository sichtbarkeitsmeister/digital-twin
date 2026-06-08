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
  Trash2,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { cn } from "@/components/dt/cn";
import { DtSelect } from "@/components/dt/dt-select";
import { DtChatScopeTabs } from "@/components/dt/chat/dt-chat-scope-tabs";
import type { DtChatListScope } from "@/lib/dt/db";
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
  ghostMode?: boolean;
  compact?: boolean;
  wunschkundenPanel?: React.ReactNode;
}) {
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

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
    <aside className="relative flex h-full max-h-full min-h-0 w-full min-w-0 max-w-full flex-1 flex-col overflow-hidden rounded-dt border border-sbkm-navy/10 bg-white/55 shadow-dt backdrop-blur-xl before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/30 before:to-transparent dark:border-white/10 dark:bg-white/[0.06] dark:before:via-white/15">
      <div className={cn("min-w-0 shrink-0 px-4", props.compact ? "py-3" : "py-4")}>
        {props.compact ? (
          <p className="text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/50">
            Chats
          </p>
        ) : (
          <p className="text-2xl font-bold leading-none tracking-tight text-sbkm-mint">
            digital
            <br />
            <span className="text-sbkm-navy dark:text-white">twin.</span>
          </p>
        )}

        {!props.ghostMode ? (
          <button
            type="button"
            onClick={props.onNewChat}
            className={cn(
              "inline-flex h-10 w-full items-center justify-center gap-2 rounded-pill border border-sbkm-navy/15 bg-white/70 text-sm font-bold text-sbkm-navy transition hover:bg-sbkm-mint/20 active:scale-[0.98] dark:border-white/15 dark:bg-white/5 dark:text-white",
              props.compact ? "mt-2" : "mt-4",
            )}
          >
            <Plus className="h-4 w-4 text-sbkm-mint" aria-hidden />
            Neuer Chat
          </button>
        ) : null}

        <DtSelect
          className="mt-4"
          label="Organisation"
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

        {!props.ghostMode ? (
          <>
            <div className="relative mt-3">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sbkm-ink-500"
                aria-hidden
              />
              <input
                type="search"
                value={props.searchQuery}
                onChange={(e) => props.onSearchQueryChange(e.target.value)}
                placeholder="Chats durchsuchen …"
                className="h-10 w-full rounded-pill border border-sbkm-navy/15 bg-white/80 pl-9 pr-8 text-sm text-sbkm-navy outline-none focus:border-sbkm-mint focus:shadow-dt-focus dark:border-white/15 dark:bg-white/10 dark:text-white"
                aria-label="Chat-Verlauf durchsuchen"
              />
              {props.searchQuery ? (
                <button
                  type="button"
                  aria-label="Suche leeren"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-sbkm-ink-500 hover:bg-sbkm-navy/10"
                  onClick={() => props.onSearchQueryChange("")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>

            {!props.hideScopeTabs ? (
              <DtChatScopeTabs
                scope={props.chatScope}
                onScopeChange={props.onChatScopeChange}
              />
            ) : (
              <p className="mt-3 text-xs text-sbkm-ink-600 dark:text-white/55">
                SEO-Chats sind nur für Organisations-Administratoren sichtbar.
              </p>
            )}

            <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-sbkm-ink-600 dark:text-white/60">
              <input
                type="checkbox"
                checked={props.showArchived}
                onChange={() => props.onToggleArchived(!props.showArchived)}
                className="rounded border-sbkm-navy/20"
              />
              Archivierte anzeigen
            </label>

            {props.wunschkundenPanel}
          </>
        ) : null}
      </div>

      <div
        data-dt-chat-history-scroll
        className="scrollbar-subtle flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain border-t border-sbkm-navy/10 px-4 py-3 dark:border-white/10"
      >
        <p className="text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/50">
          {showSearchResults ? "Suchergebnisse" : "Chat-Verlauf"}
        </p>

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
                    "w-full min-w-0 max-w-full overflow-hidden rounded-xl border px-3 py-2 text-left transition hover:bg-sbkm-mint/10",
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
          <p className="mt-3 text-sm text-sbkm-ink-600 dark:text-white/55">Noch keine Chats.</p>
        ) : (
          <motion.div
            key={`${props.selectedOrgId}-${props.showArchived}-${props.chats.length}`}
            className="mt-3 grid min-w-0 max-w-full gap-2 pb-1"
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
                  className="group relative min-w-0 max-w-full overflow-hidden"
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
                    <button
                      type="button"
                      onClick={() => props.onSelectChat(c.id)}
                      className={cn(
                        "w-full min-w-0 max-w-full overflow-hidden rounded-xl border px-3 py-2 text-left transition hover:bg-sbkm-mint/10",
                        active
                          ? "border-sbkm-mint bg-sbkm-mint/15 shadow-sm"
                          : "border-sbkm-navy/10 bg-white/50 hover:bg-sbkm-mint/10 dark:border-white/10 dark:bg-white/5",
                        isArchived && "opacity-75",
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-1 pr-12">
                        <span
                          className="min-w-0 flex-1 truncate text-sm font-semibold text-sbkm-navy dark:text-white"
                          title={c.title}
                        >
                          {c.title}
                        </span>
                        {c.mode === "team" ? (
                          <span className="shrink-0 text-[10px] font-normal text-sbkm-mint">
                            Team
                          </span>
                        ) : null}
                        {isArchived ? (
                          <span className="shrink-0 text-[10px] font-normal text-sbkm-ink-500">
                            (archiv)
                          </span>
                        ) : null}
                      </div>
                      <p className="tabular-nums text-xs text-sbkm-ink-600 dark:text-white/50">
                        {new Date(c.updated_at).toLocaleDateString("de-DE")}
                      </p>
                    </button>
                  )}
                  {!isEditing ? (
                    <div className="pointer-events-none absolute right-1 top-1 flex gap-0.5 opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                      <button
                        type="button"
                        aria-label="Chat umbenennen"
                        className="rounded p-1 hover:bg-sbkm-navy/10"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingChatId(c.id);
                          setEditTitle(c.title);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5 text-sbkm-navy dark:text-white" />
                      </button>
                      <button
                        type="button"
                        aria-label={isArchived ? "Chat wiederherstellen" : "Chat archivieren"}
                        className="rounded p-1 hover:bg-sbkm-mint/20"
                        onClick={(e) => {
                          e.stopPropagation();
                          void props.onArchiveChat(c.id, !isArchived);
                        }}
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
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onDeleteChat(c.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-600" />
                      </button>
                    </div>
                  ) : null}
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </div>

      <div className="shrink-0 border-t border-sbkm-navy/10 px-4 py-3 dark:border-white/10">
        <Link
          href="/dashboard"
          prefetch
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-pill border border-sbkm-navy/15 bg-white/70 text-sm font-bold text-sbkm-navy transition hover:bg-sbkm-mint/15 dark:border-white/15 dark:bg-white/5 dark:text-white"
        >
          <LayoutDashboard className="h-4 w-4" aria-hidden />
          Dashboard
        </Link>
        <Link
          href="/settings#digital-twin-settings"
          className="mt-2 block text-center text-xs font-semibold text-sbkm-ink-600 underline-offset-2 hover:text-sbkm-navy hover:underline dark:text-white/55"
        >
          DigitalTwin-Einstellungen
        </Link>
      </div>
    </aside>
  );
}
