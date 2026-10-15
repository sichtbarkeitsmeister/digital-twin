"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";

import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_TEXTER_PROMPT, TEXTER_PROMPT_HREF } from "@/lib/dt/content/texter-prompt";

const ENDPOINT = "/api/dt/platform-settings/texter-prompt";

type TexterResponse = {
  ok?: boolean;
  message?: string;
  prompt?: string;
  isDefault?: boolean;
  persisted?: boolean;
};

/**
 * The general text prompt, shown in full. Same card on Texte (above the six templates)
 * and at the top of Globale Prompts, so the text is on the page and not only behind a link.
 */
export function DtTexterPromptCard(props: { placement: "texte" | "global" }) {
  const [saved, setSaved] = useState(DEFAULT_TEXTER_PROMPT);
  const [draft, setDraft] = useState(DEFAULT_TEXTER_PROMPT);
  const [isDefault, setIsDefault] = useState(true);
  const [persisted, setPersisted] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((json: TexterResponse) => {
    if (!json.ok || typeof json.prompt !== "string") {
      setSaved(DEFAULT_TEXTER_PROMPT);
      setDraft(DEFAULT_TEXTER_PROMPT);
      setIsDefault(true);
      setPersisted(false);
      setMessage(json.message ?? "Der Text-Prompt konnte nicht geladen werden. Angezeigt wird der Standard.");
      return;
    }
    setSaved(json.prompt);
    setDraft(json.prompt);
    setIsDefault(json.isDefault !== false);
    setPersisted(json.persisted !== false);
    setMessage(json.persisted === false ? (json.message ?? null) : null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(ENDPOINT, { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as TexterResponse | null;
        if (cancelled) return;
        apply(json ?? { ok: false, message: `Unerwartete Antwort (${res.status}).` });
      } catch {
        if (!cancelled) apply({ ok: false, message: "Keine Verbindung. Angezeigt wird der Standard." });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apply]);

  const dirty = draft.trim() !== saved.trim();

  async function save(next?: string) {
    if (busy || !persisted) return;
    setBusy(true);
    try {
      const res = await fetch(ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: next ?? draft }),
      });
      const json = (await res.json().catch(() => null)) as TexterResponse | null;
      if (!json?.ok || typeof json.prompt !== "string") {
        toast.error(json?.message ?? "Text-Prompt konnte nicht gespeichert werden.");
        return;
      }
      apply(json);
      toast.success(
        json.isDefault
          ? "Text-Prompt auf den Standard zurückgesetzt."
          : "Text-Prompt gespeichert — gilt ab dem nächsten SEO-Schritt.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <DtGlassCard
      id="texter-prompt"
      variant="subtle"
      padding="none"
      className="scroll-mt-24 grid gap-4 p-4 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sbkm-mint/15 text-sbkm-navy dark:text-sbkm-mint">
          <FileText className="size-5" aria-hidden />
        </div>
        <div className="grid gap-0.5">
          <h2 className="font-semibold tracking-tight text-sbkm-navy dark:text-white">Text-Prompt</h2>
          <p className="text-sm text-sbkm-ink-600 dark:text-white/55">
            Allgemeine Regeln für jeden Seitentyp. Die sechs Textvorlagen ergänzen ihn; bei Widerspruch gilt die
            Vorlage. Gilt ab dem nächsten SEO-Schritt.
            {props.placement === "texte" ? (
              <>
                {" "}
                Bearbeiten geht auch unter{" "}
                <Link
                  href={TEXTER_PROMPT_HREF}
                  className="font-semibold text-sbkm-navy underline-offset-2 hover:underline dark:text-sbkm-mint"
                >
                  Globale Prompts
                </Link>
                .
              </>
            ) : (
              <>
                {" "}
                Dieselbe Karte steht auf{" "}
                <Link
                  href="/dashboard/verwaltung/texte"
                  className="font-semibold text-sbkm-navy underline-offset-2 hover:underline dark:text-sbkm-mint"
                >
                  Texte
                </Link>{" "}
                direkt über den Textvorlagen.
              </>
            )}
          </p>
        </div>
        {loading ? <Loader2 className="ml-auto size-4 shrink-0 animate-spin text-sbkm-ink-500" aria-label="Lädt" /> : null}
      </div>
      {message ? (
        <p className="rounded-lg border border-orange-300/70 bg-orange-50 px-3 py-2 text-xs leading-relaxed text-orange-900 dark:border-orange-400/30 dark:bg-orange-500/10 dark:text-orange-100">
          {message}
        </p>
      ) : null}
      <Textarea
        aria-label="Text-Prompt"
        value={draft}
        disabled={loading || busy || !persisted}
        onChange={(event) => setDraft(event.target.value)}
        className="min-h-[320px] font-mono text-sm leading-relaxed"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs tabular-nums text-sbkm-ink-500 dark:text-white/45">
          {isDefault && !dirty ? "Standard · " : ""}
          {draft.length.toLocaleString("de-DE")} Zeichen
        </p>
        <div className="flex flex-wrap gap-2">
          <DtPillButton
            type="button"
            size="sm"
            variant="outline"
            disabled={loading || busy || !persisted || (isDefault && !dirty)}
            onClick={() => {
              if (!window.confirm("Den Text-Prompt auf den Standard zurücksetzen? Eigene Formulierungen gehen verloren.")) return;
              void save("");
            }}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RotateCcw className="size-3.5" aria-hidden />}
            Auf Standard zurücksetzen
          </DtPillButton>
          <DtPillButton type="button" size="sm" disabled={loading || busy || !persisted || !dirty} onClick={() => void save()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Save className="size-3.5" aria-hidden />}
            Text-Prompt speichern
          </DtPillButton>
        </div>
      </div>
    </DtGlassCard>
  );
}
