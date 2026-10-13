"use client";

import { Mic, Square } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/components/dt/cn";
import { useSpeechDictation } from "@/components/dt/chat/use-speech-dictation";

/**
 * Microphone button for chat composers: dictate with the browser's speech
 * recognition (Chrome, Edge, Safari). Hidden where the browser lacks it.
 */
export function DtDictationButton(props: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  className?: string;
  /** Show the word „Diktieren“ next to the icon on wide screens. */
  showLabel?: boolean;
  iconClassName?: string;
}) {
  const dictation = useSpeechDictation({
    value: props.value,
    onChange: props.onChange,
    onError: (message) => toast.error(message),
  });

  if (!dictation.supported) return null;

  return (
    <button
      type="button"
      aria-pressed={dictation.listening}
      aria-label={dictation.listening ? "Diktat beenden" : "Diktieren"}
      title={
        dictation.listening
          ? "Diktat beenden — der Text bleibt im Eingabefeld"
          : "Diktieren: sprechen, der Text erscheint im Eingabefeld (Browser-Spracherkennung)"
      }
      disabled={props.disabled}
      onClick={dictation.toggle}
      className={cn(
        props.className,
        dictation.listening &&
          "border-red-400/40 bg-red-100/90 text-red-900 hover:bg-red-100 dark:bg-red-500/20 dark:text-red-100 dark:hover:bg-red-500/25",
      )}
    >
      {dictation.listening ? (
        <Square className={cn("shrink-0 fill-current", props.iconClassName ?? "h-4 w-4")} aria-hidden />
      ) : (
        <Mic className={cn("shrink-0", props.iconClassName ?? "h-4 w-4")} aria-hidden />
      )}
      {props.showLabel ? (
        <span className="hidden text-xs font-bold sm:inline">
          {dictation.listening ? "Aufnahme" : "Diktieren"}
        </span>
      ) : null}
    </button>
  );
}
