/**
 * Diktieren im Chat über die Spracherkennung des Browsers (Web Speech API).
 * Pure helpers + minimal typings; the hook lives in components/dt/chat.
 */

export const DICTATION_LANG = "de-DE";

export const DICTATION_UNSUPPORTED_MESSAGE =
  "Diktieren ist in diesem Browser nicht verfügbar. Chrome, Edge oder Safari unterstützen es.";

export type DictationErrorCode =
  | "not-allowed"
  | "no-speech"
  | "audio-capture"
  | "network"
  | "aborted"
  | "unsupported"
  | "unknown";

export function dictationErrorMessage(code: DictationErrorCode): string {
  switch (code) {
    case "not-allowed":
      return "Mikrofon-Zugriff wurde abgelehnt. In den Browser-Einstellungen für diese Seite erlauben.";
    case "no-speech":
      return "Es wurde keine Sprache erkannt. Noch einmal auf das Mikrofon klicken und sprechen.";
    case "audio-capture":
      return "Kein Mikrofon gefunden. Anschluss und Systemeinstellungen prüfen.";
    case "network":
      return "Die Spracherkennung ist gerade nicht erreichbar. Später noch einmal versuchen.";
    case "unsupported":
      return DICTATION_UNSUPPORTED_MESSAGE;
    case "aborted":
      return "Diktat beendet.";
    default:
      return "Diktieren hat nicht funktioniert. Bitte noch einmal versuchen.";
  }
}

export function normalizeDictationError(raw: string | null | undefined): DictationErrorCode {
  switch (raw) {
    case "not-allowed":
    case "service-not-allowed":
      return "not-allowed";
    case "no-speech":
      return "no-speech";
    case "audio-capture":
      return "audio-capture";
    case "network":
      return "network";
    case "aborted":
      return "aborted";
    default:
      return "unknown";
  }
}

/** Collapse recogniser whitespace and fix spacing before punctuation. */
export function cleanTranscript(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

/**
 * Append dictated text to what the user already typed: one space (or a new
 * line when the base ends with a line break), never a doubled separator.
 */
export function mergeDictationText(base: string, transcript: string): string {
  const spoken = cleanTranscript(transcript);
  if (!spoken) return base;
  const left = base.replace(/[ \t]+$/, "");
  if (!left) return spoken;
  if (/\n$/.test(left)) return `${left}${spoken}`;
  return `${left} ${spoken}`;
}

// ---------------------------------------------------------------------------
// Minimal Web Speech API typings (not every TS DOM lib ships them).
// ---------------------------------------------------------------------------

export type DictationRecognitionResult = {
  isFinal: boolean;
  0: { transcript: string };
  length: number;
};

export type DictationRecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<DictationRecognitionResult>;
};

export type DictationRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: DictationRecognitionEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type DictationRecognitionCtor = new () => DictationRecognition;

export function getSpeechRecognitionCtor(): DictationRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: DictationRecognitionCtor;
    webkitSpeechRecognition?: DictationRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

/** Split a result list into the committed (final) text and the live (interim) tail. */
export function collectDictationResults(results: ArrayLike<DictationRecognitionResult>): {
  finalText: string;
  interimText: string;
} {
  let finalText = "";
  let interimText = "";
  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    if (!result) continue;
    const transcript = result[0]?.transcript ?? "";
    if (result.isFinal) finalText += transcript;
    else interimText += transcript;
  }
  return { finalText: cleanTranscript(finalText), interimText: cleanTranscript(interimText) };
}
