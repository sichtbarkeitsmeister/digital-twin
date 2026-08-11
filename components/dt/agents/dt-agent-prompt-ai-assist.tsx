"use client";

import { useState } from "react";
import { Loader2, Sparkles, Check, RotateCcw } from "lucide-react";

import { DtPillButton } from "@/components/dt/dt-pill-button";
import { Textarea } from "@/components/ui/textarea";

export function DtAgentPromptAiAssist(props: {
  organisationId: string;
  agentName: string;
  agentRole: string;
  /** Field being edited. */
  target: "prompt" | "prompt_append";
  currentText: string;
  disabled?: boolean;
  onApply: (next: string) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);

  const targetLabel =
    props.target === "prompt_append"
      ? "Zusätzliche Anweisungen / Avatar-Teil"
      : "System-Prompt";

  async function runRevise() {
    const trimmed = instruction.trim();
    if (!trimmed || busy || props.disabled) return;
    if (props.currentText.trim().length < 20) {
      setError("Prompt ist zu kurz zum Anpassen.");
      return;
    }

    setBusy(true);
    setError(null);
    setPreview(null);

    const res = await fetch("/api/dt/agents/revise-prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organisationId: props.organisationId,
        agentName: props.agentName.trim() || "Persona",
        agentRole: props.agentRole.trim() || null,
        target: props.target,
        currentPrompt: props.currentText,
        instruction: trimmed,
      }),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      revisedPrompt?: string;
      message?: string;
    };
    setBusy(false);

    if (!json.ok || !json.revisedPrompt) {
      setError(json.message ?? "Anpassung fehlgeschlagen.");
      return;
    }

    setPrevious(props.currentText);
    setPreview(json.revisedPrompt);
  }

  function applyPreview() {
    if (!preview) return;
    props.onApply(preview);
    setPreview(null);
    setInstruction("");
    setError(null);
  }

  function undoApply() {
    if (previous == null) return;
    props.onApply(previous);
    setPrevious(null);
  }

  return (
    <div className="grid gap-2 rounded-2xl border border-sbkm-navy/10 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex items-center gap-2 text-sm font-semibold text-sbkm-navy dark:text-white">
        <Sparkles className="size-4 text-sbkm-mint" aria-hidden />
        Prompt mit KI anpassen
      </div>
      <p className="text-xs text-sbkm-ink-600 dark:text-white/55">
        Beschreibe die Änderung für „{targetLabel}“, z. B. „Bitte streiche alle
        Firmen-Details und lass ihn klar als Interessent antworten.“ Wird erst nach
        Übernehmen + Speichern aktiv.
      </p>
      <Textarea
        value={instruction}
        disabled={props.disabled || busy}
        onChange={(e) => setInstruction(e.target.value)}
        className="min-h-[72px] text-sm"
        placeholder='z. B. Bitte passe "WAS DU WEISST" an: keine Ayags-Fakten auswendig…'
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void runRevise();
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <DtPillButton
          type="button"
          size="sm"
          disabled={props.disabled || busy || instruction.trim().length < 3}
          onClick={() => void runRevise()}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
          Anpassen
        </DtPillButton>
        {previous != null && !preview ? (
          <DtPillButton
            type="button"
            size="sm"
            variant="ghost"
            disabled={props.disabled || busy}
            onClick={undoApply}
          >
            <RotateCcw className="size-3.5" aria-hidden />
            Letzte Übernahme rückgängig
          </DtPillButton>
        ) : null}
        <span className="text-[11px] text-sbkm-ink-500 dark:text-white/40">
          ⌘/Ctrl+Enter
        </span>
      </div>

      {error ? (
        <p className="text-xs font-medium text-rose-700 dark:text-rose-300">{error}</p>
      ) : null}

      {preview ? (
        <div className="grid gap-2 rounded-xl border border-sbkm-mint/30 bg-sbkm-mint/10 p-3 dark:bg-sbkm-mint/5">
          <p className="text-xs font-semibold text-sbkm-navy dark:text-white">
            Vorschlag — bitte prüfen
          </p>
          <Textarea
            value={preview}
            onChange={(e) => setPreview(e.target.value)}
            className="min-h-[160px] font-mono text-xs leading-relaxed"
          />
          <div className="flex flex-wrap gap-2">
            <DtPillButton type="button" size="sm" onClick={applyPreview}>
              <Check className="size-3.5" aria-hidden />
              In Formular übernehmen
            </DtPillButton>
            <DtPillButton
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setPreview(null)}
            >
              Verwerfen
            </DtPillButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
