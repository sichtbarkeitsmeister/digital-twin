"use client";

import { cn } from "@/components/dt/cn";
import { DtDictationButton } from "@/components/dt/chat/dt-dictation-button";

/**
 * A text field with a „Diktieren“ button in its corner: the person speaks and the text is written
 * into the field (the browser's speech recognition, like in the chat; the button is missing where
 * the browser has none). Used for every request the page window takes in words: „Abschnitt ändern“,
 * „Abschnitt überarbeiten lassen“ and „Mit Anmerkung wiederholen“. Dictated text is added to what is
 * already in the field and can be edited by hand afterwards.
 */
export function DtContentDictationField(props: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  placeholder?: string;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <textarea
        className={cn(props.className, "pb-12")}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        aria-label={props.ariaLabel}
        disabled={props.disabled}
      />
      <DtDictationButton
        value={props.value}
        onChange={props.onChange}
        disabled={props.disabled}
        showLabel
        className="absolute bottom-2.5 right-2.5 inline-flex h-8 items-center gap-1.5 rounded-pill border border-sbkm-navy/15 bg-white/90 px-3 text-sbkm-navy shadow-sm transition hover:bg-sbkm-mint/20 active:scale-[0.98] disabled:opacity-50 dark:border-white/15 dark:bg-white/10 dark:text-white"
        iconClassName="h-3.5 w-3.5"
      />
    </div>
  );
}
