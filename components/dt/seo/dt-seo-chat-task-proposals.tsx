"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, ListPlus, Plus } from "lucide-react";

import { cn } from "@/components/dt/cn";
import type { DtSeoChatTaskProposal } from "@/lib/dt/seo/chat-task-proposals";

const PRIORITY_LABEL: Record<string, string> = {
  low: "Niedrig",
  medium: "Mittel",
  high: "Hoch",
  urgent: "Dringend",
};

function proposalSummary(proposal: DtSeoChatTaskProposal): string {
  const parts: string[] = [];
  if (proposal.keyword) parts.push(proposal.keyword);
  if (proposal.current_status) parts.push(proposal.current_status);
  return parts.join(" · ");
}

export function DtSeoChatTaskProposals(props: {
  proposals: DtSeoChatTaskProposal[];
  initialSavedIndexes?: number[];
  onSave: (proposal: DtSeoChatTaskProposal, index: number) => Promise<{ ok?: boolean; message?: string }>;
  onSaveAll?: (proposals: DtSeoChatTaskProposal[]) => Promise<{ ok?: boolean; message?: string }>;
}) {
  const initialSavedKey = (props.initialSavedIndexes ?? []).join(",");
  const [savedIndexes, setSavedIndexes] = useState<Set<number>>(
    () => new Set(props.initialSavedIndexes ?? []),
  );
  const [busyIndex, setBusyIndex] = useState<number | "all" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSavedIndexes(new Set(props.initialSavedIndexes ?? []));
  }, [initialSavedKey, props.initialSavedIndexes]);

  const pending = useMemo(
    () => props.proposals.filter((_, index) => !savedIndexes.has(index)),
    [props.proposals, savedIndexes],
  );

  if (props.proposals.length === 0) return null;

  async function saveOne(index: number) {
    const proposal = props.proposals[index];
    if (!proposal || savedIndexes.has(index)) return;
    setBusyIndex(index);
    setError(null);
    const result = await props.onSave(proposal, index);
    setBusyIndex(null);
    if (result.ok) {
      setSavedIndexes((prev) => new Set(prev).add(index));
    } else {
      setError(result.message ?? "Speichern fehlgeschlagen.");
    }
  }

  async function saveAll() {
    if (!props.onSaveAll || pending.length === 0) return;
    setBusyIndex("all");
    setError(null);
    const result = await props.onSaveAll(pending);
    setBusyIndex(null);
    if (result.ok) {
      setSavedIndexes(new Set(props.proposals.map((_, index) => index)));
    } else {
      setError(result.message ?? "Speichern fehlgeschlagen.");
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-sbkm-mint/25 bg-sbkm-mint/[0.08] p-3 dark:border-sbkm-mint/20 dark:bg-sbkm-mint/[0.12]">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-sbkm-navy/70 dark:text-white/55">
          Vorgeschlagene Aufgaben ({props.proposals.length})
          {savedIndexes.size > 0 ? (
            <span className="ml-1 font-semibold normal-case tracking-normal text-sbkm-ink-500 dark:text-white/45">
              · {savedIndexes.size} bereits im Board
            </span>
          ) : null}
        </p>
        {pending.length > 1 && props.onSaveAll ? (
          <button
            type="button"
            disabled={busyIndex !== null}
            onClick={() => void saveAll()}
            className="inline-flex items-center gap-1.5 rounded-pill border border-sbkm-mint/35 bg-white/70 px-2.5 py-1 text-[11px] font-bold text-sbkm-navy transition hover:bg-sbkm-mint/15 disabled:opacity-50 dark:border-sbkm-mint/25 dark:bg-white/10 dark:text-white"
          >
            {busyIndex === "all" ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <ListPlus className="h-3 w-3" aria-hidden />
            )}
            Alle {pending.length} speichern
          </button>
        ) : null}
      </div>

      <ul className="grid gap-2">
        {props.proposals.map((proposal, index) => {
          const saved = savedIndexes.has(index);
          const busy = busyIndex === index;
          return (
            <li
              key={`${proposal.title}-${index}`}
              className={cn(
                "rounded-lg border border-sbkm-navy/10 bg-white/70 px-3 py-2.5 dark:border-white/10 dark:bg-white/[0.06]",
                saved && "opacity-70",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-snug text-sbkm-navy dark:text-white">
                    {proposal.title}
                  </p>
                  {proposalSummary(proposal) ? (
                    <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/55">
                      {proposalSummary(proposal)}
                    </p>
                  ) : null}
                  {proposal.url ? (
                    <p className="mt-0.5 truncate text-[11px] text-sbkm-mint">{proposal.url}</p>
                  ) : null}
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-sbkm-ink-600 dark:text-white/50">
                    {proposal.action}
                  </p>
                  {proposal.priority ? (
                    <span className="mt-1.5 inline-flex rounded-pill bg-sbkm-navy/8 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sbkm-navy dark:bg-white/10 dark:text-white/80">
                      {PRIORITY_LABEL[proposal.priority] ?? proposal.priority}
                    </span>
                  ) : null}
                </div>
                {saved ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-pill bg-emerald-600/15 px-2.5 py-1.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                    <Check className="h-3 w-3" aria-hidden />
                    Im Board
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busyIndex !== null}
                    onClick={() => void saveOne(index)}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-pill bg-sbkm-navy px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:bg-sbkm-navy/90 dark:bg-white/15 dark:hover:bg-white/20",
                      busyIndex !== null && !busy && "opacity-50",
                    )}
                  >
                    {busy ? (
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    ) : (
                      <Plus className="h-3 w-3" aria-hidden />
                    )}
                    Speichern
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {error ? (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
