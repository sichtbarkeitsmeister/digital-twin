"use client";

import { useRef } from "react";
import { Mic, Square } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/components/dt/cn";
import { useSpeechDictation } from "@/components/dt/chat/use-speech-dictation";

/**
 * A text field with a „Diktieren“ button in its corner: the person speaks and the text is written
 * into the field (the browser's speech recognition, like in the chat; the button is missing where
 * the browser has none). Used for every request the page window takes in words: „Abschnitt ändern“,
 * „Abschnitt überarbeiten lassen“ and „Mit Anmerkung wiederholen“. Dictated text is added to what is
 * already in the field and can be edited by hand afterwards.
 *
 * With `onSubmit`, Enter sends the text (Shift+Enter makes a new line, as in the chat). A dictation
 * that is running stops first, and what the recognition delivers after the send is dropped: the field
 * is cleared by the caller and must not be filled again by a late word.
 */
export function DtContentDictationField(props: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  placeholder?: string;
  ariaLabel: string;
  disabled?: boolean;
  /** Enter sends. The caller decides whether it may (text present, nothing running) and does the sending. */
  onSubmit?: () => void;
}) {
  // Set by a send: the recognition may still deliver its last words; they are not written into the field.
  const sentRef = useRef(false);
  const dictation = useSpeechDictation({
    value: props.value,
    onChange: (next) => {
      if (!sentRef.current) props.onChange(next);
    },
    onError: (message) => toast.error(message),
  });

  function change(next: string) {
    sentRef.current = false;
    props.onChange(next);
  }

  function submit() {
    if (!props.onSubmit) return;
    dictation.stop();
    props.onSubmit();
    // Only once the dictation has really ended is the field free for new words again.
    sentRef.current = true;
    window.setTimeout(() => {
      sentRef.current = false;
    }, 1500);
  }

  return (
    <div className="grid gap-1">
      <div className="relative">
        <textarea
          className={cn(props.className, "pb-12")}
          value={props.value}
          onChange={(e) => change(e.target.value)}
          onKeyDown={(e) => {
            if (!props.onSubmit || e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            submit();
          }}
          placeholder={props.placeholder}
          aria-label={props.ariaLabel}
          disabled={props.disabled}
        />
        {dictation.supported ? (
          <button
            type="button"
            aria-pressed={dictation.listening}
            aria-label={dictation.listening ? "Diktat beenden" : "Diktieren"}
            title={dictation.listening ? "Diktat beenden — der Text bleibt im Eingabefeld" : "Diktieren: sprechen, der Text erscheint im Eingabefeld (Browser-Spracherkennung)"}
            disabled={props.disabled}
            onClick={() => {
              sentRef.current = false;
              dictation.toggle();
            }}
            className={cn(
              "absolute bottom-2.5 right-2.5 inline-flex h-8 items-center gap-1.5 rounded-pill border border-sbkm-navy/15 bg-white/90 px-3 text-sbkm-navy shadow-sm transition hover:bg-sbkm-mint/20 active:scale-[0.98] disabled:opacity-50 dark:border-white/15 dark:bg-white/10 dark:text-white",
              dictation.listening && "border-red-400/40 bg-red-100/90 text-red-900 hover:bg-red-100 dark:bg-red-500/20 dark:text-red-100 dark:hover:bg-red-500/25",
            )}
          >
            {dictation.listening ? <Square className="h-3.5 w-3.5 shrink-0 fill-current" aria-hidden /> : <Mic className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            <span className="hidden text-xs font-bold sm:inline">{dictation.listening ? "Aufnahme" : "Diktieren"}</span>
          </button>
        ) : null}
      </div>
      {props.onSubmit ? <p className="text-[11px] text-sbkm-ink-500 dark:text-white/45">Enter schickt ab · Umschalt+Enter macht eine neue Zeile</p> : null}
    </div>
  );
}
