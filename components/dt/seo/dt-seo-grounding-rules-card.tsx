"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";

import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtTextarea } from "@/components/dt/dt-field";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { cn } from "@/components/dt/cn";

const ENDPOINT = "/api/dt/platform-settings/grounding-pages-prompt";
const MAX_CHARS = 100_000;

type RulesPayload = {
  ok?: boolean;
  modePrompt?: string;
  agentBase?: string;
  agentStandard?: string;
  modeIsDefault?: boolean;
  agentBaseIsDefault?: boolean;
  agentStandardIsDefault?: boolean;
  persisted?: boolean;
  message?: string;
};

type Draft = {
  modePrompt: string;
  agentBase: string;
  agentStandard: string;
};

const EMPTY: Draft = { modePrompt: "", agentBase: "", agentStandard: "" };

function same(a: Draft, b: Draft): boolean {
  return (
    a.modePrompt.trim() === b.modePrompt.trim() &&
    a.agentBase.trim() === b.agentBase.trim() &&
    a.agentStandard.trim() === b.agentStandard.trim()
  );
}

export function DtSeoGroundingRulesCard(props: { canEdit: boolean }) {
  const [saved, setSaved] = useState<Draft>(EMPTY);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [defaults, setDefaults] = useState({ mode: true, base: true, standard: true });
  const [persisted, setPersisted] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);

  const apply = useCallback((json: RulesPayload) => {
    const next: Draft = {
      modePrompt: json.modePrompt ?? "",
      agentBase: json.agentBase ?? "",
      agentStandard: json.agentStandard ?? "",
    };
    setSaved(next);
    setDraft(next);
    setDefaults({
      mode: Boolean(json.modeIsDefault),
      base: Boolean(json.agentBaseIsDefault),
      standard: Boolean(json.agentStandardIsDefault),
    });
    setPersisted(json.persisted !== false);
    setNotice(json.message?.trim() ? json.message : null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(ENDPOINT);
        const json = (await res.json()) as RulesPayload;
        if (cancelled) return;
        if (!res.ok || !json.ok || typeof json.modePrompt !== "string") {
          setNotice(json.message ?? "Die Regeln konnten nicht geladen werden.");
          return;
        }
        apply(json);
      } catch {
        if (!cancelled) setNotice("Die Regeln konnten nicht geladen werden.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apply]);

  const dirty = !same(draft, saved);
  const isDefault = defaults.mode && defaults.base && defaults.standard;

  async function save(next: Draft, mode: "save" | "reset") {
    setBusy(mode);
    try {
      const res = await fetch(ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const json = (await res.json()) as RulesPayload;
      if (!res.ok || !json.ok || typeof json.modePrompt !== "string") {
        toast.error(json.message ?? "Speichern fehlgeschlagen.");
        return;
      }
      apply(json);
      toast.success(
        mode === "reset" ? "Regeln auf den Standard zurückgesetzt." : "Regeln gespeichert.",
        { description: "Gilt ab der nächsten Nachricht und ab dem nächsten Entwurfsschritt." },
      );
    } catch {
      toast.error("Speichern fehlgeschlagen.");
    } finally {
      setBusy(null);
    }
  }

  const fields: Array<{
    key: keyof Draft;
    label: string;
    help: string;
    standard: boolean;
  }> = [
    {
      key: "modePrompt",
      label: "SEO-Chat, Schalter „Grounding Page“",
      help: "Das liest der Berater, solange der Schalter im Chat an ist. Er startet den Entwurf, stellt die Fragen und erklärt die Freigabe.",
      standard: defaults.mode,
    },
    {
      key: "agentBase",
      label: "Grounding-Agent: Grundregeln",
      help: "Gilt in allen vier Schritten: Fakten sammeln, Faktencheck, Seite bauen, Endprüfung.",
      standard: defaults.base,
    },
    {
      key: "agentStandard",
      label: "Grounding-Agent: Pflichtblöcke",
      help: "Gilt beim Bauen und bei der Endprüfung. Hier stehen die Bausteine, die eine Seite haben muss.",
      standard: defaults.standard,
    },
  ];

  return (
    <DtGlassCard
      id="grounding-pages-rules"
      variant="subtle"
      padding="none"
      className="grid scroll-mt-24 gap-3 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-sbkm-navy dark:text-white">
            Regeln für Grounding Pages
          </h3>
          <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-sbkm-ink-600 dark:text-white/55">
            Diese Texte benutzt die Funktion. Sie gelten für alle Organisationen. Seiten, URLs und
            Prüfdaten bleiben je Kunde im Bereich darunter. Eine Änderung gilt ab der nächsten
            Chat-Nachricht und ab dem nächsten Schritt eines Entwurfs.
          </p>
        </div>
        {loading ? (
          <Loader2 className="size-4 animate-spin text-sbkm-ink-500" aria-label="Lädt" />
        ) : (
          <span
            className={cn(
              "rounded-pill px-2.5 py-1 text-[11px] font-bold",
              isDefault
                ? "bg-sbkm-navy/[0.06] text-sbkm-ink-600 dark:bg-white/10 dark:text-white/70"
                : "bg-sbkm-mint/30 text-sbkm-navy dark:bg-sbkm-mint/20 dark:text-white",
            )}
          >
            {isDefault ? "Standard" : "Angepasst"}
          </span>
        )}
      </div>

      {notice ? (
        <p className="flex items-start gap-2 rounded-lg border border-orange-300/70 bg-orange-50 px-3 py-2 text-xs leading-relaxed text-orange-900 dark:border-orange-400/30 dark:bg-orange-500/10 dark:text-orange-100">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {notice}
        </p>
      ) : null}

      {loading ? (
        <p className="text-xs text-sbkm-ink-600 dark:text-white/55">Regeln werden geladen …</p>
      ) : (
        <>
          {fields.map((field) => (
            <div key={field.key} className="grid gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <label
                  htmlFor={`grounding-rule-${field.key}`}
                  className="text-sm font-semibold text-sbkm-navy dark:text-white"
                >
                  {field.label}
                </label>
                <span className="text-[11px] tabular-nums text-sbkm-ink-500 dark:text-white/45">
                  {field.standard ? "Standard · " : ""}
                  {draft[field.key].length.toLocaleString("de-DE")} Zeichen
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-sbkm-ink-500 dark:text-white/45">
                {field.help}
              </p>
              <DtTextarea
                id={`grounding-rule-${field.key}`}
                value={draft[field.key]}
                maxLength={MAX_CHARS}
                rows={field.key === "modePrompt" ? 14 : 8}
                disabled={!props.canEdit || Boolean(busy) || !persisted}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, [field.key]: event.target.value }))
                }
                className="max-h-[22rem] min-h-[8rem] resize-y font-mono text-xs leading-relaxed"
              />
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            {props.canEdit ? (
              <>
                <DtPillButton
                  type="button"
                  size="sm"
                  disabled={!dirty || Boolean(busy) || !persisted}
                  onClick={() => void save(draft, "save")}
                  className="gap-1.5"
                >
                  {busy === "save" ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Save className="size-3.5" aria-hidden />
                  )}
                  Speichern
                </DtPillButton>
                <DtPillButton
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={!dirty || Boolean(busy)}
                  onClick={() => setDraft(saved)}
                >
                  Verwerfen
                </DtPillButton>
                <DtPillButton
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={Boolean(busy) || !persisted || (isDefault && !dirty)}
                  onClick={() => void save(EMPTY, "reset")}
                  className="gap-1.5 sm:ml-auto"
                >
                  {busy === "reset" ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <RotateCcw className="size-3.5" aria-hidden />
                  )}
                  Auf Standard zurücksetzen
                </DtPillButton>
              </>
            ) : (
              <span className="text-xs text-sbkm-ink-600 dark:text-white/55">
                Nur Administratoren können die Regeln ändern.
              </span>
            )}
          </div>
        </>
      )}
    </DtGlassCard>
  );
}
