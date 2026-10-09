"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/components/dt/cn";
import { contentApi } from "@/components/dt/content/content-api";
import { DtTextarea } from "@/components/dt/dt-field";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { formatContentDate } from "@/lib/dt/content/presentation";
import {
  CONTENT_TYPE_PROMPT_HELP,
  CONTENT_TYPE_PROMPT_KEYS,
  CONTENT_TYPE_PROMPT_LABELS,
  CONTENT_TYPE_PROMPT_MAX_CHARS,
  CONTENT_TYPE_PROMPT_PILLAR_TOKEN,
  hasCustomContentTypePrompts,
  isDefaultContentTypePrompt,
  type ContentTypePrompts,
} from "@/lib/dt/content/type-prompts";
import type { ContentTypePromptsResult } from "@/lib/dt/content/types";

const cardClass =
  "relative overflow-hidden rounded-dt-lg border border-sbkm-navy/10 bg-white/55 shadow-dt backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.05]";

const ENDPOINT = "/api/dt/content/type-prompts";

function samePrompts(a: ContentTypePrompts, b: ContentTypePrompts): boolean {
  return CONTENT_TYPE_PROMPT_KEYS.every((key) => a[key] === b[key]);
}

/**
 * „Textvorlagen“: how the SEO step writes each page type. One set for the whole agency; a
 * page keeps its own type, the recipe only says how that type is written. Finished pages do
 * not change until someone reruns their SEO step.
 */
export function DtContentTypePromptsCard() {
  const [state, setState] = useState<ContentTypePromptsResult | null>(null);
  const [draft, setDraft] = useState<ContentTypePrompts | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);

  const apply = useCallback((next: ContentTypePromptsResult) => {
    setState(next);
    setDraft({ ...next.prompts });
    setError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await contentApi<ContentTypePromptsResult>(ENDPOINT);
      if (cancelled) return;
      if (res.ok) apply(res.data);
      else setError(res.message);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [apply]);

  const dirty = useMemo(() => Boolean(state && draft && !samePrompts(state.prompts, draft)), [state, draft]);
  const custom = state ? hasCustomContentTypePrompts(state.prompts) : false;

  async function save() {
    if (!draft || !dirty || busy) return;
    setBusy("save");
    try {
      const res = await contentApi<ContentTypePromptsResult>(ENDPOINT, { method: "PUT", body: { prompts: draft } });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      apply(res.data);
      toast.success("Textvorlagen gespeichert", {
        description: "Gilt ab dem nächsten SEO-Schritt. Fertige Seiten ändern sich erst, wenn ihr SEO-Schritt neu läuft.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function resetToDefaults() {
    if (busy) return;
    if (!window.confirm("Alle vier Textvorlagen auf den Standard zurücksetzen? Eigene Formulierungen gehen verloren.")) return;
    setBusy("reset");
    try {
      const res = await contentApi<ContentTypePromptsResult>(ENDPOINT, { method: "PUT", body: { reset: true } });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      apply(res.data);
      toast.success("Textvorlagen auf Standard zurückgesetzt");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Textvorlagen" className={cardClass}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent dark:via-white/10" />
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-sbkm-navy/8 px-4 py-3.5 dark:border-white/8 sm:px-5">
        <div className="grid gap-0.5">
          <h2 className="text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">Textvorlagen</h2>
          <p className="text-xs text-sbkm-ink-600 dark:text-white/60">
            Wie der SEO-Schritt die vier Seitentypen schreibt. Gilt für alle Organisationen; jede Seite behält ihren
            eigenen Seitentyp.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {loading ? (
            <Loader2 className="size-4 animate-spin text-sbkm-ink-500" aria-label="Lädt" />
          ) : state ? (
            <span
              className={cn(
                "rounded-pill px-2.5 py-1 text-[11px] font-bold",
                custom
                  ? "bg-sbkm-mint/30 text-sbkm-navy dark:bg-sbkm-mint/20 dark:text-white"
                  : "bg-sbkm-navy/[0.06] text-sbkm-ink-600 dark:bg-white/10 dark:text-white/70",
              )}
            >
              {custom ? "Angepasst" : "Standard"}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="inline-flex h-8 items-center gap-1 rounded-pill px-3 text-xs font-semibold text-sbkm-navy transition-colors hover:bg-sbkm-navy/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 dark:text-white dark:hover:bg-white/10"
          >
            {open ? "Schließen" : "Bearbeiten"}
            <ChevronDown className={cn("size-3.5 transition-transform duration-150", open && "rotate-180")} aria-hidden />
          </button>
        </div>
      </header>

      {!open ? (
        <p className="px-4 py-3 text-xs text-sbkm-ink-600 dark:text-white/60 sm:px-5">
          {error
            ? error
            : state?.updated_at
              ? `Zuletzt geändert ${formatContentDate(state.updated_at)}${state.updated_by_email ? ` von ${state.updated_by_email}` : ""}.`
              : "Noch nie geändert – die Standardvorlagen gelten."}
        </p>
      ) : (
        <div className="grid gap-4 px-4 py-4 sm:px-5">
          {error ? <p className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
          {state?.hint ? (
            <p className="flex items-start gap-2 rounded-lg border border-orange-300/70 bg-orange-50 px-3 py-2 text-xs leading-relaxed text-orange-900 dark:border-orange-400/30 dark:bg-orange-500/10 dark:text-orange-100">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {state.hint}
            </p>
          ) : null}
          <p className="text-xs leading-relaxed text-sbkm-ink-600 dark:text-white/60">
            Die festen Regeln des SEO-Schritts (keine erfundenen Fakten, Anrede, Tonalität, verbotene Wörter, H1,
            Hero-Platzhalter, Platzhalter, Link-Marker) bleiben; die Vorlage sagt nur, wie der jeweilige Seitentyp
            geschrieben wird. „{CONTENT_TYPE_PROMPT_PILLAR_TOKEN}“ wird durch den Namen der übergeordneten Seite ersetzt.
            Fertige Seiten ändern sich erst, wenn ihr SEO-Schritt neu läuft.
          </p>

          <div className="grid gap-4 lg:grid-cols-2">
            {CONTENT_TYPE_PROMPT_KEYS.map((key) => {
              const value = draft?.[key] ?? "";
              const isDefault = isDefaultContentTypePrompt(key, value);
              return (
                <div key={key} className="grid gap-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <label htmlFor={`type-prompt-${key}`} className="text-sm font-semibold text-sbkm-navy dark:text-white">
                      {CONTENT_TYPE_PROMPT_LABELS[key]}
                    </label>
                    <span className="text-[11px] tabular-nums text-sbkm-ink-500 dark:text-white/45">
                      {isDefault ? "Standard · " : ""}
                      {value.length}/{CONTENT_TYPE_PROMPT_MAX_CHARS}
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-sbkm-ink-500 dark:text-white/45">{CONTENT_TYPE_PROMPT_HELP[key]}</p>
                  <DtTextarea
                    id={`type-prompt-${key}`}
                    value={value}
                    maxLength={CONTENT_TYPE_PROMPT_MAX_CHARS}
                    rows={7}
                    disabled={!draft || Boolean(busy)}
                    onChange={(event) => setDraft((prev) => (prev ? { ...prev, [key]: event.target.value } : prev))}
                    className="min-h-[160px] resize-y text-xs leading-relaxed"
                  />
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <DtPillButton type="button" size="sm" disabled={!dirty || Boolean(busy)} onClick={() => void save()}>
              {busy === "save" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Save className="size-3.5" aria-hidden />}
              Speichern
            </DtPillButton>
            <DtPillButton
              type="button"
              size="sm"
              variant="ghost"
              disabled={!dirty || Boolean(busy)}
              onClick={() => state && setDraft({ ...state.prompts })}
            >
              Verwerfen
            </DtPillButton>
            <DtPillButton
              type="button"
              size="sm"
              variant="outline"
              disabled={Boolean(busy) || !state || (!custom && !dirty)}
              onClick={() => void resetToDefaults()}
              className="sm:ml-auto"
            >
              {busy === "reset" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RotateCcw className="size-3.5" aria-hidden />}
              Auf Standard zurücksetzen
            </DtPillButton>
          </div>
          {state?.updated_at ? (
            <p className="text-[11px] text-sbkm-ink-500 dark:text-white/45">
              Zuletzt geändert {formatContentDate(state.updated_at)}
              {state.updated_by_email ? ` von ${state.updated_by_email}` : ""}.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
