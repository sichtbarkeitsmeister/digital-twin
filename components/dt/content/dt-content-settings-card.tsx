"use client";

import { useId, useState } from "react";
import { CheckCircle2, Pencil } from "lucide-react";

import { cn } from "@/components/dt/cn";
import { DtField, DtInput, DtInputWrap, DtTextarea } from "@/components/dt/dt-field";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { DtSelect } from "@/components/dt/dt-select";
import {
  CONTENT_ANREDEN,
  CONTENT_BRANCHEN,
  CONTENT_BRANCHE_LABELS,
  cleanTextSettings,
  parseWordList,
  type ContentAnrede,
  type ContentBranche,
  type ContentTextSettings,
  type ContentTextSettingsSuggestion,
} from "@/lib/dt/content/mapping";

const cardClass =
  "relative overflow-hidden rounded-dt-lg border border-sbkm-navy/10 bg-white/55 shadow-dt backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.05]";

const BRANCHE_OPTIONS = CONTENT_BRANCHEN.map((value) => ({
  value,
  label: CONTENT_BRANCHE_LABELS[value],
}));

const FALLBACK_HINTS: Record<keyof ContentTextSettings, string> = {
  anrede: "Nichts Eindeutiges in den Gesprächen, daher „Sie“.",
  branche: "Kein Hinweis auf Kanzlei oder Praxis, daher Handwerk.",
  tonalitaet: "In den Gesprächen steht noch nichts zum Ton.",
  verbotene_woerter: "In den Gesprächen keine gefunden.",
};

function Hint(props: { reason?: string; field: keyof ContentTextSettings }) {
  return (
    <p className="text-[11px] leading-relaxed text-sbkm-ink-500 dark:text-white/45">
      {props.reason ? `Vorschlag: ${props.reason}` : FALLBACK_HINTS[props.field]}
    </p>
  );
}

function SummaryChip(props: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block max-w-full truncate rounded-pill border border-sbkm-navy/10 bg-white/60 px-2.5 py-0.5 text-xs text-sbkm-navy dark:border-white/10 dark:bg-white/[0.04] dark:text-white/85",
        props.className,
      )}
    >
      {props.children}
    </span>
  );
}

function ConfirmedSettings(props: { settings: ContentTextSettings; onEdit: () => void }) {
  const { settings } = props;
  const words = settings.verbotene_woerter.length;
  return (
    <section
      aria-label="Einstellungen für Texte"
      className={cn(cardClass, "flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5")}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
        <h2 className="mr-1 text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">
          Einstellungen für Texte
        </h2>
        <SummaryChip>Anrede: {settings.anrede}</SummaryChip>
        <SummaryChip>{CONTENT_BRANCHE_LABELS[settings.branche]}</SummaryChip>
        <SummaryChip className="max-w-[22rem]">
          <span title={settings.tonalitaet}>Ton: {settings.tonalitaet}</span>
        </SummaryChip>
        <SummaryChip>
          {words === 0 ? "Keine verbotenen Wörter" : `${words} verbotene${words === 1 ? "s Wort" : " Wörter"}`}
        </SummaryChip>
      </div>
      <button
        type="button"
        onClick={props.onEdit}
        className="inline-flex shrink-0 items-center gap-1 rounded-pill text-xs font-semibold text-sbkm-navy underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 dark:text-sbkm-mint"
      >
        <Pencil className="size-3" aria-hidden />
        Ändern
      </button>
    </section>
  );
}

function SettingsForm(props: {
  initial: ContentTextSettings;
  suggestion: ContentTextSettingsSuggestion;
  onConfirm: (settings: ContentTextSettings) => void;
}) {
  const id = useId();
  const [anrede, setAnrede] = useState<ContentAnrede>(props.initial.anrede);
  const [branche, setBranche] = useState<ContentBranche>(props.initial.branche);
  const [tonalitaet, setTonalitaet] = useState(props.initial.tonalitaet);
  const [words, setWords] = useState(props.initial.verbotene_woerter.join(", "));
  const { reasons } = props.suggestion;
  const canConfirm = tonalitaet.trim().length > 0;

  return (
    <section aria-label="Einstellungen für Texte" className={cardClass}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent dark:via-white/10" />
      <header className="border-b border-sbkm-navy/8 px-4 py-3.5 dark:border-white/8 sm:px-5">
        <h2 className="text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">
          Einstellungen für Texte
        </h2>
        <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/60">
          Diese vier Angaben lassen sich aus den Gesprächen nicht sicher ablesen. Die Vorschläge bitte
          einmal prüfen und bestätigen.
        </p>
      </header>

      <div className="grid gap-5 px-4 py-4 sm:px-5 md:grid-cols-2">
        <DtField label="Anrede">
          <div
            role="radiogroup"
            aria-label="Anrede"
            className="flex w-fit rounded-pill bg-sbkm-navy/[0.06] p-1 dark:bg-white/10"
          >
            {CONTENT_ANREDEN.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={anrede === value}
                onClick={() => setAnrede(value)}
                className={cn(
                  "rounded-pill px-5 py-1.5 text-[13px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45",
                  anrede === value
                    ? "bg-sbkm-mint text-sbkm-navy shadow-sm"
                    : "text-sbkm-navy/60 hover:text-sbkm-navy dark:text-white/55 dark:hover:text-white",
                )}
              >
                {value}
              </button>
            ))}
          </div>
          <Hint field="anrede" reason={reasons.anrede} />
        </DtField>

        <DtField label="Branche">
          <DtSelect
            value={branche}
            onValueChange={(value) => setBranche(value as ContentBranche)}
            options={BRANCHE_OPTIONS}
            srLabel="Branche"
            fullWidth
          />
          <Hint field="branche" reason={reasons.branche} />
        </DtField>

        <DtField label="Tonalität" htmlFor={`${id}-ton`}>
          <DtInputWrap>
            <DtInput
              id={`${id}-ton`}
              value={tonalitaet}
              maxLength={1_000}
              onChange={(e) => setTonalitaet(e.target.value)}
              placeholder="z. B. ruhig, ehrlich, bodenständig"
            />
          </DtInputWrap>
          <Hint field="tonalitaet" reason={reasons.tonalitaet} />
        </DtField>

        <DtField label="Verbotene Wörter" optional htmlFor={`${id}-woerter`}>
          <DtTextarea
            id={`${id}-woerter`}
            value={words}
            onChange={(e) => setWords(e.target.value)}
            placeholder="Mit Komma oder Zeilenumbruch trennen"
            className="min-h-[46px] py-2.5"
            rows={1}
          />
          <Hint field="verbotene_woerter" reason={reasons.verbotene_woerter} />
        </DtField>
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-sbkm-navy/8 px-4 py-3 dark:border-white/8 sm:px-5">
        {!canConfirm ? (
          <p className="text-xs text-sbkm-ink-600 dark:text-white/55">Bitte den Ton kurz beschreiben.</p>
        ) : null}
        <DtPillButton
          type="button"
          size="sm"
          disabled={!canConfirm}
          onClick={() =>
            props.onConfirm(
              cleanTextSettings({
                anrede,
                branche,
                tonalitaet,
                verbotene_woerter: parseWordList(words),
              }),
            )
          }
        >
          <CheckCircle2 className="size-3.5" aria-hidden />
          Bestätigen
        </DtPillButton>
      </footer>
    </section>
  );
}

/**
 * The four strict Content-Agent fields. Shown as a form until confirmed, then as one summary line.
 */
export function DtContentSettingsCard(props: {
  suggestion: ContentTextSettingsSuggestion;
  confirmed: ContentTextSettings | null;
  editing: boolean;
  onConfirm: (settings: ContentTextSettings) => void;
  onEdit: () => void;
}) {
  if (props.confirmed && !props.editing) {
    return <ConfirmedSettings settings={props.confirmed} onEdit={props.onEdit} />;
  }
  return (
    <SettingsForm
      initial={props.confirmed ?? props.suggestion.settings}
      suggestion={props.suggestion}
      onConfirm={props.onConfirm}
    />
  );
}
