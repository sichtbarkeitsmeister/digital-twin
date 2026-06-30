"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { parseQuickActions } from "@/lib/dt/types";

export type DtAgentFormValues = {
  name: string;
  role: string;
  prompt: string;
  quick: string;
  enabled: boolean;
  position: number;
};

export function DtAgentFormFields(props: {
  values: DtAgentFormValues;
  onChange: (patch: Partial<DtAgentFormValues>) => void;
  disabled?: boolean;
}) {
  const { values, onChange, disabled } = props;
  const inputClass =
    "h-10 w-full rounded-pill border border-sbkm-navy/15 px-3 text-sm disabled:opacity-60 dark:border-white/15 dark:bg-white/5 dark:text-white";

  return (
    <div className="grid gap-3">
      <label className="grid gap-1 text-sm">
        <span className="font-semibold text-sbkm-ink-600 dark:text-white/55">Name</span>
        <input
          value={values.name}
          disabled={disabled}
          onChange={(e) => onChange({ name: e.target.value })}
          className={inputClass}
          placeholder="z. B. Marketing-Berater"
        />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-semibold text-sbkm-ink-600 dark:text-white/55">Rolle</span>
        <input
          value={values.role}
          disabled={disabled}
          onChange={(e) => onChange({ role: e.target.value })}
          className={inputClass}
          placeholder="Kurzbeschreibung für Nutzer"
        />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-semibold text-sbkm-ink-600 dark:text-white/55">System-Prompt</span>
        <Textarea
          value={values.prompt}
          disabled={disabled}
          onChange={(e) => onChange({ prompt: e.target.value })}
          className="min-h-[140px] text-sm"
          placeholder="Wie soll der Agent antworten?"
        />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-semibold text-sbkm-ink-600 dark:text-white/55">
          Schnellaktionen
        </span>
        <Textarea
          value={values.quick}
          disabled={disabled}
          onChange={(e) => onChange({ quick: e.target.value })}
          className="min-h-[80px] text-sm"
          placeholder="Eine Vorschlag-Frage pro Zeile"
        />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-semibold text-sbkm-ink-600 dark:text-white/55">Reihenfolge</span>
        <input
          type="number"
          min={0}
          max={999}
          disabled={disabled}
          value={values.position}
          onChange={(e) => onChange({ position: Number(e.target.value) || 0 })}
          className={`${inputClass} w-24`}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={values.enabled}
          disabled={disabled}
          onCheckedChange={(v) => onChange({ enabled: v === true })}
        />
        <span className="font-semibold text-sbkm-ink-600 dark:text-white/55">Agent aktiv</span>
      </label>
    </div>
  );
}

export function agentFormValuesFromRow(agent: {
  name: string;
  role: string | null;
  prompt_template: string;
  quick_actions: unknown;
  is_enabled: boolean;
  position: number;
}): DtAgentFormValues {
  return {
    name: agent.name,
    role: agent.role ?? "",
    prompt: agent.prompt_template,
    quick: parseQuickActions(agent.quick_actions).join("\n"),
    enabled: agent.is_enabled,
    position: agent.position,
  };
}

export function quickActionsFromForm(quick: string): string[] {
  return quick
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}
