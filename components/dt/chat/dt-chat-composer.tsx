"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ChevronDown,
  ClipboardList,
  Ghost,
  Paperclip,
  PenLine,
  Square,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { DtAttachmentChips } from "@/components/dt/chat/dt-attachment-chips";
import { DtPersonaTestingPanel } from "@/components/dt/chat/dt-persona-testing-panel";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { cn } from "@/components/dt/cn";
import {
  DT_ATTACHMENT_ACCEPT_ATTR,
  DT_MAX_ATTACHMENTS,
} from "@/lib/dt/attachments-shared";
import type { DtAttachmentDraft } from "@/lib/dt/client-attachments";

const iconBtn =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-transparent text-sbkm-navy transition duration-150 hover:border-sbkm-navy/10 hover:bg-sbkm-mint/15 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 disabled:pointer-events-none disabled:opacity-50 dark:text-white dark:hover:border-white/10 dark:hover:bg-white/10";

export function DtChatComposer(props: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop?: () => void;
  isBusy: boolean;
  quickActions: string[];
  /** When true, Schnelltests start collapsed (e.g. after conversation has begun). */
  quickActionsDefaultCollapsed?: boolean;
  disabled?: boolean;
  ghostMode: boolean;
  onGhostModeChange: (next: boolean) => void;
  textMode: boolean;
  onTextModeChange: (next: boolean) => void;
  attachments: DtAttachmentDraft[];
  onAddFiles: (files: File[]) => void;
  onRemoveAttachment: (index: number) => void;
  dropHighlight?: boolean;
  onDragHighlight?: (v: boolean) => void;
  /** Active avatar name for the default placeholder. */
  agentName?: string;
  /** Survey-built persona: show optional Persona-Testing toggle. */
  personaTestingAvailable?: boolean;
  /** Selected agent id — used to load exam questions when testing is on. */
  personaTestingAgentId?: string | null;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [quickActionsOpen, setQuickActionsOpen] = useState(
    () => !props.quickActionsDefaultCollapsed,
  );
  const [personaTesting, setPersonaTesting] = useState(false);
  const canSend =
    (props.value.trim().length > 0 || props.attachments.length > 0) &&
    !props.isBusy &&
    !props.disabled;

  useEffect(() => {
    setQuickActionsOpen(!props.quickActionsDefaultCollapsed);
  }, [props.quickActionsDefaultCollapsed]);

  // Default off when switching agents or when testing is no longer available.
  useEffect(() => {
    setPersonaTesting(false);
  }, [props.personaTestingAgentId, props.personaTestingAvailable]);

  return (
    <div
      className={cn(
        "relative z-10 shrink-0 border-t border-sbkm-navy/10 bg-gradient-to-b from-white/40 to-white/70 px-4 py-3 backdrop-blur-md transition-colors dark:border-white/10 dark:from-white/[0.04] dark:to-white/[0.08] sm:px-6 sm:py-4",
        props.dropHighlight && "from-sbkm-mint/[0.06] to-sbkm-mint/[0.1]",
        props.disabled && !props.isBusy && "opacity-90",
      )}
      onDragEnter={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes("Files")) props.onDragHighlight?.(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        const rel = e.relatedTarget as Node | null;
        if (!e.currentTarget.contains(rel)) props.onDragHighlight?.(false);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(e) => {
        e.preventDefault();
        props.onDragHighlight?.(false);
        const fl = e.dataTransfer.files;
        if (fl?.length) props.onAddFiles(Array.from(fl));
      }}
    >
      <AnimatePresence>
        {props.dropHighlight ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-sbkm-mint/50 bg-sbkm-mint/[0.08] backdrop-blur-[1px]"
            aria-hidden
          >
            <div className="rounded-xl bg-white/90 px-5 py-3 text-center shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(46,46,80,0.08)] dark:bg-sbkm-navy/80">
              <p className="text-sm font-semibold text-sbkm-navy dark:text-white">Dateien ablegen</p>
              <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/60">Loslassen zum Anfügen</p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="mx-auto w-full max-w-3xl">
        {props.personaTestingAvailable && props.personaTestingAgentId && personaTesting ? (
          <DtPersonaTestingPanel
            agentId={props.personaTestingAgentId}
            enabled={personaTesting}
            isBusy={props.isBusy}
            disabled={props.disabled}
            onPickQuestion={(question) => props.onChange(question)}
          />
        ) : null}

        {props.quickActions.length > 0 && !personaTesting ? (
          <div className="mb-2">
            <button
              type="button"
              aria-expanded={quickActionsOpen}
              aria-controls="dt-composer-quick-actions"
              onClick={() => setQuickActionsOpen((open) => !open)}
              className={cn(
                "inline-flex h-8 max-w-full items-center gap-1.5 rounded-pill border px-2.5 text-left transition duration-150 active:scale-[0.98]",
                quickActionsOpen
                  ? "border-sbkm-mint/45 bg-sbkm-mint/10 dark:border-sbkm-mint/30 dark:bg-sbkm-mint/10"
                  : "border-sbkm-navy/12 bg-white/80 hover:border-sbkm-mint/40 hover:bg-sbkm-mint/10 dark:border-white/12 dark:bg-white/5 dark:hover:bg-white/10",
              )}
            >
              <span className="truncate text-xs font-semibold text-sbkm-navy dark:text-white">
                Schnelltests
                <span className="font-medium text-sbkm-ink-500 dark:text-white/50">
                  {" "}
                  · {props.quickActions.length}
                </span>
              </span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-sbkm-ink-500 transition-transform duration-200 dark:text-white/60",
                  quickActionsOpen && "rotate-180",
                )}
                aria-hidden
              />
            </button>
            <AnimatePresence initial={false}>
              {quickActionsOpen ? (
                <motion.div
                  id="dt-composer-quick-actions"
                  key="quick-actions"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden"
                >
                  <div className="flex flex-wrap gap-1.5 pt-1.5">
                    {props.quickActions.map((label) => (
                      <button
                        key={label}
                        type="button"
                        disabled={props.isBusy || props.disabled}
                        onClick={() => props.onChange(label)}
                        className="rounded-pill border border-sbkm-navy/12 bg-white/75 px-2.5 py-1 text-[11px] font-semibold leading-snug text-sbkm-navy shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition duration-150 hover:-translate-y-px hover:border-sbkm-mint/40 hover:bg-sbkm-mint/12 active:scale-[0.98] disabled:opacity-50 dark:border-white/12 dark:bg-white/5 dark:text-white"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        ) : null}

        <DtAttachmentChips
          attachments={props.attachments}
          onRemove={props.onRemoveAttachment}
          disabled={props.isBusy || props.disabled}
        />

        <div
          className={cn(
            "relative overflow-hidden rounded-2xl border border-sbkm-navy/12 bg-white/90 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(46,46,80,0.06)] transition-[box-shadow,border-color] duration-200 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/35 before:to-transparent focus-within:border-sbkm-mint/45 focus-within:shadow-[0_0_0_3px_rgba(122,255,199,0.18),0_8px_24px_rgba(46,46,80,0.08)] dark:border-white/12 dark:bg-white/[0.07] dark:before:via-white/15 dark:focus-within:border-sbkm-mint/35",
            props.ghostMode && "border-amber-400/25 dark:border-amber-400/20",
            props.textMode && "border-violet-400/25 dark:border-violet-400/20",
            personaTesting && "border-sky-400/25 dark:border-sky-400/20",
            props.disabled && "opacity-60",
          )}
        >
          <textarea
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
            placeholder={
              props.ghostMode
                ? "Ghost-Chat — wird nicht gespeichert …"
                : props.textMode
                  ? "Text-Modus — SEO-Text, der menschlich klingt …"
                  : personaTesting
                    ? `Persona-Testing — Prüfungsfrage an ${props.agentName?.trim() || "die Persona"} …`
                    : `Nachricht an ${props.agentName?.trim() || "deinen DigitalTwin"} …`
            }
            rows={2}
            disabled={props.isBusy || props.disabled}
            className="block max-h-40 min-h-[56px] w-full resize-none border-0 bg-transparent px-4 pb-1 pt-3.5 text-[15px] leading-relaxed text-sbkm-navy placeholder:text-sbkm-ink-500 focus:outline-none focus-visible:ring-0 disabled:cursor-not-allowed dark:text-white dark:placeholder:text-white/40"
            onPaste={(e) => {
              const items = e.clipboardData?.items;
              if (!items) return;
              const imageFiles: File[] = [];
              for (const item of items) {
                if (item.kind === "file" && item.type.startsWith("image/")) {
                  const f = item.getAsFile();
                  if (f) imageFiles.push(f);
                }
              }
              if (imageFiles.length > 0) {
                e.preventDefault();
                props.onAddFiles(imageFiles);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canSend) props.onSend();
              }
            }}
          />

          <div className="flex items-center justify-between gap-2 border-t border-sbkm-navy/8 px-2 py-1.5 dark:border-white/8">
            <div className="flex items-center gap-0.5">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={DT_ATTACHMENT_ACCEPT_ATTR}
                className="hidden"
                onChange={(e) => {
                  const fl = e.currentTarget.files;
                  if (fl?.length) props.onAddFiles(Array.from(fl));
                  e.currentTarget.value = "";
                }}
              />
              <button
                type="button"
                disabled={
                  props.isBusy ||
                  props.disabled ||
                  props.attachments.length >= DT_MAX_ATTACHMENTS
                }
                aria-label="Datei anhängen"
                onClick={() => fileInputRef.current?.click()}
                className={iconBtn}
              >
                <Paperclip className="h-4 w-4" aria-hidden />
              </button>

              <button
                type="button"
                aria-pressed={props.ghostMode}
                aria-label="Ghost-Modus"
                disabled={props.isBusy}
                onClick={() => props.onGhostModeChange(!props.ghostMode)}
                className={cn(
                  iconBtn,
                  "w-auto gap-1.5 px-2.5",
                  props.ghostMode &&
                    "border-amber-400/40 bg-amber-100/90 text-amber-950 hover:bg-amber-100 dark:bg-amber-500/20 dark:text-amber-100 dark:hover:bg-amber-500/25",
                )}
              >
                <Ghost className="h-4 w-4 shrink-0" aria-hidden />
                <span className="hidden text-xs font-bold sm:inline">Ghost</span>
              </button>

              <button
                type="button"
                aria-pressed={props.textMode}
                aria-label="Text-Modus"
                disabled={props.isBusy}
                onClick={() => props.onTextModeChange(!props.textMode)}
                className={cn(
                  iconBtn,
                  "w-auto gap-1.5 px-2.5",
                  props.textMode &&
                    "border-violet-400/40 bg-violet-100/90 text-violet-950 hover:bg-violet-100 dark:bg-violet-500/20 dark:text-violet-100 dark:hover:bg-violet-500/25",
                )}
              >
                <PenLine className="h-4 w-4 shrink-0" aria-hidden />
                <span className="hidden text-xs font-bold sm:inline">Text</span>
              </button>

              {props.personaTestingAvailable && props.personaTestingAgentId ? (
                <button
                  type="button"
                  aria-pressed={personaTesting}
                  aria-label="Persona-Testing"
                  disabled={props.isBusy}
                  title="Prüfungsfragen aus dem Fragebogen ein-/ausblenden"
                  onClick={() => setPersonaTesting((v) => !v)}
                  className={cn(
                    iconBtn,
                    "w-auto gap-1.5 px-2.5",
                    personaTesting &&
                      "border-sky-400/40 bg-sky-100/90 text-sky-950 hover:bg-sky-100 dark:bg-sky-500/20 dark:text-sky-100 dark:hover:bg-sky-500/25",
                  )}
                >
                  <ClipboardList className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="hidden text-xs font-bold sm:inline">Testing</span>
                </button>
              ) : null}
            </div>

            {props.isBusy ? (
              <DtPillButton
                type="button"
                variant="outline"
                size="sm"
                aria-label="Antwort stoppen"
                className="h-9 min-w-9 px-3 active:scale-[0.98]"
                onClick={() => props.onStop?.()}
              >
                <Square className="h-4 w-4 fill-current" />
              </DtPillButton>
            ) : (
              <DtPillButton
                type="button"
                variant="mint"
                size="sm"
                aria-label="Senden"
                disabled={!canSend}
                className="h-9 min-w-9 px-3 active:scale-[0.98]"
                onClick={() => props.onSend()}
              >
                <ArrowUp className="h-4 w-4" />
              </DtPillButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
