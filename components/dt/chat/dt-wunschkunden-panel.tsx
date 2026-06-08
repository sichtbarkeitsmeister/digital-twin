"use client";

import { useState } from "react";
import { ChevronDown, Users } from "lucide-react";

import { cn } from "@/components/dt/cn";
import type { DtAgentOption } from "@/components/dt/chat/dt-agent-switcher";

export function DtWunschkundenPanel(props: {
  personas: DtAgentOption[];
  selectedAgentId: string;
  onSelectAgent: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const others = props.personas.filter((a) => a.id !== props.selectedAgentId);

  if (others.length === 0) return null;

  return (
    <div className="mt-4 border-t border-sbkm-navy/10 pt-4 dark:border-white/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/50"
      >
        <span className="inline-flex items-center gap-2">
          <Users className="h-3.5 w-3.5" aria-hidden />
          Wunschkunden
        </span>
        <ChevronDown
          className={cn("h-4 w-4 transition", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open ? (
        <ul className="mt-2 grid gap-2">
          {others.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => props.onSelectAgent(p.id)}
                className="w-full rounded-[12px] border border-sbkm-navy/10 bg-white/50 px-3 py-2 text-left transition hover:border-sbkm-mint/40 hover:bg-sbkm-mint/10 dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/10"
              >
                <p className="text-sm font-semibold text-sbkm-navy dark:text-white">{p.name}</p>
                {p.role ? (
                  <p className="text-xs text-sbkm-ink-600 dark:text-white/55">{p.role}</p>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
