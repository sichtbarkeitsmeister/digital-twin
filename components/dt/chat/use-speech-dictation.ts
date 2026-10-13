"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  collectDictationResults,
  DICTATION_LANG,
  dictationErrorMessage,
  getSpeechRecognitionCtor,
  mergeDictationText,
  normalizeDictationError,
  type DictationRecognition,
} from "@/lib/shared/speech-dictation";

/**
 * Dictate into a text field with the browser's speech recognition.
 * The dictated text is appended to the value the user had when they pressed
 * the microphone; interim words are shown live and replaced by the final text.
 */
export function useSpeechDictation(input: {
  value: string;
  onChange: (next: string) => void;
  /** Called with a user-facing message when recognition fails. */
  onError?: (message: string) => void;
  lang?: string;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<DictationRecognition | null>(null);
  const baseRef = useRef("");
  const finalRef = useRef("");
  const wantedRef = useRef(false);
  const valueRef = useRef(input.value);
  const onChangeRef = useRef(input.onChange);
  const onErrorRef = useRef(input.onError);

  useEffect(() => {
    valueRef.current = input.value;
  }, [input.value]);
  useEffect(() => {
    onChangeRef.current = input.onChange;
    onErrorRef.current = input.onError;
  }, [input.onChange, input.onError]);

  // Decided after mount so server and client render the same markup.
  useEffect(() => {
    setSupported(getSpeechRecognitionCtor() !== null);
  }, []);

  const stop = useCallback(() => {
    wantedRef.current = false;
    try {
      recognitionRef.current?.stop();
    } catch {
      /* already stopped */
    }
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      onErrorRef.current?.(dictationErrorMessage("unsupported"));
      return;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        /* ignore */
      }
    }

    const recognition = new Ctor();
    recognition.lang = input.lang ?? DICTATION_LANG;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    baseRef.current = valueRef.current;
    finalRef.current = "";
    wantedRef.current = true;

    recognition.onstart = () => setListening(true);
    recognition.onresult = (event) => {
      const { finalText, interimText } = collectDictationResults(event.results);
      finalRef.current = finalText;
      const spoken = [finalText, interimText].filter(Boolean).join(" ");
      onChangeRef.current(mergeDictationText(baseRef.current, spoken));
    };
    recognition.onerror = (event) => {
      const code = normalizeDictationError(event.error);
      if (code === "aborted") return;
      if (code === "no-speech" && wantedRef.current) return; // silence: keep listening until the user stops
      wantedRef.current = false;
      onErrorRef.current?.(dictationErrorMessage(code));
    };
    recognition.onend = () => {
      // Commit final text only (drop a dangling interim fragment).
      onChangeRef.current(mergeDictationText(baseRef.current, finalRef.current));
      setListening(false);
      recognitionRef.current = null;
      // Chrome ends continuous sessions after a pause; resume while the user still wants to dictate.
      if (wantedRef.current) {
        baseRef.current = mergeDictationText(baseRef.current, finalRef.current);
        finalRef.current = "";
        try {
          recognitionRef.current = recognition;
          recognition.start();
        } catch {
          wantedRef.current = false;
          recognitionRef.current = null;
        }
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      wantedRef.current = false;
      onErrorRef.current?.(dictationErrorMessage("unknown"));
    }
  }, [input.lang]);

  const toggle = useCallback(() => {
    if (listening || wantedRef.current) stop();
    else start();
  }, [listening, start, stop]);

  useEffect(() => {
    return () => {
      wantedRef.current = false;
      try {
        recognitionRef.current?.abort();
      } catch {
        /* ignore */
      }
    };
  }, []);

  return { supported, listening, start, stop, toggle };
}
