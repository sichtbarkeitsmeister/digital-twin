"use client";

import { Plus } from "lucide-react";

import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtPillButton } from "@/components/dt/dt-pill-button";

export function DtAgentsSidebar(props: {
  busy: boolean;
  onCreateAgent: () => void;
}) {
  return (
    <aside className="grid min-w-0 gap-4 lg:sticky lg:top-6 lg:self-start">
      <DtGlassCard variant="subtle" padding="none" className="grid gap-3 p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sbkm-mint/15 text-sbkm-navy dark:text-sbkm-mint">
            <Plus className="size-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="font-semibold tracking-tight text-sbkm-navy dark:text-white">
              Neuer Agent
            </p>
            <p className="text-xs text-sbkm-ink-600 dark:text-white/55">
              Leer erstellen oder aus einer Umfrage
            </p>
          </div>
        </div>
        <DtPillButton
          type="button"
          size="sm"
          disabled={props.busy}
          className="w-full justify-center gap-1.5"
          onClick={props.onCreateAgent}
        >
          <Plus className="size-3.5" aria-hidden />
          Agent erstellen
        </DtPillButton>
      </DtGlassCard>
    </aside>
  );
}
