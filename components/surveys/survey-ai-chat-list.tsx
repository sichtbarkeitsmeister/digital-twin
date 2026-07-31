"use client";

import {
  Archive,
  PanelLeftClose,
  Pencil,
  Plus,
  Search,
  Settings2,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type AiChatListItem = {
  id: string;
  title: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export function SurveyAiChatList(props: {
  chats: AiChatListItem[];
  selectedChatId: string | null;
  query: string;
  onQueryChange: (v: string) => void;
  onCreateChat: () => void;
  onSelectChat: (id: string) => void;
  onRenameChat: (id: string) => void;
  onArchiveToggle: (id: string, archived: boolean) => void;
  onDeleteChat: (id: string) => void;
  onToggleSidebar: () => void;
  onOpenChatSettings: (id: string) => void;
  chatSettingsOpenForId: string | null;
}) {
  return (
    <div className="grid h-full min-h-0 min-w-0 grid-rows-[auto_auto_auto_minmax(0,1fr)] border-r border-border/70 bg-muted/35 backdrop-blur">
      <div className="flex items-center justify-between gap-2 p-3">
        <p className="text-sm font-semibold">Chats</p>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={props.onToggleSidebar}
          aria-label="Chat-Liste einklappen"
        >
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>
      <div className="px-3 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-secondary" />
          <Input
            value={props.query}
            onChange={(e) => props.onQueryChange(e.target.value)}
            placeholder="Chat suchen…"
            className="pl-8"
          />
        </div>
      </div>
      <div className="px-3 pb-2">
        <Button
          type="button"
          size="sm"
          className="w-full justify-center gap-1"
          onClick={props.onCreateChat}
        >
          <Plus className="h-4 w-4" />
          Neuer Chat
        </Button>
      </div>
      <div className="scrollbar-subtle min-h-0 min-w-0 overflow-y-auto px-2 pb-2">
        <div className="grid min-w-0 gap-1">
          {props.chats.map((chat) => {
            const selected = props.selectedChatId === chat.id;
            const titleText = chat.title || "Neuer Chat";
            return (
              <div
                key={chat.id}
                className={`relative min-w-0 rounded-2xl border p-2.5 transition ${
                  selected
                    ? "border-primary/35 bg-primary/12 shadow-sm"
                    : "border-border/80 bg-card/80 hover:border-border hover:bg-card"
                }`}
              >
                <button
                  type="button"
                  className="absolute inset-0 z-0 rounded-2xl"
                  onClick={() => props.onSelectChat(chat.id)}
                  aria-label={`Chat öffnen: ${titleText}`}
                />
                <div className="pointer-events-none relative z-10 min-w-0">
                  <p
                    className="truncate text-sm font-medium"
                    title={titleText}
                  >
                    {titleText}
                  </p>
                  <p className="text-[11px] text-secondary">
                    {new Date(chat.updated_at).toLocaleString()}
                  </p>
                </div>
                <div className="relative z-10 mt-2 flex w-full items-center gap-1 pointer-events-none">
                  <Button
                    type="button"
                    size="icon"
                    variant={
                      props.chatSettingsOpenForId === chat.id
                        ? "secondary"
                        : "ghost"
                    }
                    className="pointer-events-auto h-7 w-7 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onOpenChatSettings(chat.id);
                    }}
                    aria-label="Chat-Kontext / Einstellungen"
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="pointer-events-auto h-7 w-7 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onRenameChat(chat.id);
                    }}
                    aria-label="Umbenennen"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="pointer-events-auto h-7 w-7 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onArchiveToggle(chat.id, chat.archived_at === null);
                    }}
                    aria-label="Archivieren umschalten"
                  >
                    <Archive className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="pointer-events-auto h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onDeleteChat(chat.id);
                    }}
                    aria-label="Löschen"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
          {props.chats.length === 0 ? (
            <p className="px-2 py-4 text-xs text-secondary">
              Keine Chats gefunden.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
