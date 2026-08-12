"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Upload, X } from "lucide-react";

import {
  importRawFilledQuestionnaireAction,
  importSurveyBundleAction,
} from "@/app/dashboard/surveys/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function SurveyImportButton() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<"raw" | "json">("raw");
  const [rawText, setRawText] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const rawFileInputRef = useRef<HTMLInputElement>(null);

  function close() {
    if (isPending) return;
    setIsOpen(false);
    setError(null);
  }

  function importRaw(text: string) {
    const trimmed = text.trim();
    if (trimmed.length < 50) {
      setError("Bitte den kompletten ausgefüllten Fragebogen einfügen.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await importRawFilledQuestionnaireAction({
        text: trimmed,
        title: title.trim() || undefined,
      });
      if (!res.ok || !res.data?.surveyId) {
        setError(res.message);
        return;
      }
      setRawText("");
      setTitle("");
      setIsOpen(false);
      const target = res.data.responseId
        ? `/dashboard/surveys/${res.data.surveyId}/responses/${res.data.responseId}`
        : `/dashboard/surveys/${res.data.surveyId}/edit`;
      router.push(target);
      router.refresh();
    });
  }

  function importJson(text: string) {
    setError(null);
    startTransition(async () => {
      try {
        const payload = JSON.parse(text) as unknown;
        const res = await importSurveyBundleAction({ payload });
        if (!res.ok || !res.data?.surveyId) {
          setError(res.message);
          return;
        }
        setIsOpen(false);
        router.push(`/dashboard/surveys/${res.data.surveyId}/edit`);
        router.refresh();
      } catch {
        setError("Ungültige JSON-Datei.");
      }
    });
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setIsOpen(true)}>
        <Upload className="mr-2 h-4 w-4" />
        Import (Rohtext / JSON)
      </Button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border bg-background shadow-xl">
            <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
              <div>
                <h2 className="text-lg font-semibold">Fragebogen importieren</h2>
                <p className="text-sm text-muted-foreground">
                  Rohtext mit Fragen und Antworten — oder fertiges JSON-Bundle.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={close}
                disabled={isPending}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex gap-2 border-b px-4 pt-3">
              <Button
                type="button"
                size="sm"
                variant={tab === "raw" ? "default" : "ghost"}
                onClick={() => setTab("raw")}
                disabled={isPending}
              >
                Roh-Fragebogen
              </Button>
              <Button
                type="button"
                size="sm"
                variant={tab === "json" ? "default" : "ghost"}
                onClick={() => setTab("json")}
                disabled={isPending}
              >
                JSON-Bundle
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {tab === "raw" ? (
                <div className="grid gap-3">
                  <p className="text-sm text-muted-foreground">
                    Füge den kompletten ausgefüllten Text ein (Abschnitte mit „N Felder“ und
                    Zeilen „Antwort: …“). Daraus werden Fragen, Antwortoptionen und die
                    ausgefüllte Antwort angelegt — bearbeitbar und für Kunden veröffentlichbar.
                  </p>
                  <Input
                    value={title}
                    disabled={isPending}
                    placeholder="Optionaler Titel (sonst aus dem Text)"
                    onChange={(e) => setTitle(e.target.value)}
                  />
                  <Textarea
                    value={rawText}
                    disabled={isPending}
                    placeholder={`Wunschkunde & Avatar\n5 Felder\nWie soll der Avatar heißen?\n\nAntwort: Alex Müller\n…`}
                    className="min-h-[280px] font-mono text-xs"
                    onChange={(e) => setRawText(e.target.value)}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={rawFileInputRef}
                      type="file"
                      accept=".txt,.md,text/plain,text/markdown"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.currentTarget.files?.[0];
                        e.currentTarget.value = "";
                        if (!file) return;
                        void file.text().then((text) => setRawText(text));
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isPending}
                      onClick={() => rawFileInputRef.current?.click()}
                    >
                      <FileUp className="mr-2 h-4 w-4" />
                      .txt / .md laden
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="grid gap-3">
                  <p className="text-sm text-muted-foreground">
                    Klassischer Import einer bereits konvertierten JSON-Datei (Definition +
                    Antworten).
                  </p>
                  <input
                    ref={jsonInputRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.currentTarget.files?.[0];
                      e.currentTarget.value = "";
                      if (!file) return;
                      void file.text().then((text) => importJson(text));
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => jsonInputRef.current?.click()}
                  >
                    <FileUp className="mr-2 h-4 w-4" />
                    JSON-Datei wählen
                  </Button>
                </div>
              )}

              {error ? (
                <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="flex justify-end gap-2 border-t px-4 py-3">
              <Button type="button" variant="ghost" onClick={close} disabled={isPending}>
                Abbrechen
              </Button>
              {tab === "raw" ? (
                <Button
                  type="button"
                  disabled={isPending || rawText.trim().length < 50}
                  onClick={() => importRaw(rawText)}
                >
                  {isPending ? "Importiere…" : "Importieren"}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
