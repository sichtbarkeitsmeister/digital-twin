"use client";

import { Plus, Settings2, Sparkles } from "lucide-react";

import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtPillButton } from "@/components/dt/dt-pill-button";

export function DtAgentsSidebar(props: {
  busy: boolean;
  onCreateAgent: () => void;
  onOpenGlobalPrompts: () => void;
}) {
  return (
    <aside className="grid gap-4 lg:sticky lg:top-6 lg:self-start">
      <DtGlassCard variant="subtle" padding="none" className="grid gap-3 p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-sbkm-mint/15 text-sbkm-navy dark:text-sbkm-mint">
            <Plus className="size-4" aria-hidden />
          </div>
          <div>
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

      <DtGlassCard variant="subtle" padding="none" className="grid gap-3 p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-sbkm-navy/5 text-sbkm-navy dark:bg-white/10 dark:text-white">
            <Settings2 className="size-4" aria-hidden />
          </div>
          <div>
            <p className="font-semibold tracking-tight text-sbkm-navy dark:text-white">
              Plattform-Einstellungen
            </p>
            <p className="text-xs text-sbkm-ink-600 dark:text-white/55">
              Gilt für alle Organisationen
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={props.onOpenGlobalPrompts}
          className="flex w-full items-center justify-between gap-3 rounded-dt border border-sbkm-navy/10 bg-white/40 px-3 py-2.5 text-left text-sm transition-colors hover:bg-white/70 dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.07]"
        >
          <span className="flex items-center gap-2 font-medium text-sbkm-navy dark:text-white">
            <Sparkles className="size-4 text-sbkm-mint" aria-hidden />
            Globale Prompts & Checkliste
          </span>
          <span className="text-xs text-sbkm-ink-500 dark:text-white/40">Bearbeiten →</span>
        </button>
      </DtGlassCard>
    </aside>
  );
}
