"use client";

import { useState } from "react";
import { Heart, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { DtTextarea } from "@/components/dt/dt-field";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { contentApi } from "@/components/dt/content/content-api";
import { CLIENT_WISHES_MAX, CLIENT_WISHES_TEXT_MAX, parseClientWishes } from "@/lib/dt/content/client-wishes";
import type { ContentWishesResult } from "@/lib/dt/content/types";

const cardClass =
  "relative overflow-hidden rounded-dt-lg border border-sbkm-navy/10 bg-white/55 shadow-dt backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.05]";

export const CLIENT_WISHES_PLACEHOLDER = "Immer ‚Kanzlei‘ statt ‚Büro‘\nInhaber: ‚Dr. Müller‘, nie mit Vornamen\nKeine Preise nennen";

/**
 * „Kundenwünsche“ next to „Einstellungen für Texte“: one wish per line, binding for every step
 * that writes text (and the Watermark step of Texte). They go before the Texter-Prompt and the
 * Textvorlagen, never before the facts rules, Anrede, verbotene Wörter or the Branchenregel.
 */
export function DtContentWishesCard(props: { organisationId: string; initial: string; settingsConfirmed: boolean }) {
  const [saved, setSaved] = useState(props.initial);
  const [text, setText] = useState(props.initial);
  const [busy, setBusy] = useState(false);
  const count = parseClientWishes(text).length;
  const dirty = text.trim() !== saved.trim();

  async function save() {
    setBusy(true);
    const res = await contentApi<ContentWishesResult>("/api/dt/content/wishes", {
      method: "PUT",
      body: { organisationId: props.organisationId, client_wishes: text },
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    setSaved(res.data.client_wishes);
    setText(res.data.client_wishes);
    toast.success(
      res.data.count > 0
        ? `${res.data.count} ${res.data.count === 1 ? "Wunsch" : "Wünsche"} gespeichert – gilt ab dem nächsten Schritt, der läuft.`
        : "Kundenwünsche geleert.",
    );
  }

  return (
    <section aria-label="Kundenwünsche" className={cardClass}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-sbkm-navy/8 px-4 py-3.5 dark:border-white/8 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <Heart className="size-4 shrink-0 text-sbkm-mint" aria-hidden />
          <h2 className="text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">Kundenwünsche</h2>
          <span className="text-xs text-sbkm-ink-600 dark:text-white/60">
            {count === 0 ? "keine" : `${count} ${count === 1 ? "Wunsch" : "Wünsche"}`}
          </span>
        </div>
      </header>
      <div className="grid gap-3 px-4 py-4 sm:px-5">
        <p className="text-xs leading-relaxed text-sbkm-ink-600 dark:text-white/60">
          Ein Wunsch pro Zeile, verbindlich für alle Seiten dieser Organisation. Sie gehen dem Text-Prompt und den
          Textvorlagen vor, aber nie den Fakten, der Anrede, den verbotenen Wörtern oder der Branchenregel. Eine Änderung
          gilt ab dem nächsten Schritt, der läuft; fertige Schritte laufen nicht von selbst neu.
        </p>
        <DtTextarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={CLIENT_WISHES_PLACEHOLDER}
          maxLength={CLIENT_WISHES_TEXT_MAX}
          disabled={busy || !props.settingsConfirmed}
          className="min-h-[96px]"
          aria-label="Kundenwünsche, ein Wunsch pro Zeile"
        />
        {count >= CLIENT_WISHES_MAX ? (
          <p className="text-[11px] text-orange-700 dark:text-orange-300">Höchstens {CLIENT_WISHES_MAX} Wünsche; weitere Zeilen werden nicht gelesen.</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <DtPillButton type="button" size="sm" disabled={!dirty || busy || !props.settingsConfirmed} onClick={() => void save()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Save className="size-3.5" aria-hidden />}
            Speichern
          </DtPillButton>
          {!props.settingsConfirmed ? (
            <span className="text-xs text-sbkm-ink-600 dark:text-white/55">Erst die Einstellungen für Texte bestätigen.</span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
