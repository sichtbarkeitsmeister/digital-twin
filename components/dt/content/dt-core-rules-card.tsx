"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ListChecks, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { Textarea } from "@/components/ui/textarea";
import { CONTENT_CORE_RULES_MAX_CHARS } from "@/lib/dt/content/core-rules";

const ENDPOINT = "/api/dt/platform-settings/content-core-rules";

type CoreRulesResponse = { ok: boolean; rules?: string; persisted?: boolean; message?: string | null };

/**
 * „Kernregeln“ under Globale Prompts: one text that every step of Texte gets, so shared rules
 * need not be repeated (and kept in sync) in each step prompt. Empty means no Kernregeln.
 */
export function DtCoreRulesCard() {
  const [saved, setSaved] = useState("");
  const [draft, setDraft] = useState("");
  const [persisted, setPersisted] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((json: CoreRulesResponse) => {
    if (!json.ok || typeof json.rules !== "string") {
      setPersisted(false);
      setMessage(json.message ?? "Die Kernregeln konnten nicht geladen werden.");
      return;
    }
    setSaved(json.rules);
    setDraft(json.rules);
    setPersisted(json.persisted !== false);
    setMessage(json.persisted === false ? (json.message ?? null) : null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(ENDPOINT, { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as CoreRulesResponse | null;
        if (!cancelled) apply(json ?? { ok: false, message: `Unerwartete Antwort (${res.status}).` });
      } catch {
        if (!cancelled) apply({ ok: false, message: "Keine Verbindung." });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apply]);

  const length = draft.trim().length;
  const dirty = draft.trim() !== saved.trim();
  const over = Math.max(0, length - CONTENT_CORE_RULES_MAX_CHARS);
  const n = (value: number) => value.toLocaleString("de-DE");

  async function save() {
    if (busy || !persisted || over > 0) return;
    setBusy(true);
    try {
      const res = await fetch(ENDPOINT, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules: draft }) });
      const json = (await res.json().catch(() => null)) as CoreRulesResponse | null;
      if (!json?.ok || typeof json.rules !== "string") {
        toast.error("Kernregeln nicht gespeichert", {
          description: json?.message ?? "Die Änderung wurde nicht übernommen. Es gilt weiter die zuletzt gespeicherte Fassung.",
          duration: 15_000,
        });
        return;
      }
      apply(json);
      toast.success(json.rules ? "Kernregeln gespeichert — gelten ab dem nächsten Schritt jeder Seite." : "Kernregeln geleert — die Schritte laufen ohne.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DtGlassCard id="kernregeln" variant="subtle" padding="none" className="scroll-mt-24 grid gap-4 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sbkm-mint/15 text-sbkm-navy dark:text-sbkm-mint">
          <ListChecks className="size-5" aria-hidden />
        </div>
        <div className="grid gap-0.5">
          <h2 className="font-semibold tracking-tight text-sbkm-navy dark:text-white">Kernregeln</h2>
          <p className="text-sm text-sbkm-ink-600 dark:text-white/55">
            Regeln, die in jedem Schritt von Texte gelten: Analyse, SEO, Faktencheck, GEO, Aktualitätsprüfung, Hormozi,
            Vermenschlichung, Lektorat, Watermark Entfernung, Endabnahme und einzelne Überarbeitungen. Der Text-Prompt und
            die Textvorlagen erreichen nur den SEO-Schritt. Was auch die späteren Schritte einhalten sollen, gehört hierher
            und muss dann nicht mehr in jedem Schritt-Prompt stehen. Leer = keine Kernregeln.
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
        aria-label="Kernregeln"
        value={draft}
        disabled={loading || busy || !persisted}
        placeholder={"Zum Beispiel:\n- Jedes Versprechen des Anbieters steht höchstens einmal auf der Seite.\n- Keine Standard-Überschriften wie „Sie fühlen sich ernst genommen“ oder „Zeit statt Fließband“.\n- Der YMYL-Hinweis steht als eigener Abschnitt direkt vor „Stand“."}
        onChange={(event) => setDraft(event.target.value)}
        className="min-h-[220px] font-mono text-sm leading-relaxed"
      />
      {over > 0 ? (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-400/70 bg-red-50 px-3 py-2 text-xs font-medium leading-relaxed text-red-800 dark:border-red-400/40 dark:bg-red-500/10 dark:text-red-100">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Zu lang, wird so nicht gespeichert: Die Kernregeln haben {n(length)} Zeichen, erlaubt sind {n(CONTENT_CORE_RULES_MAX_CHARS)}. Bitte um {n(over)} Zeichen kürzen. Bis dahin gilt weiter die zuletzt gespeicherte Fassung.
          </span>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={over > 0 ? "text-xs font-semibold tabular-nums text-red-700 dark:text-red-300" : "text-xs tabular-nums text-sbkm-ink-500 dark:text-white/45"}>
          {n(length)} / {n(CONTENT_CORE_RULES_MAX_CHARS)} Zeichen
          {dirty ? " · nicht gespeichert" : ""}
        </p>
        <DtPillButton type="button" size="sm" disabled={loading || busy || !persisted || !dirty || over > 0} onClick={() => void save()}>
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Save className="size-3.5" aria-hidden />}
          Kernregeln speichern
        </DtPillButton>
      </div>
    </DtGlassCard>
  );
}
