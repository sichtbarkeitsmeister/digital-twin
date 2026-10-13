"use client";

import { useId, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Pencil, Upload } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/components/dt/cn";
import { DtField, DtInput, DtInputWrap } from "@/components/dt/dt-field";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { DtSelect } from "@/components/dt/dt-select";
import {
  CONTENT_ANREDEN,
  CONTENT_BRANCHE_MAX,
  CONTENT_TONALITAETEN,
  CONTENT_WORDS_MAX,
  cleanTextSettings,
  contentTonalitaet,
  parseWordFile,
  type ContentAnrede,
  type ContentTextSettings,
  type ContentTextSettingsSuggestion,
  type ContentTonalitaet,
} from "@/lib/dt/content/mapping";

const cardClass =
  "relative overflow-hidden rounded-dt-lg border border-sbkm-navy/10 bg-white/55 shadow-dt backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.05]";

/** The forbidden words come from a plain text file, one word or phrase per line. */
export const CONTENT_WORD_FILE_ACCEPT = ".txt,text/plain";

const TONALITAET_OPTIONS = CONTENT_TONALITAETEN.map((tone) => ({
  value: tone.key,
  label: tone.label,
  description: tone.short,
}));

const FALLBACK_HINTS: Record<keyof ContentTextSettings, string> = {
  anrede: "Nichts Eindeutiges in den Gesprächen, daher „Sie“.",
  branche: "In den Anbieterfakten steht nichts zur Branche.",
  tonalitaet: "In den Gesprächen steht nichts zum Ton. Vorbelegt ist, was zur Branche meist passt.",
  verbotene_woerter: "In den Gesprächen keine gefunden.",
};

function Hint(props: { reason?: string; field: keyof ContentTextSettings; unclear?: boolean }) {
  if (props.unclear) {
    return (
      <p
        role="status"
        className="flex items-start gap-1.5 rounded-lg border border-orange-300/70 bg-orange-50 px-2.5 py-2 text-[11px] leading-relaxed text-orange-900 dark:border-orange-400/30 dark:bg-orange-500/10 dark:text-orange-100"
      >
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span className="font-semibold">{props.reason ?? FALLBACK_HINTS[props.field]}</span>
      </p>
    );
  }
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

function wordsLabel(count: number): string {
  return count === 1 ? "1 Wort" : `${count} Wörter`;
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
        <SummaryChip>Branche: {settings.branche}</SummaryChip>
        <SummaryChip>Ton: {contentTonalitaet(settings.tonalitaet)?.label ?? settings.tonalitaet}</SummaryChip>
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
  const fileRef = useRef<HTMLInputElement>(null);
  const [anrede, setAnrede] = useState<ContentAnrede>(props.initial.anrede);
  const [branche, setBranche] = useState(props.initial.branche);
  const [tonalitaet, setTonalitaet] = useState<ContentTonalitaet>(props.initial.tonalitaet);
  const [words, setWords] = useState<string[]>(props.initial.verbotene_woerter);
  /** Name of the uploaded list, so the person sees where the words came from. */
  const [wordFile, setWordFile] = useState<string | null>(null);
  const { reasons } = props.suggestion;
  const tone = contentTonalitaet(tonalitaet);

  // The branch is typed by the SEO specialist unless the client data answered it. An empty
  // field blocks „Bestätigen“ and shows why the suggestion could not fill it.
  const brancheMissing = !branche.trim();
  const brancheUnclear = props.suggestion.unclear.includes("branche");
  const brancheHint = brancheMissing
    ? { unclear: true, reason: brancheUnclear ? reasons.branche : "Bitte die Branche eintragen, z. B. „Zahnarztpraxis“." }
    : { unclear: false, reason: brancheUnclear ? undefined : reasons.branche };

  async function readWordFile(file: File | undefined) {
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      toast.error("Die Datei konnte nicht gelesen werden.");
      return;
    }
    const parsed = parseWordFile(text);
    if (parsed.length === 0) {
      toast.error(`„${file.name}“ enthält keine Wörter. Erwartet wird eine .txt-Datei mit einem Wort je Zeile.`);
      return;
    }
    const lines = text.split(/\r\n|\r|\n/).filter((line) => line.trim()).length;
    if (parsed.length === CONTENT_WORDS_MAX && lines > CONTENT_WORDS_MAX) {
      toast.warning(`Nur die ersten ${CONTENT_WORDS_MAX} Wörter werden übernommen.`);
    }
    setWords(parsed);
    setWordFile(file.name);
  }

  return (
    <section aria-label="Einstellungen für Texte" className={cardClass}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent dark:via-white/10" />
      <header className="border-b border-sbkm-navy/8 px-4 py-3.5 dark:border-white/8 sm:px-5">
        <h2 className="text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">
          Einstellungen für Texte
        </h2>
        <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/60">
          Bitte kurz prüfen und bestätigen. Die Branche meint das Geschäft des Kunden, nicht den Avatar.
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

        <DtField label="Branche" htmlFor={`${id}-branche`}>
          <DtInputWrap>
            <DtInput
              id={`${id}-branche`}
              value={branche}
              onChange={(e) => setBranche(e.target.value)}
              placeholder="z. B. Zahnarztpraxis, Umzugsunternehmen, Steuerberatung"
              maxLength={CONTENT_BRANCHE_MAX}
              autoComplete="off"
              aria-invalid={brancheMissing || undefined}
            />
          </DtInputWrap>
          <Hint field="branche" reason={brancheHint.reason} unclear={brancheHint.unclear} />
        </DtField>

        <DtField label="Tonalität">
          <DtSelect
            value={tonalitaet}
            onValueChange={(value) => setTonalitaet(value as ContentTonalitaet)}
            options={TONALITAET_OPTIONS}
            srLabel="Tonalität"
            searchable={false}
            menuMaxHeight="max-h-[var(--radix-dropdown-menu-content-available-height)]"
            fullWidth
          />
          {tone ? (
            <p className="text-xs leading-relaxed text-sbkm-ink-600 dark:text-white/65">{tone.text}</p>
          ) : null}
          <Hint field="tonalitaet" reason={reasons.tonalitaet} />
        </DtField>

        <DtField label="Verbotene Wörter" optional>
          <input
            ref={fileRef}
            type="file"
            accept={CONTENT_WORD_FILE_ACCEPT}
            className="sr-only"
            aria-label="TXT-Datei mit verbotenen Wörtern wählen"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void readWordFile(file);
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <DtPillButton type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="size-3.5" aria-hidden />
              {words.length > 0 ? "Andere TXT-Datei" : "TXT-Datei hochladen"}
            </DtPillButton>
            {words.length > 0 ? (
              <DtPillButton
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setWords([]);
                  setWordFile(null);
                }}
              >
                Liste leeren
              </DtPillButton>
            ) : null}
          </div>
          {words.length > 0 ? (
            <ul
              aria-label="Verbotene Wörter"
              className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto rounded-[10px] border border-sbkm-navy/10 bg-white/60 p-2 dark:border-white/10 dark:bg-white/[0.04]"
            >
              {words.map((word) => (
                <li
                  key={word}
                  className="rounded-pill bg-sbkm-navy/[0.06] px-2 py-0.5 text-xs text-sbkm-navy dark:bg-white/10 dark:text-white/85"
                >
                  {word}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-[11px] leading-relaxed text-sbkm-ink-500 dark:text-white/45">
            {wordFile
              ? `${wordsLabel(words.length)} aus „${wordFile}“.`
              : words.length > 0
                ? `${wordsLabel(words.length)}${reasons.verbotene_woerter ? ` – Vorschlag ${reasons.verbotene_woerter}` : ""}. Eine .txt-Datei ersetzt die Liste.`
                : "Eine .txt-Datei hochladen: ein verbotenes Wort je Zeile."}
          </p>
        </DtField>
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-sbkm-navy/8 px-4 py-3 dark:border-white/8 sm:px-5">
        <DtPillButton
          type="button"
          size="sm"
          disabled={brancheMissing}
          onClick={() =>
            props.onConfirm(
              cleanTextSettings({
                anrede,
                branche,
                tonalitaet,
                verbotene_woerter: words,
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
 * The four strict text settings. Shown as a form until confirmed, then as one summary line.
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
