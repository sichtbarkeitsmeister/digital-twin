"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Upload, X } from "lucide-react";

import {
  importRawFilledQuestionnairesBatchAction,
  importSurveyBundleAction,
} from "@/app/dashboard/surveys/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  QUESTIONNAIRE_FILE_ACCEPT,
  readQuestionnaireFileText,
} from "@/lib/surveys/read-questionnaire-file-text";

type PendingRawFile = { name: string; text: string };

export function SurveyImportButton() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<"raw" | "json">("raw");
  const [rawText, setRawText] = useState("");
  const [title, setTitle] = useState("");
  const [files, setFiles] = useState<PendingRawFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const rawFileInputRef = useRef<HTMLInputElement>(null);

  function close() {
    if (isPending) return;
    setIsOpen(false);
    setError(null);
    setStatus(null);
  }

  function importRaw() {
    const items: Array<{ text: string; title?: string }> = [];
    for (const file of files) {
      items.push({
        text: file.text,
        title: title.trim() && files.length === 1 ? title.trim() : file.name.replace(/\.[^.]+$/, ""),
      });
    }
    const pasted = rawText.trim();
    if (pasted.length >= 50) {
      items.push({ text: pasted, title: title.trim() || undefined });
    }
    if (items.length === 0) {
      setError("Bitte Text einfügen und/oder eine oder mehrere Dateien laden.");
      return;
    }
    setError(null);
    setStatus(null);
    startTransition(async () => {
      const res = await importRawFilledQuestionnairesBatchAction({ items });
      if (!res.ok || !res.data?.results?.length) {
        setError(res.message);
        return;
      }
      const { results, failed } = res.data;
      setRawText("");
      setTitle("");
      setFiles([]);
      setIsOpen(false);
      if (results.length === 1 && failed.length === 0) {
        const one = results[0]!;
        const target = one.responseId
          ? `/dashboard/surveys/${one.surveyId}/responses/${one.responseId}`
          : `/dashboard/surveys/${one.surveyId}/edit`;
        router.push(target);
      } else {
        router.push("/dashboard/surveys");
      }
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

  async function addRawFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    setError(null);
    setStatus("Dateien werden gelesen…");
    const next: PendingRawFile[] = [];
    const errors: string[] = [];
    for (const file of Array.from(fileList)) {
      try {
        const text = await readQuestionnaireFileText(file);
        next.push({ name: file.name, text });
      } catch (e) {
        errors.push(e instanceof Error ? e.message : `„${file.name}“ konnte nicht gelesen werden.`);
      }
    }
    setStatus(null);
    if (errors.length > 0) {
      setError(errors.join(" "));
    }
    if (next.length === 0) return;
    setFiles((prev) => {
      const byName = new Map(prev.map((f) => [f.name, f]));
      for (const f of next) byName.set(f.name, f);
      return Array.from(byName.values());
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
                  Ein oder mehrere ausgefüllte Roh-Fragebögen — oder fertiges JSON.
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
                    Mehrere Dateien möglich — auch Word (<code className="text-xs">.docx</code>),
                    z. B. Wunschkunde + separater Anbieter-Bogen. In einem Paste mehrere Bögen mit{" "}
                    <code className="text-xs">=====</code> trennen.
                  </p>
                  <Input
                    value={title}
                    disabled={isPending}
                    placeholder="Optionaler Titel (bei einer Datei / einem Paste)"
                    onChange={(e) => setTitle(e.target.value)}
                  />
                  <Textarea
                    value={rawText}
                    disabled={isPending}
                    placeholder={`Wunschkunde & Avatar\n5 Felder\n…\n\nAntwort: …\n\n=====\n\nAnbieter-Fragebogen\n…`}
                    className="min-h-[220px] font-mono text-xs"
                    onChange={(e) => setRawText(e.target.value)}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={rawFileInputRef}
                      type="file"
                      multiple
                      accept={QUESTIONNAIRE_FILE_ACCEPT}
                      className="hidden"
                      onChange={(e) => {
                        const list = e.currentTarget.files;
                        e.currentTarget.value = "";
                        void addRawFiles(list);
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
                      Dateien laden (.docx / .txt)
                    </Button>
                    {files.length > 0 ? (
                      <span className="text-xs text-muted-foreground">
                        {files.length} Datei{files.length === 1 ? "" : "en"} gewählt
                      </span>
                    ) : null}
                  </div>
                  {files.length > 0 ? (
                    <ul className="grid gap-1 rounded-md border px-3 py-2 text-xs">
                      {files.map((f) => (
                        <li key={f.name} className="flex items-center justify-between gap-2">
                          <span className="truncate">{f.name}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2"
                            disabled={isPending}
                            onClick={() =>
                              setFiles((prev) => prev.filter((x) => x.name !== f.name))
                            }
                          >
                            Entfernen
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
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
              {status ? (
                <p className="mt-3 text-sm text-muted-foreground">{status}</p>
              ) : null}
            </div>

            <div className="flex justify-end gap-2 border-t px-4 py-3">
              <Button type="button" variant="ghost" onClick={close} disabled={isPending}>
                Abbrechen
              </Button>
              {tab === "raw" ? (
                <Button
                  type="button"
                  disabled={
                    isPending || (rawText.trim().length < 50 && files.length === 0)
                  }
                  onClick={() => importRaw()}
                >
                  {isPending ? "Importiere…" : "Alle importieren"}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
