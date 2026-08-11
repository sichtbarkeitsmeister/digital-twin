"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { DtAgentPromptAiAssist } from "@/components/dt/agents/dt-agent-prompt-ai-assist";
import { DtAgentQuickActionsField } from "@/components/dt/agents/dt-agent-quick-actions-field";
import { DtAgentStatusToggle } from "@/components/dt/agents/dt-agent-status-toggle";
import { parseQuickActions } from "@/lib/dt/types";

export type DtAgentFormValues = {
  name: string;
  role: string;
  prompt: string;
  promptAppend: string;
  usesGlobalPrompt: boolean;
  quick: string;
  enabled: boolean;
  position: number;
};

export function DtAgentFormFields(props: {
  values: DtAgentFormValues;
  onChange: (patch: Partial<DtAgentFormValues>) => void;
  disabled?: boolean;
  /** Org for AI prompt-assist API. */
  organisationId?: string;
  /** Hide the per-org prompt field (prompt is managed globally). */
  hidePrompt?: boolean;
  /** Replacement copy shown instead of the prompt when it is hidden. */
  promptNote?: string;
  /** Hide the enabled checkbox (agent must stay active). */
  hideEnabled?: boolean;
  /** Show global-sync toggle + conditional prompt UI for default agents. */
  supportsGlobalSync?: boolean;
  /** Show additional instructions textarea (stacked on base prompt). */
  supportsAppend?: boolean;
  /** Global template preview for synced mode / prefill on unsync. */
  globalPromptPreview?: string;
}) {
  const {
    values,
    onChange,
    disabled,
    organisationId,
    hidePrompt,
    promptNote,
    hideEnabled,
    supportsGlobalSync,
    supportsAppend,
    globalPromptPreview,
  } = props;
  const inputClass =
    "h-10 w-full rounded-pill border border-sbkm-navy/15 px-3 text-sm disabled:opacity-60 dark:border-white/15 dark:bg-white/5 dark:text-white";

  function handleGlobalSyncToggle(next: boolean) {
    if (!next && !values.prompt.trim() && globalPromptPreview?.trim()) {
      onChange({ usesGlobalPrompt: false, prompt: globalPromptPreview.trim() });
      return;
    }
    onChange({ usesGlobalPrompt: next });
  }

  const showOwnPrompt = supportsGlobalSync ? !values.usesGlobalPrompt : !hidePrompt;
  const showAppend = Boolean(supportsAppend);
  const assistTarget: "prompt" | "prompt_append" =
    values.usesGlobalPrompt && showAppend ? "prompt_append" : "prompt";
  const assistText =
    assistTarget === "prompt_append" ? values.promptAppend : values.prompt;
  const showAiAssist =
    Boolean(organisationId) &&
    (assistTarget === "prompt" ? showOwnPrompt : showAppend);

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

      {supportsGlobalSync ? (
        <div className="grid gap-3 rounded-2xl border border-sbkm-navy/10 bg-sbkm-mint/5 p-3 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-sbkm-navy dark:text-white">
                Mit globalem Prompt synchronisieren
              </p>
              <p className="text-xs text-sbkm-ink-600 dark:text-white/55">
                Aktiv: globaler Standard-Prompt. Aus: eigener Basis-Prompt für diese
                Organisation.
              </p>
            </div>
            <DtAgentStatusToggle
              enabled={values.usesGlobalPrompt}
              disabled={disabled}
              label="Mit globalem Prompt synchronisieren"
              onChange={handleGlobalSyncToggle}
              compact
            />
          </div>

          {values.usesGlobalPrompt ? (
            <div className="grid gap-1">
              <span className="text-xs font-semibold text-sbkm-ink-600 dark:text-white/55">
                Globaler Basis-Prompt (Vorschau)
              </span>
              <Textarea
                value={globalPromptPreview ?? ""}
                readOnly
                disabled
                className="min-h-[100px] text-xs opacity-80"
              />
              <p className="text-xs text-sbkm-ink-500 dark:text-white/40">
                Bearbeitung unter „Globale Standard-Prompts“.{" "}
                <code className="text-[10px]">{"{{organisation}}"}</code> wird beim Chat
                ersetzt.
              </p>
            </div>
          ) : (
            <label className="grid gap-1 text-sm">
              <span className="font-semibold text-sbkm-ink-600 dark:text-white/55">
                Eigener Basis-Prompt
              </span>
              <Textarea
                value={values.prompt}
                disabled={disabled}
                onChange={(e) => onChange({ prompt: e.target.value })}
                className="min-h-[140px] text-sm"
                placeholder="Wie soll der Agent antworten?"
              />
            </label>
          )}
        </div>
      ) : hidePrompt ? (
        <p className="rounded-2xl border border-sbkm-navy/10 bg-sbkm-mint/10 px-3 py-2 text-xs text-sbkm-ink-600 dark:border-white/10 dark:bg-white/5 dark:text-white/55">
          {promptNote ??
            "Der System-Prompt dieses Agenten wird global verwaltet (siehe „Globale Standard-Prompts“) und gilt für alle Organisationen."}
        </p>
      ) : (
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
      )}

      {showAppend ? (
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-sbkm-ink-600 dark:text-white/55">
            {values.usesGlobalPrompt
              ? "Avatar-spezifisch / Zusätzliche Anweisungen"
              : "Zusätzliche Anweisungen (optional)"}
          </span>
          <Textarea
            value={values.promptAppend}
            disabled={disabled}
            onChange={(e) => onChange({ promptAppend: e.target.value })}
            className="min-h-[100px] text-sm"
            placeholder={
              values.usesGlobalPrompt
                ? "Persönlichkeit, Situation, Sprachstil dieses Wunschkunden."
                : "Ergänzungen nur für diese Organisation — werden auf den Basis-Prompt gelegt."
            }
          />
        </label>
      ) : null}

      {showAiAssist && organisationId ? (
        <DtAgentPromptAiAssist
          organisationId={organisationId}
          agentName={values.name}
          agentRole={values.role}
          target={assistTarget}
          currentText={assistText}
          disabled={disabled}
          onApply={(next) =>
            onChange(
              assistTarget === "prompt_append"
                ? { promptAppend: next }
                : { prompt: next },
            )
          }
        />
      ) : null}

      <DtAgentQuickActionsField
        actions={quickActionsFromForm(values.quick)}
        onChange={(actions) => onChange({ quick: actions.join("\n") })}
        disabled={disabled}
      />
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
      {hideEnabled ? null : (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={values.enabled}
            disabled={disabled}
            onCheckedChange={(v) => onChange({ enabled: v === true })}
          />
          <span className="font-semibold text-sbkm-ink-600 dark:text-white/55">Agent aktiv</span>
        </label>
      )}
    </div>
  );
}

export function agentFormValuesFromRow(agent: {
  name: string;
  role: string | null;
  prompt_template: string;
  prompt_append?: string | null;
  uses_global_prompt?: boolean;
  quick_actions: unknown;
  is_enabled: boolean;
  position: number;
}): DtAgentFormValues {
  return {
    name: agent.name,
    role: agent.role ?? "",
    prompt: agent.prompt_template,
    promptAppend: agent.prompt_append ?? "",
    usesGlobalPrompt: agent.uses_global_prompt ?? false,
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
