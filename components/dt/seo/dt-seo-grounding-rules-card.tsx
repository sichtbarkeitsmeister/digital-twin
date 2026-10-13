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
  prompt?: string;
  isDefault?: boolean;
  persisted?: boolean;
  message?: string;
};

export function DtSeoGroundingRulesCard(props: { canEdit: boolean }) {
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState("");
  const [isDefault, setIsDefault] = useState(true);
  const [persisted, setPersisted] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);

  const apply = useCallback((json: RulesPayload) => {
    const next = json.prompt ?? "";
    setPrompt(next);
    setDraft(next);
    setIsDefault(Boolean(json.isDefault));
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
        if (!res.ok || !json.ok || typeof json.prompt !== "string") {
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

  const dirty = draft.trim() !== prompt.trim();

  async function save(next: string, mode: "save" | "reset") {
    setBusy(mode);
    try {
      const res = await fetch(ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: next }),
      });
      const json = (await res.json()) as RulesPayload;
      if (!res.ok || !json.ok || typeof json.prompt !== "string") {
        toast.error(json.message ?? "Speichern fehlgeschlagen.");
        return;
      }
      apply(json);
      toast.success(
        mode === "reset" ? "Regeln auf den Standard zurückgesetzt." : "Regeln gespeichert.",
        {
          description: "Gilt ab dem nächsten Auftrag aus diesem Bereich.",
        },
      );
    } catch {
      toast.error("Speichern fehlgeschlagen.");
    } finally {
      setBusy(null);
    }
  }

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
            Diese Regeln gelten für alle Organisationen, sobald hier ein Auftrag startet. Domain,
            URLs, Prüftermine und der konkrete Befehl setzt der Auftrag selbst ein. An der Stelle{" "}
            {"{{ZIELGRUPPEN}}"} stehen die Wunschkunden-Profile. Fehlt die Stelle, hängen die
            Profile am Ende an. Fertige Seiten ändern sich erst mit Erstellen, Aktualisieren oder
            Prüfen.
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
          <label className="sr-only" htmlFor="grounding-pages-rules-text">
            Regeln für Grounding Pages
          </label>
          <DtTextarea
            id="grounding-pages-rules-text"
            value={draft}
            maxLength={MAX_CHARS}
            rows={18}
            disabled={!props.canEdit || Boolean(busy) || !persisted}
            onChange={(event) => setDraft(event.target.value)}
            className="max-h-[28rem] min-h-[16rem] resize-y font-mono text-xs leading-relaxed"
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] tabular-nums text-sbkm-ink-500 dark:text-white/45">
              {draft.length.toLocaleString("de-DE")} Zeichen
            </span>
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
                  onClick={() => setDraft(prompt)}
                >
                  Verwerfen
                </DtPillButton>
                <DtPillButton
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={Boolean(busy) || !persisted || (isDefault && !dirty)}
                  onClick={() => void save("", "reset")}
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
