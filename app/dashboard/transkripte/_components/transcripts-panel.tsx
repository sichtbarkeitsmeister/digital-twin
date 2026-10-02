"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FileText,
  Loader2,
  Trash2,
  Upload,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";

import { WORKSHOP_CHANGED_EVENT } from "@/app/dashboard/transkripte/_components/workshop-board";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isMarkdownTranscriptFilename } from "@/lib/dt/transcripts/markdown-file";
import type { DtTranscriptListItem } from "@/lib/dt/transcripts/types";
import { readQuestionnaireFileText } from "@/lib/surveys/read-questionnaire-file-text";
import { cn } from "@/lib/utils";

const FILE_ACCEPT =
  ".txt,.md,.markdown,.docx,.vtt,.srt,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const FILE_EXT = /\.(txt|md|markdown|docx|doc|vtt|srt)$/i;

async function readTranscriptFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".docx") || name.endsWith(".doc")) {
    return readQuestionnaireFileText(file);
  }
  const text = (await file.text()).trim();
  if (!text) throw new Error(`„${file.name}“ ist leer.`);
  return text;
}

function isTranscriptFile(file: File): boolean {
  if (FILE_EXT.test(file.name)) return true;
  return (
    file.type === "text/plain" ||
    file.type === "text/markdown" ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

function formatDeDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("de-DE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSpoken(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return null;
  return `${day}.${month}.${year}`;
}

export function TranscriptsPanel(props: {
  organisationId: string;
  organisationName: string;
}) {
  const [items, setItems] = useState<DtTranscriptListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [summarizingId, setSummarizingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [filename, setFilename] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [sourceKind, setSourceKind] = useState<"raw" | "summary">("raw");
  const [spokenOn, setSpokenOn] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [rawById, setRawById] = useState<Record<string, string>>({});
  const [dropHighlight, setDropHighlight] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const notifyWorkshop = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent(WORKSHOP_CHANGED_EVENT, {
        detail: { organisationId: props.organisationId },
      }),
    );
  }, [props.organisationId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/dt/transcripts?org=${encodeURIComponent(props.organisationId)}`,
      );
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        transcripts?: DtTranscriptListItem[];
      };
      if (!res.ok || !json.ok) {
        setError(json.message ?? "Transkripte konnten nicht geladen werden.");
        setItems([]);
        return;
      }
      setItems(json.transcripts ?? []);
    } catch {
      setError("Transkripte konnten nicht geladen werden.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [props.organisationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function applyTranscriptFile(file: File) {
    if (!isTranscriptFile(file)) {
      toast.error("Bitte .txt, .md, .docx, .vtt oder .srt ablegen.");
      return;
    }
    try {
      const text = await readTranscriptFile(file);
      setDraft(text);
      setFilename(file.name);
      if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, ""));
      if (isMarkdownTranscriptFilename(file.name)) {
        setSourceKind("summary");
        toast.success(`„${file.name}“ als Zusammenfassung gelesen.`);
      } else {
        toast.success(`„${file.name}“ gelesen.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Datei konnte nicht gelesen werden.");
    }
  }

  async function saveTranscript() {
    const text = draft.trim();
    if (!text) {
      toast.error("Bitte ein Transkript einfügen oder eine Datei wählen.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/dt/transcripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organisationId: props.organisationId,
          text,
          filename,
          title: title.trim() || null,
          notes: notes.trim() || null,
          sourceKind,
          spokenOn: spokenOn || null,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        transcript?: DtTranscriptListItem;
      };
      if (!res.ok || !json.ok || !json.transcript) {
        toast.error(json.message ?? "Speichern fehlgeschlagen.");
        return;
      }
      setItems((prev) => [json.transcript!, ...prev]);
      setDraft("");
      setFilename(null);
      setTitle("");
      setNotes("");
      setSpokenOn("");
      setSourceKind("raw");
      toast.success("Gespräch gespeichert. Es schreibt noch nichts in den SEO-Berater.");
      notifyWorkshop();
    } catch {
      toast.error("Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  async function summarize(id: string) {
    setSummarizingId(id);
    try {
      const res = await fetch(`/api/dt/transcripts/${encodeURIComponent(id)}/summarize`, {
        method: "POST",
      });
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        transcript?: DtTranscriptListItem;
      };
      if (!res.ok || !json.ok || !json.transcript) {
        toast.error(json.message ?? "Zusammenfassung fehlgeschlagen.");
        return;
      }
      setItems((prev) => prev.map((row) => (row.id === id ? { ...row, ...json.transcript } : row)));
      toast.success("Zusammenfassung gespeichert. Freigaben bleiben, bis du neu auswertest.");
      notifyWorkshop();
    } catch {
      toast.error("Zusammenfassung fehlgeschlagen.");
    } finally {
      setSummarizingId(null);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Dieses Gespräch wirklich löschen?")) return;
    const res = await fetch(`/api/dt/transcripts/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const json = (await res.json()) as { ok?: boolean; message?: string };
    if (!res.ok || !json.ok) {
      toast.error(json.message ?? "Löschen fehlgeschlagen.");
      return;
    }
    setItems((prev) => prev.filter((row) => row.id !== id));
    toast.success("Gespräch gelöscht. Freigegebene Stände bleiben, bis du neu auswertest.");
    notifyWorkshop();
  }

  async function loadRaw(id: string) {
    if (rawById[id]) {
      setOpenId((cur) => (cur === id ? null : id));
      return;
    }
    const res = await fetch(`/api/dt/transcripts/${encodeURIComponent(id)}`);
    const json = (await res.json()) as {
      ok?: boolean;
      transcript?: { rawText?: string };
      message?: string;
    };
    if (!res.ok || !json.ok) {
      toast.error(json.message ?? "Text konnte nicht geladen werden.");
      return;
    }
    setRawById((prev) => ({ ...prev, [id]: json.transcript?.rawText ?? "" }));
    setOpenId(id);
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Gespräch hinzufügen</CardTitle>
          <CardDescription>
            Rohtranskript oder fertige Zusammenfassung. Speichern legt nur den Bestand an. Anbieter
            und Avatare entstehen erst nach Freigabe im Workshop darunter.
          </CardDescription>
        </CardHeader>
        <CardContent
          className={cn(
            "relative grid gap-4 rounded-b-xl transition-colors",
            dropHighlight && "bg-sbkm-mint/[0.08]",
          )}
          onDragEnter={(e) => {
            e.preventDefault();
            if (e.dataTransfer.types.includes("Files")) setDropHighlight(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            const rel = e.relatedTarget as Node | null;
            if (!e.currentTarget.contains(rel)) setDropHighlight(false);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDropHighlight(false);
            const files = e.dataTransfer.files;
            if (!files?.length) return;
            void applyTranscriptFile(files[0]!);
          }}
        >
          {dropHighlight ? (
            <div
              className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-sbkm-mint/50 bg-sbkm-mint/[0.08]"
              aria-hidden
            >
              <p className="rounded-xl bg-white/90 px-5 py-3 text-sm font-semibold text-sbkm-navy shadow-sm dark:bg-sbkm-navy/80 dark:text-white">
                Datei hier ablegen
              </p>
            </div>
          ) : null}
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium text-primary">Art</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="source-kind"
                checked={sourceKind === "raw"}
                disabled={isMarkdownTranscriptFilename(filename)}
                onChange={() => setSourceKind("raw")}
              />
              Rohtranskript
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="source-kind"
                checked={sourceKind === "summary"}
                onChange={() => setSourceKind("summary")}
              />
              Zusammenfassung
            </label>
            {isMarkdownTranscriptFilename(filename) ? (
              <p className="text-xs text-secondary">.md wird als Zusammenfassung gelesen.</p>
            ) : null}
          </fieldset>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="transcript-title">Titel</Label>
              <Input
                id="transcript-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={`Workshop ${props.organisationName}`}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="transcript-spoken">Gesprächsdatum</Label>
              <Input
                id="transcript-spoken"
                type="date"
                value={spokenOn}
                onChange={(e) => setSpokenOn(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="transcript-notes">Notiz</Label>
              <Input
                id="transcript-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="z. B. Anbieter-Workshop"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept={FILE_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                void applyTranscriptFile(file);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="size-4" aria-hidden />
              Datei wählen
            </Button>
            {filename ? (
              <span className="text-xs text-secondary">Datei: {filename}</span>
            ) : (
              <span className="text-xs text-secondary">
                .txt, .md, .docx, .vtt, .srt — .md wird als Zusammenfassung gelesen. Oder Datei
                hierher ziehen / Text einfügen.
              </span>
            )}
          </div>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              sourceKind === "summary"
                ? "Zusammenfassung hier einfügen…"
                : "Rohtranskript hier einfügen…"
            }
            className="min-h-[180px] font-mono text-[13px]"
          />
          <div>
            <Button type="button" disabled={saving} onClick={() => void saveTranscript()}>
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Speichern…
                </>
              ) : (
                "Im Bestand speichern"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4" aria-hidden />
            {loading
              ? "Gespräche"
              : `${items.length} ${items.length === 1 ? "Gespräch" : "Gespräche"}`}
          </CardTitle>
          <CardDescription>
            Rohtranskripte kannst du hier zusammenfassen lassen. Die Auswertung des Bestands steht
            darunter.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-secondary">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Lade…
            </p>
          ) : items.length === 0 ? (
            <p className="rounded-xl border border-dashed border-sbkm-navy/15 px-4 py-8 text-center text-sm text-secondary dark:border-white/15">
              Noch keine Gespräche.
            </p>
          ) : (
            <ul className="grid gap-3">
              {items.map((item) => {
                const open = openId === item.id;
                const spoken = formatSpoken(item.spokenOn);
                return (
                  <li
                    key={item.id}
                    className="rounded-xl border border-sbkm-navy/10 bg-white/70 px-4 py-3 dark:border-white/10 dark:bg-white/5"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 grid gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-primary">
                            {item.title || item.filename || "Ohne Titel"}
                          </p>
                          <Badge variant="outline">
                            {item.sourceKind === "summary" ? "Zusammenfassung" : "Rohtranskript"}
                          </Badge>
                        </div>
                        <p className="text-xs text-secondary">
                          {spoken ? `Gespräch ${spoken} · ` : ""}
                          {item.filename ? `${item.filename} · ` : ""}
                          {item.rawTextChars.toLocaleString("de-DE")} Zeichen · hochgeladen{" "}
                          {formatDeDate(item.createdAt)}
                        </p>
                        {item.summary ? (
                          <p className="line-clamp-6 whitespace-pre-wrap text-sm text-sbkm-navy/80 dark:text-white/80">
                            {item.summary}
                          </p>
                        ) : (
                          <p className="text-xs text-secondary">Noch ohne Zusammenfassung.</p>
                        )}
                        {item.errorMessage ? (
                          <p className="flex items-start gap-1.5 text-xs text-destructive">
                            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                            {item.errorMessage}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {item.sourceKind !== "summary" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={summarizingId === item.id || saving}
                            onClick={() => void summarize(item.id)}
                          >
                            {summarizingId === item.id ? (
                              <Loader2 className="size-3.5 animate-spin" aria-hidden />
                            ) : null}
                            {item.summary ? "Zusammenfassung erneuern" : "Zusammenfassen"}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => void loadRaw(item.id)}
                        >
                          {open ? (
                            <ChevronUp className="size-3.5" aria-hidden />
                          ) : (
                            <ChevronDown className="size-3.5" aria-hidden />
                          )}
                          Text
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => void remove(item.id)}
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </Button>
                      </div>
                    </div>
                    {open ? (
                      <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-muted/50 p-3 text-[12px] leading-relaxed whitespace-pre-wrap">
                        {rawById[item.id] || "…"}
                      </pre>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
