"use client";

import Link from "next/link";
import { Plus } from "lucide-react";

import { cn } from "@/components/dt/cn";
import { DtSelect } from "@/components/dt/dt-select";
import type { DtAgentRow } from "@/lib/dt/types";
import { parseQuickActions } from "@/lib/dt/types";

export type DtAgentOption = Pick<DtAgentRow, "id" | "name" | "role" | "quick_actions" | "slug" | "kind">;

const AGENT_DROPDOWN_THRESHOLD = 4;

export function DtAgentSwitcher(props: {
  agents: DtAgentOption[];
  selectedAgentId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
  manageAgentsHref?: string | null;
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

  if (props.agents.length <= 1) {
    const a = props.agents[0];
    if (!a) return null;
    return (
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold text-sbkm-navy dark:text-white">
          {a.name}
          {a.role ? (
            <span className="font-normal text-sbkm-ink-600 dark:text-white/60"> · {a.role}</span>
          ) : null}
        </p>
        {manageLink}
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
          options={props.agents.map((a) => ({
            value: a.id,
            label: a.name,
            description: a.role ?? undefined,
          }))}
        />
        {manageLink}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {props.agents.map((a) => {
        const active = a.id === props.selectedAgentId;
        return (
          <button
            key={a.id}
            type="button"
            disabled={props.disabled}
            onClick={() => props.onSelect(a.id)}
            className={cn(
              "rounded-pill border px-3 py-1.5 text-xs font-bold transition duration-150 active:scale-[0.98]",
              active
                ? "border-sbkm-mint bg-sbkm-mint text-sbkm-navy shadow-dt"
                : "border-sbkm-navy/15 bg-white/60 text-sbkm-navy hover:bg-sbkm-mint/15 dark:border-white/15 dark:bg-white/5 dark:text-white",
              props.disabled && "pointer-events-none opacity-60",
            )}
          >
            {a.name}
          </button>
        );
      })}
      {manageLink}
    </div>
  );
}

export function getQuickActionsForAgent(agent: DtAgentOption | null): string[] {
  if (!agent) return [];
  return parseQuickActions(agent.quick_actions);
}
