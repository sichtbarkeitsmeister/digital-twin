"use client";

import Link from "next/link";
import { FileSearch, Plus } from "lucide-react";

import { cn } from "@/components/dt/cn";
import { DtSelect } from "@/components/dt/dt-select";
import {
  emojiForAgent,
  extractAgentDisg,
  formatAgentSwitcherLabel,
} from "@/lib/dt/agent-display";
import type { DtAgentRow } from "@/lib/dt/types";
import { parseQuickActions } from "@/lib/dt/types";

export type DtAgentOption = Pick<
  DtAgentRow,
  "id" | "name" | "role" | "quick_actions" | "slug" | "kind" | "avatar_data"
>;

const AGENT_DROPDOWN_THRESHOLD = 4;

function AgentMeta(props: { agent: DtAgentOption; compact?: boolean }) {
  const disg = extractAgentDisg(props.agent.avatar_data);
  if (!props.agent.role && !disg) return null;
  return (
    <span
      className={cn(
        "font-normal text-sbkm-ink-600 dark:text-white/60",
        props.compact ? "text-[11px]" : "text-sm",
      )}
    >
      {props.agent.role ? (
        <span>
          {" "}
          · {props.agent.role}
        </span>
      ) : null}
      {disg ? (
        <span className="ml-1 inline-flex items-center rounded-full bg-sbkm-navy/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sbkm-ink-600 dark:bg-white/10 dark:text-white/70">
          {disg}
        </span>
      ) : null}
    </span>
  );
}

export function DtAgentSwitcher(props: {
  agents: DtAgentOption[];
  selectedAgentId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
  manageAgentsHref?: string | null;
  contextHref?: string | null;
}) {
  const manageLink = props.manageAgentsHref ? (
    <Link
      href={props.manageAgentsHref}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-pill border border-sbkm-navy/15 bg-white/60 text-sbkm-navy transition hover:bg-sbkm-mint/20 active:scale-[0.98] dark:border-white/15 dark:bg-white/5 dark:text-white"
      title="Agenten verwalten"
      aria-label="Agenten verwalten"
    >
      <Plus className="h-4 w-4" aria-hidden />
    </Link>
  ) : null;

  const contextLink = props.contextHref ? (
    <Link
      href={props.contextHref}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-pill border border-sbkm-navy/15 bg-white/60 text-sbkm-navy transition hover:bg-sbkm-mint/20 active:scale-[0.98] dark:border-white/15 dark:bg-white/5 dark:text-white"
      title="Agent-Kontext ansehen"
      aria-label="Agent-Kontext ansehen"
    >
      <FileSearch className="h-4 w-4" aria-hidden />
    </Link>
  ) : null;

  const trailingActions = (
    <>
      {contextLink}
      {manageLink}
    </>
  );

  if (props.agents.length <= 1) {
    const a = props.agents[0];
    if (!a) return null;
    return (
      <div className="flex min-w-0 items-center gap-2">
        <p className="min-w-0 truncate text-sm font-semibold text-sbkm-navy dark:text-white">
          <span aria-hidden>{emojiForAgent(a)} </span>
          {a.name}
          <AgentMeta agent={a} />
        </p>
        {manageLink}
        {contextLink}
      </div>
    );
  }

  if (props.agents.length > AGENT_DROPDOWN_THRESHOLD) {
    return (
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <DtSelect
          className="min-w-0 flex-1"
          srLabel="Agent wählen"
          value={props.selectedAgentId}
          onValueChange={props.onSelect}
          triggerClassName={cn(
            "min-w-[12rem] max-w-full",
            props.disabled && "pointer-events-none opacity-60",
          )}
          options={props.agents.map((a) => {
            const disg = extractAgentDisg(a.avatar_data);
            return {
              value: a.id,
              label: formatAgentSwitcherLabel(a),
              description: [a.role, disg].filter(Boolean).join(" · ") || undefined,
            };
          })}
        />
        {trailingActions}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {props.agents.map((a) => {
        const active = a.id === props.selectedAgentId;
        const disg = extractAgentDisg(a.avatar_data);
        return (
          <button
            key={a.id}
            type="button"
            disabled={props.disabled}
            title={[a.name, a.role, disg].filter(Boolean).join(" · ")}
            onClick={() => props.onSelect(a.id)}
            className={cn(
              "inline-flex max-w-full items-center gap-1.5 rounded-pill border px-3 py-1.5 text-xs font-bold transition duration-150 active:scale-[0.98]",
              active
                ? "border-sbkm-mint bg-sbkm-mint text-sbkm-navy shadow-dt"
                : "border-sbkm-navy/15 bg-white/60 text-sbkm-navy hover:bg-sbkm-mint/15 dark:border-white/15 dark:bg-white/5 dark:text-white",
              props.disabled && "pointer-events-none opacity-60",
            )}
          >
            <span aria-hidden>{emojiForAgent(a)}</span>
            <span className="truncate">{a.name}</span>
            {a.role ? (
              <span
                className={cn(
                  "hidden truncate font-medium sm:inline",
                  active ? "text-sbkm-navy/70" : "text-sbkm-ink-600 dark:text-white/55",
                )}
              >
                · {a.role}
              </span>
            ) : null}
            {disg ? (
              <span
                className={cn(
                  "hidden rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide md:inline",
                  active
                    ? "bg-sbkm-navy/10 text-sbkm-navy/80"
                    : "bg-sbkm-navy/5 text-sbkm-ink-600 dark:bg-white/10 dark:text-white/65",
                )}
              >
                {disg}
              </span>
            ) : null}
          </button>
        );
      })}
      {trailingActions}
    </div>
  );
}

export function getQuickActionsForAgent(agent: DtAgentOption | null): string[] {
  if (!agent) return [];
  return parseQuickActions(agent.quick_actions);
}
