"use client";

import {
  Bot,
  Globe,
  LineChart,
  MessageSquareOff,
  MoreHorizontal,
  Pencil,
  Trash2,
  UserRound,
} from "lucide-react";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

import {
  DtAgentFormFields,
  agentFormValuesFromRow,
  type DtAgentFormValues,
} from "@/components/dt/agents/dt-agent-form-fields";
import { DtAgentSurveyCoverageCheck } from "@/components/dt/agents/dt-agent-survey-coverage-check";
import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/dt/cn";
import { DtAgentStatusToggle } from "@/components/dt/agents/dt-agent-status-toggle";
import { agentSupportsPersonaTesting } from "@/lib/dt/persona-testing";

export type DtAgentListItemRow = {
  id: string;
  slug: string;
  name: string;
  role: string | null;
  kind: string;
  is_enabled: boolean;
  position: number;
  prompt_template: string;
  prompt_append: string | null;
  quick_actions: unknown;
  is_default: boolean;
  uses_global_prompt: boolean;
  source_survey_id?: string | null;
  source_survey_response_id?: string | null;
};

function agentIcon(kind: string, slug: string): LucideIcon {
  if (slug === "seo_advisor" || kind === "seo_advisor") return LineChart;
  if (kind === "geo_advisor") return Globe;
  if (kind === "wunschkunde") return UserRound;
  return Bot;
}

function agentKindLabel(kind: string, slug: string): string {
  if (slug === "seo_advisor" || kind === "seo_advisor") return "SEO-Berater";
  switch (kind) {
    case "geo_advisor":
      return "GEO-Berater";
    case "wunschkunde":
      return "Wunschkunde";
    case "persona":
      return "Persona";
    default:
      return "Assistent";
  }
}

function AgentMetaBadges(props: {
  agent: DtAgentListItemRow;
  pendingReview?: boolean;
  /** Prompt wiring badges are internal — only platform admins see them. */
  showPromptBadges?: boolean;
}) {
  return (
    <>
      {props.agent.is_default ? (
        <Badge variant="secondary" className="shrink-0 text-[10px]">
          Standard
        </Badge>
      ) : null}
      {props.showPromptBadges && props.agent.uses_global_prompt ? (
        <Badge
          variant="outline"
          className="shrink-0 border-sbkm-mint/30 text-[10px] text-sbkm-navy/70 dark:text-white/60"
        >
          Global
        </Badge>
      ) : props.showPromptBadges && props.agent.is_default ? (
        <Badge variant="outline" className="shrink-0 text-[10px]">
          Eigener Prompt
        </Badge>
      ) : null}
      {props.showPromptBadges && props.agent.prompt_append?.trim() ? (
        <Badge variant="outline" className="shrink-0 text-[10px]">
          Zusatz
        </Badge>
      ) : null}
      {props.pendingReview ? (
        <Badge variant="secondary" className="shrink-0 text-[10px]">
          In Prüfung
        </Badge>
      ) : null}
      {!props.agent.is_enabled ? (
        <Badge variant="outline" className="shrink-0 text-[10px] opacity-70">
          Inaktiv
        </Badge>
      ) : null}
    </>
  );
}

function AgentActions(props: {
  agent: DtAgentListItemRow;
  busy: boolean;
  canDirectlyEdit: boolean;
  pendingReview?: boolean;
  alwaysOn?: boolean;
  canDisable: boolean;
  onStartEdit: () => void;
  onToggleEnabled: (next: boolean) => void;
  onDeleteChats?: () => void;
  onDelete: () => void;
  onRequestChange: () => void;
  compact?: boolean;
}) {
  if (!props.canDirectlyEdit) {
    return (
      <DtPillButton
        type="button"
        size="sm"
        variant="outline"
        disabled={props.busy || props.pendingReview}
        className="gap-1.5"
        onClick={props.onRequestChange}
      >
        <MoreHorizontal className="size-4" aria-hidden />
        {props.pendingReview ? "Anfrage läuft" : "Änderung vorschlagen"}
      </DtPillButton>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      {props.alwaysOn ? (
        <span className="hidden text-xs font-medium text-sbkm-ink-500 sm:inline dark:text-white/45">
          Immer aktiv
        </span>
      ) : (
        <DtAgentStatusToggle
          enabled={props.agent.is_enabled}
          disabled={
            props.busy || (!props.agent.is_enabled ? false : !props.canDisable)
          }
          label={`${props.agent.name} ${props.agent.is_enabled ? "deaktivieren" : "aktivieren"}`}
          onChange={props.onToggleEnabled}
          compact={props.compact}
        />
      )}
      <DtPillButton
        type="button"
        size="sm"
        variant={props.compact ? "ghost" : "outline"}
        className={cn("gap-1.5", props.compact && "px-2.5")}
        onClick={props.onStartEdit}
        aria-label={`${props.agent.name} bearbeiten`}
      >
        <Pencil className="size-3.5" aria-hidden />
        {!props.compact ? "Bearbeiten" : null}
      </DtPillButton>
      {props.onDeleteChats ? (
        <DtPillButton
          type="button"
          size="sm"
          variant="ghost"
          disabled={props.busy}
          className="px-2.5 text-sbkm-ink-600 hover:bg-sbkm-navy/5 hover:text-sbkm-navy dark:text-white/55 dark:hover:bg-white/10 dark:hover:text-white"
          onClick={props.onDeleteChats}
          aria-label={`Chats von ${props.agent.name} löschen`}
          title={`Chats von „${props.agent.name}" löschen`}
        >
          <MessageSquareOff className="size-4" aria-hidden />
        </DtPillButton>
      ) : null}
      {!props.alwaysOn ? (
        <DtPillButton
          type="button"
          size="sm"
          variant="ghost"
          disabled={props.busy || !props.canDisable}
          className="px-2.5 text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/30"
          onClick={props.onDelete}
          aria-label={`${props.agent.name} entfernen`}
        >
          <Trash2 className="size-4" aria-hidden />
        </DtPillButton>
      ) : null}
    </div>
  );
}

export function DtAgentListItem(props: {
  agent: DtAgentListItemRow;
  index: number;
  busy: boolean;
  canDirectlyEdit: boolean;
  pendingReview?: boolean;
  isEditing: boolean;
  editValues: DtAgentFormValues;
  onEditValuesChange: (patch: Partial<DtAgentFormValues>) => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onToggleEnabled: (next: boolean) => void;
  onDeleteChats?: () => void;
  onDelete: () => void;
  onRequestChange: () => void;
  canDisable: boolean;
  alwaysOn?: boolean;
  globalPromptPreview?: string;
  /** Render as a row inside a divided list (no outer card). */
  compact?: boolean;
  /** Hide bottom border on last row in a divided list. */
  isLast?: boolean;
}) {
  const { agent } = props;
  const Icon = agentIcon(agent.kind, agent.slug);

  if (props.isEditing) {
    return (
      <motion.div
        layout="position"
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className={cn(
          "bg-sbkm-mint/[0.04] p-4 sm:p-5",
          props.compact && !props.isLast && "border-b border-sbkm-navy/8 dark:border-white/8",
        )}
      >
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-sbkm-navy dark:text-white">
          <Pencil className="size-4 text-sbkm-mint" aria-hidden />
          {agent.name} bearbeiten
        </div>
        <DtAgentFormFields
          values={props.editValues}
          onChange={props.onEditValuesChange}
          disabled={props.busy}
          supportsGlobalSync={agent.is_default}
          supportsAppend={agent.is_default}
          globalPromptPreview={props.globalPromptPreview}
          hideEnabled={props.alwaysOn}
        />
        {props.canDirectlyEdit && agentSupportsPersonaTesting(agent) ? (
          <DtAgentSurveyCoverageCheck
            className="mt-4"
            agentId={agent.id}
            agentName={agent.name}
            available
            disabled={props.busy}
            promptTemplate={props.editValues.prompt}
            promptAppend={props.editValues.promptAppend}
            onInsertIntoPrompt={(insertion) => {
              const target = props.editValues.usesGlobalPrompt ? "promptAppend" : "prompt";
              const current =
                target === "promptAppend"
                  ? props.editValues.promptAppend
                  : props.editValues.prompt;
              props.onEditValuesChange({
                [target]: `${current.trimEnd()}${insertion}`,
              });
            }}
          />
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <DtPillButton type="button" size="sm" disabled={props.busy} onClick={props.onSaveEdit}>
            Speichern
          </DtPillButton>
          <DtPillButton type="button" size="sm" variant="ghost" onClick={props.onCancelEdit}>
            Abbrechen
          </DtPillButton>
        </div>
      </motion.div>
    );
  }

  const rowContent = (
    <div
      className={cn(
        "flex flex-col gap-3 px-4 py-3.5 transition-colors sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-4",
        !agent.is_enabled && "opacity-80",
        props.compact && "hover:bg-white/30 dark:hover:bg-white/[0.02]",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg sm:size-10 sm:rounded-xl",
            agent.is_enabled
              ? "bg-sbkm-mint/20 text-sbkm-navy dark:bg-sbkm-mint/15 dark:text-sbkm-mint"
              : "bg-sbkm-navy/5 text-sbkm-ink-500 dark:bg-white/5 dark:text-white/40",
          )}
        >
          <Icon className="size-4 sm:size-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white sm:text-base">
              {agent.name}
            </p>
            <AgentMetaBadges
              agent={agent}
              pendingReview={props.pendingReview}
              showPromptBadges={props.canDirectlyEdit}
            />
          </div>
          <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/55 sm:text-sm">
            {agent.role ?? agentKindLabel(agent.kind, agent.slug)}
          </p>
        </div>
      </div>
      <AgentActions
        agent={agent}
        busy={props.busy}
        canDirectlyEdit={props.canDirectlyEdit}
        pendingReview={props.pendingReview}
        alwaysOn={props.alwaysOn}
        canDisable={props.canDisable}
        onStartEdit={props.onStartEdit}
        onToggleEnabled={props.onToggleEnabled}
        onDeleteChats={props.onDeleteChats}
        onDelete={props.onDelete}
        onRequestChange={props.onRequestChange}
        compact={props.compact}
      />
    </div>
  );

  if (props.compact) {
    return (
      <div
        className={cn(!props.isLast && "border-b border-sbkm-navy/8 dark:border-white/8")}
      >
        {rowContent}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: props.index * 0.04 }}
    >
      <DtGlassCard
        variant="subtle"
        padding="none"
        className={cn(
          "relative overflow-hidden transition-shadow duration-200 hover:shadow-dt-hover",
          !agent.is_enabled && "opacity-75",
        )}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent dark:via-white/10" />
        {rowContent}
      </DtGlassCard>
    </motion.div>
  );
}

export { agentFormValuesFromRow };
