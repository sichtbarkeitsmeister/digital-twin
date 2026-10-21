"use client";

import { useState } from "react";
import { Blend, Loader2 } from "lucide-react";

import { DtPillButton } from "@/components/dt/dt-pill-button";
import { CenteredModal } from "@/components/ui/centered-modal";
import { Checkbox } from "@/components/ui/checkbox";
import { MIX_SOURCES_MAX, MIX_SOURCES_MIN } from "@/lib/dt/agents/mix";

export type DtAgentMixCandidate = { id: string; name: string; role: string | null };

const linkButtonClass =
  "whitespace-nowrap rounded-pill px-2.5 py-1 text-xs font-semibold text-sbkm-navy transition-colors hover:bg-sbkm-navy/5 disabled:opacity-50 dark:text-white dark:hover:bg-white/10";

/**
 * „Mix-Agent“: which Zielgruppen avatars the Mix is built from. Opened by „Mix-Agent erstellen“
 * and „Mix neu erstellen“; remount it (key) per opening so the preselection starts fresh.
 */
export function DtAgentMixDialog(props: {
  open: boolean;
  organisationId: string;
  organisationName: string;
  /** The enabled Zielgruppen avatars except the Mix, in list order. */
  candidates: DtAgentMixCandidate[];
  /** A Mix exists: „Mix neu erstellen“ updates it after a confirmation. */
  rebuild: boolean;
  /** The stored sources of the Mix; null preselects every candidate. */
  preselectedIds: string[] | null;
  onClose: () => void;
  onSaved: (result: { created: boolean }) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => {
    const ids = props.candidates.map((candidate) => candidate.id);
    const stored = props.preselectedIds ? new Set(props.preselectedIds) : null;
    return new Set(stored ? ids.filter((id) => stored.has(id)) : ids);
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const count = selected.size;
  const hint =
    count < MIX_SOURCES_MIN
      ? "Mindestens zwei Zielgruppen-Avatare auswählen."
      : count > MIX_SOURCES_MAX
        ? `Höchstens ${MIX_SOURCES_MAX} Zielgruppen-Avatare auswählen.`
        : null;
  const actionLabel = props.rebuild ? "Mix neu erstellen" : "Mix erstellen";

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function close() {
    if (!busy) props.onClose();
  }

  async function submit() {
    if (busy || hint) return;
    if (props.rebuild && !window.confirm("Der bisherige Mix-Prompt wird ersetzt. Fortfahren?")) return;
    setBusy(true);
    setError(null);
    let json: { ok?: boolean; message?: string; created?: boolean } | null = null;
    try {
      const res = await fetch("/api/dt/agents/mix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organisationId: props.organisationId,
          sourceAgentIds: props.candidates.filter((candidate) => selected.has(candidate.id)).map((candidate) => candidate.id),
        }),
      });
      json = (await res.json().catch(() => null)) as typeof json;
      if (!json) {
        json = {
          ok: false,
          message:
            res.status === 504
              ? "Das Modell hat nicht rechtzeitig geantwortet (Zeitlimit). Bitte erneut versuchen."
              : `Unerwartete Antwort vom Server (${res.status}).`,
        };
      }
    } catch {
      json = { ok: false, message: "Keine Verbindung zum Server. Bitte erneut versuchen." };
    }
    setBusy(false);
    if (!json.ok) {
      setError(json.message ?? "Der Mix konnte nicht erstellt werden.");
      return;
    }
    props.onSaved({ created: Boolean(json.created) });
  }

  const status = busy ? "Der Mix wird erstellt. Das dauert meist ein bis drei Minuten." : hint;
  const footer = (
    <div className="grid gap-3">
      {status ? (
        <p className="text-xs text-sbkm-ink-600 dark:text-white/55" role="status">
          {status}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={close}
          className="rounded-pill px-4 py-2 text-sm font-medium text-sbkm-ink-600 transition-colors hover:bg-sbkm-navy/5 active:scale-[0.98] dark:text-white/60 dark:hover:bg-white/10"
        >
          Abbrechen
        </button>
        <DtPillButton
          type="button"
          className="whitespace-nowrap"
          disabled={busy || Boolean(hint)}
          onClick={() => void submit()}
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Blend className="size-4" aria-hidden />}
          {actionLabel}
        </DtPillButton>
      </div>
    </div>
  );

  return (
    <CenteredModal
      open={props.open}
      onClose={close}
      title="Mix-Agent"
      description={props.organisationName}
      titleId="agent-mix-title"
      closeDisabled={busy}
      bodyClassName="grid gap-4"
      footer={footer}
    >
      <p className="text-sm text-sbkm-ink-600 dark:text-white/60">
        Der Mix ist ein neutraler Interessent, der für alle ausgewählten Zielgruppen gleichzeitig steht. Er entsteht
        aus Name, Rolle und Prompt der Avatare mit dem Prompt „Mix-Avatar“ aus Globale Prompts.
      </p>

      {props.candidates.length === 0 ? (
        <p className="rounded-2xl border border-amber-500/30 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100">
          Diese Organisation hat noch keine aktiven Zielgruppen-Avatare.
        </p>
      ) : (
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium tabular-nums text-sbkm-ink-500 dark:text-white/45">
              {count} von {props.candidates.length} ausgewählt
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className={linkButtonClass}
                disabled={busy}
                onClick={() => setSelected(new Set(props.candidates.map((candidate) => candidate.id)))}
              >
                Alle auswählen
              </button>
              <button type="button" className={linkButtonClass} disabled={busy} onClick={() => setSelected(new Set())}>
                Keine
              </button>
            </div>
          </div>
          <ul className="grid gap-1.5">
            {props.candidates.map((candidate) => (
              <li key={candidate.id}>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-sbkm-navy/8 bg-white/70 px-3 py-2.5 transition-colors hover:border-sbkm-mint/40 dark:border-white/10 dark:bg-white/[0.03]">
                  <Checkbox
                    className="mt-0.5"
                    checked={selected.has(candidate.id)}
                    disabled={busy}
                    onCheckedChange={(value) => toggle(candidate.id, value === true)}
                  />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="text-sm font-semibold text-sbkm-navy dark:text-white">{candidate.name}</span>
                    {candidate.role?.trim() ? (
                      <span className="text-xs text-sbkm-ink-600 dark:text-white/55">{candidate.role.trim()}</span>
                    ) : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </CenteredModal>
  );
}
