"use client";

import { useCallback, useEffect, useState } from "react";
import { ListOrdered, Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";

import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { Textarea } from "@/components/ui/textarea";
import {
  CONTENT_STEP_PROMPT_KEYS,
  CONTENT_STEP_PROMPT_MAX_CHARS,
  CONTENT_STEP_PROMPT_META,
  CONTENT_STEP_PROMPT_VARIABLES,
  DEFAULT_CONTENT_STEP_PROMPTS,
  type ContentStepPromptKey,
  type ContentStepPrompts,
} from "@/lib/dt/content/step-prompts";

const ENDPOINT = "/api/dt/platform-settings/content-step-prompts";

type StepPromptsResponse = {
  ok?: boolean;
  message?: string | null;
  prompts?: ContentStepPrompts;
  custom?: Record<ContentStepPromptKey, boolean>;
  persisted?: boolean;
};

const NO_CUSTOM = Object.fromEntries(CONTENT_STEP_PROMPT_KEYS.map((key) => [key, false])) as Record<ContentStepPromptKey, boolean>;

/** `{{name}}` placeholders a text uses, so the card can explain them. */
function usedVariables(text: string): string[] {
  const names = [...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map((m) => m[1]!.toLowerCase());
  return [...new Set(names)].filter((name) => name in CONTENT_STEP_PROMPT_VARIABLES);
}

function StepPromptCard(props: {
  stepKey: ContentStepPromptKey;
  saved: string;
  custom: boolean;
  loading: boolean;
  persisted: boolean;
  onSaved: (json: StepPromptsResponse) => void;
}) {
  const { stepKey } = props;
  const meta = CONTENT_STEP_PROMPT_META[stepKey];
  const [draft, setDraft] = useState(props.saved);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(props.saved);
  }, [props.saved]);

  const dirty = draft.trim() !== props.saved.trim();
  const tooLong = draft.length > CONTENT_STEP_PROMPT_MAX_CHARS;
  const variables = usedVariables(draft);
  const disabled = props.loading || busy || !props.persisted;

  async function save(next?: string) {
    if (busy || !props.persisted) return;
    setBusy(true);
    try {
      const res = await fetch(ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: stepKey, prompt: next ?? draft }),
      });
      const json = (await res.json().catch(() => null)) as StepPromptsResponse | null;
      if (!json?.ok || !json.prompts) {
        toast.error(json?.message ?? `${meta.label}-Prompt konnte nicht gespeichert werden.`);
        return;
      }
      props.onSaved(json);
      toast.success(
        json.custom?.[stepKey]
          ? `${meta.label}-Prompt gespeichert – gilt ab dem nächsten ${meta.label}-Schritt.`
          : `${meta.label}-Prompt auf den Standard zurückgesetzt.`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <DtGlassCard
      id={`schritt-prompt-${stepKey}`}
      variant="subtle"
      padding="none"
      className="scroll-mt-24 grid gap-3 p-4 sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <h3 className="font-semibold tracking-tight text-sbkm-navy dark:text-white">{meta.label}</h3>
          <p className="text-sm text-sbkm-ink-600 dark:text-white/55">{meta.description}</p>
        </div>
        <span className="shrink-0 rounded-pill bg-sbkm-navy/[0.06] px-2 py-0.5 text-[11px] font-bold tabular-nums text-sbkm-ink-600 dark:bg-white/10 dark:text-white/70">
          Schritt {meta.step}
        </span>
      </div>
      <Textarea
        aria-label={`${meta.label}-Prompt`}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        className="min-h-[260px] font-mono text-sm leading-relaxed"
      />
      {variables.length > 0 ? (
        <ul className="grid gap-0.5 text-[11px] leading-relaxed text-sbkm-ink-500 dark:text-white/45">
          {variables.map((name) => (
            <li key={name}>
              <code className="rounded bg-sbkm-navy/5 px-1 dark:bg-white/10">{`{{${name}}}`}</code>{" "}
              {CONTENT_STEP_PROMPT_VARIABLES[name]}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          className={
            tooLong
              ? "text-xs font-semibold tabular-nums text-red-700 dark:text-red-300"
              : "text-xs tabular-nums text-sbkm-ink-500 dark:text-white/45"
          }
        >
          {!props.custom && !dirty ? "Standard · " : ""}
          {draft.length.toLocaleString("de-DE")} / {CONTENT_STEP_PROMPT_MAX_CHARS.toLocaleString("de-DE")} Zeichen
        </p>
        <div className="flex flex-wrap gap-2">
          <DtPillButton
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || (!props.custom && !dirty)}
            onClick={() => {
              if (!window.confirm(`Den ${meta.label}-Prompt auf den Standard zurücksetzen? Eigene Formulierungen gehen verloren.`)) return;
              void save("");
            }}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RotateCcw className="size-3.5" aria-hidden />}
            Auf Standard zurücksetzen
          </DtPillButton>
          <DtPillButton type="button" size="sm" disabled={disabled || !dirty || tooLong} onClick={() => void save()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Save className="size-3.5" aria-hidden />}
            {meta.label}-Prompt speichern
          </DtPillButton>
        </div>
      </div>
    </DtGlassCard>
  );
}

/**
 * The six editable step instructions of Texte (Globale Prompts, under the Text-Prompt).
 * Each card saves on its own; an empty text or „Auf Standard zurücksetzen“ means the
 * built-in instruction. The locked rules, Text-Prompt and Textvorlagen stay in code.
 */
export function DtContentStepPromptCards() {
  const [prompts, setPrompts] = useState<ContentStepPrompts>(DEFAULT_CONTENT_STEP_PROMPTS);
  const [custom, setCustom] = useState<Record<ContentStepPromptKey, boolean>>(NO_CUSTOM);
  const [persisted, setPersisted] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const apply = useCallback((json: StepPromptsResponse) => {
    if (!json.ok || !json.prompts) {
      setPrompts(DEFAULT_CONTENT_STEP_PROMPTS);
      setCustom(NO_CUSTOM);
      setPersisted(false);
      setMessage(json.message ?? "Die Schritt-Prompts konnten nicht geladen werden. Angezeigt werden die Standards.");
      return;
    }
    setPrompts(json.prompts);
    setCustom(json.custom ?? NO_CUSTOM);
    setPersisted(json.persisted !== false);
    setMessage(json.persisted === false ? (json.message ?? null) : null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(ENDPOINT, { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as StepPromptsResponse | null;
        if (cancelled) return;
        apply(json ?? { ok: false, message: `Unerwartete Antwort (${res.status}).` });
      } catch {
        if (!cancelled) apply({ ok: false, message: "Keine Verbindung. Angezeigt werden die Standards." });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apply]);

  return (
    <section id="schritt-prompts" aria-labelledby="schritt-prompts-title" className="scroll-mt-24 grid gap-4">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sbkm-mint/15 text-sbkm-navy dark:text-sbkm-mint">
          <ListOrdered className="size-5" aria-hidden />
        </div>
        <div className="grid max-w-3xl gap-0.5">
          <h2 id="schritt-prompts-title" className="font-semibold tracking-tight text-sbkm-navy dark:text-white">
            Schritt-Prompts für Texte
          </h2>
          <p className="text-sm text-sbkm-ink-600 dark:text-white/55">
            Die Anweisung je Schritt. Der Code hängt danach immer die festen Regeln, die Vorgaben der Organisation
            (Anrede, Branche, Tonalität, verbotene Wörter), Seite, Fakten, Avatar und Anmerkungen sowie das
            Antwortformat an. Leer gespeichert gilt der Standard. Änderungen gelten ab dem nächsten Lauf.
          </p>
        </div>
        {loading ? <Loader2 className="ml-auto size-4 shrink-0 animate-spin text-sbkm-ink-500" aria-label="Lädt" /> : null}
      </div>
      {message ? (
        <p className="rounded-lg border border-orange-300/70 bg-orange-50 px-3 py-2 text-xs leading-relaxed text-orange-900 dark:border-orange-400/30 dark:bg-orange-500/10 dark:text-orange-100">
          {message}
        </p>
      ) : null}
      {CONTENT_STEP_PROMPT_KEYS.map((key) => (
        <StepPromptCard
          key={key}
          stepKey={key}
          saved={prompts[key]}
          custom={custom[key]}
          loading={loading}
          persisted={persisted}
          onSaved={apply}
        />
      ))}
    </section>
  );
}
