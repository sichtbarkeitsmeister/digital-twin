"use client";

import { useState } from "react";
import { Plus, Sparkles, X } from "lucide-react";

import { DtPillButton } from "@/components/dt/dt-pill-button";
import { cn } from "@/components/dt/cn";

const MAX_QUICK_ACTIONS = 12;

const SUGGESTIONS = [
  "Was bietet ihr an?",
  "Wie läuft die Zusammenarbeit ab?",
  "Welche nächsten Schritte empfiehlst du?",
] as const;

export function DtAgentQuickActionsField(props: {
  actions: string[];
  onChange: (actions: string[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");

  function commitDraft() {
    const next = draft.trim();
    if (!next || props.disabled) return;
    if (props.actions.length >= MAX_QUICK_ACTIONS) return;
    if (props.actions.some((a) => a.toLowerCase() === next.toLowerCase())) {
      setDraft("");
      return;
    }
    props.onChange([...props.actions, next]);
    setDraft("");
  }

  function updateAt(index: number, value: string) {
    const next = [...props.actions];
    next[index] = value;
    props.onChange(next);
  }

  function removeAt(index: number) {
    props.onChange(props.actions.filter((_, i) => i !== index));
  }

  function addSuggestion(text: string) {
    if (props.disabled || props.actions.length >= MAX_QUICK_ACTIONS) return;
    if (props.actions.some((a) => a.toLowerCase() === text.toLowerCase())) return;
    props.onChange([...props.actions, text]);
  }

  const atLimit = props.actions.length >= MAX_QUICK_ACTIONS;
  const inputClass =
    "h-10 w-full rounded-pill border border-sbkm-navy/15 px-3 text-sm disabled:opacity-60 dark:border-white/15 dark:bg-white/5 dark:text-white";

  return (
    <div className="grid gap-3 rounded-2xl border border-sbkm-navy/10 bg-white/40 p-3 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-sbkm-navy dark:text-white">Schnellaktionen</p>
          <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/55">
            Vorschlags-Chips über dem Chat-Eingabefeld — optional
          </p>
        </div>
        <span className="shrink-0 text-xs tabular-nums text-sbkm-ink-500 dark:text-white/40">
          {props.actions.length}/{MAX_QUICK_ACTIONS}
        </span>
      </div>

      <div className="rounded-xl border border-sbkm-navy/8 bg-sbkm-navy/[0.03] p-3 dark:border-white/8 dark:bg-white/[0.02]">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-sbkm-ink-500 dark:text-white/40">
          Vorschau im Chat
        </p>
        {props.actions.some((a) => a.trim()) ? (
          <div className="flex flex-wrap gap-2">
            {props.actions
              .map((a) => a.trim())
              .filter(Boolean)
              .map((label) => (
                <span
                  key={label}
                  className="rounded-pill border border-sbkm-navy/12 bg-white/75 px-3 py-1.5 text-xs font-semibold text-sbkm-navy shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:border-white/12 dark:bg-white/5 dark:text-white"
                >
                  {label}
                </span>
              ))}
          </div>
        ) : (
          <p className="text-xs text-sbkm-ink-500 dark:text-white/40">
            Noch keine Vorschläge — Nutzer sehen dann nur das normale Eingabefeld.
          </p>
        )}
      </div>

      {props.actions.length > 0 ? (
        <ul className="grid gap-2">
          {props.actions.map((action, index) => (
            <li key={`${index}-${action}`} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-center text-xs tabular-nums text-sbkm-ink-500 dark:text-white/40">
                {index + 1}
              </span>
              <input
                value={action}
                disabled={props.disabled}
                onChange={(e) => updateAt(index, e.target.value)}
                className={cn(inputClass, "min-w-0 flex-1")}
                placeholder="Vorschlags-Frage"
                maxLength={200}
              />
              <button
                type="button"
                disabled={props.disabled}
                onClick={() => removeAt(index)}
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-sbkm-ink-500 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/30 dark:hover:text-red-400"
                aria-label={`Schnellaktion ${index + 1} entfernen`}
              >
                <X className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={draft}
          disabled={props.disabled || atLimit}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitDraft();
            }
          }}
          className={cn(inputClass, "min-w-0 flex-1")}
          placeholder={
            atLimit
              ? "Maximum erreicht"
              : "Neue Vorschlags-Frage eingeben …"
          }
          maxLength={200}
        />
        <DtPillButton
          type="button"
          size="sm"
          variant="outline"
          disabled={props.disabled || atLimit || !draft.trim()}
          className="shrink-0 justify-center gap-1.5 sm:min-w-[7.5rem]"
          onClick={commitDraft}
        >
          <Plus className="size-3.5" aria-hidden />
          Hinzufügen
        </DtPillButton>
      </div>

      {props.actions.length === 0 ? (
        <div className="grid gap-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-sbkm-ink-500 dark:text-white/45">
            <Sparkles className="size-3.5 text-sbkm-mint" aria-hidden />
            Ideen zum Einfügen
          </p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                disabled={props.disabled || atLimit}
                onClick={() => addSuggestion(suggestion)}
                className="rounded-pill border border-dashed border-sbkm-navy/15 bg-white/50 px-3 py-1.5 text-xs font-medium text-sbkm-ink-600 transition hover:border-sbkm-mint/40 hover:bg-sbkm-mint/10 hover:text-sbkm-navy disabled:opacity-50 dark:border-white/15 dark:bg-white/[0.03] dark:text-white/60 dark:hover:text-white"
              >
                + {suggestion}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
