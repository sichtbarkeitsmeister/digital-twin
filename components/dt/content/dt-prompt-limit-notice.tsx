import { AlertTriangle } from "lucide-react";

/** How far a prompt is over its limit; 0 when it fits. */
export function promptOverLimit(length: number, max: number): number {
  return Math.max(0, length - max);
}

/**
 * Shown under a prompt field that is longer than what can be saved: the text in the field is
 * NOT what the tool uses, and saving is off until it is shortened. Renders nothing within the limit.
 */
export function DtPromptLimitNotice(props: { label: string; length: number; max: number }) {
  const over = promptOverLimit(props.length, props.max);
  if (over === 0) return null;
  const n = (value: number) => value.toLocaleString("de-DE");
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-red-400/70 bg-red-50 px-3 py-2 text-xs font-medium leading-relaxed text-red-800 dark:border-red-400/40 dark:bg-red-500/10 dark:text-red-100"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        Zu lang, wird so nicht gespeichert: {props.label} hat {n(props.length)} Zeichen, erlaubt sind {n(props.max)}. Bitte um{" "}
        {n(over)} Zeichen kürzen. Bis dahin gilt weiter die zuletzt gespeicherte Fassung.
      </span>
    </p>
  );
}
