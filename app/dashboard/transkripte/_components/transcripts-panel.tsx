"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  FileText,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import type {
  DtTranscriptListItem,
  DtTranscriptPersonaExtract,
} from "@/lib/dt/transcripts/types";
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

function statusBadge(status: DtTranscriptListItem["status"]) {
  switch (status) {
    case "processed":
      return <Badge>Ausgewertet</Badge>;
    case "processing":
      return <Badge variant="secondary">Wird ausgewertet</Badge>;
    case "error":
      return <Badge variant="destructive">Fehler</Badge>;
    default:
      return <Badge variant="outline">Gespeichert</Badge>;
  }
}

export function TranscriptsPanel(props: {
  organisationId: string;
  organisationName: string;
}) {
  const [items, setItems] = useState<DtTranscriptListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [selectedNames, setSelectedNames] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [filename, setFilename] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [rawById, setRawById] = useState<Record<string, string>>({});
  const [dropHighlight, setDropHighlight] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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
      toast.success(`„${file.name}“ gelesen.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Datei konnte nicht gelesen werden.");
    }
  }

  async function processTranscript(id: string) {
    setProcessingId(id);
    try {
      const res = await fetch(`/api/dt/transcripts/${encodeURIComponent(id)}/process`, {
        method: "POST",
      });
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        transcript?: DtTranscriptListItem;
        pendingPersonas?: DtTranscriptPersonaExtract[];
        updatedPersonaIds?: string[];
        warnings?: string[];
      };
      if (!res.ok || !json.ok || !json.transcript) {
        toast.error(json.message ?? "Auswertung fehlgeschlagen.");
        await refresh();
        return;
      }
      const pending = json.pendingPersonas ?? json.transcript.pendingPersonas ?? [];
      setItems((prev) =>
        prev.map((row) =>
          row.id === id ? { ...json.transcript!, pendingPersonas: pending } : row,
        ),
      );
      setSelectedNames((prev) => ({ ...prev, [id]: [] }));
      const updated = json.updatedPersonaIds?.length ?? 0;
      const pendingCount = pending.length;
      toast.success(
        pendingCount
          ? `Ausgewertet. ${pendingCount} Persona${pendingCount === 1 ? "" : "s"} warten auf Bestätigung.`
          : updated
            ? `Ausgewertet. ${updated} bestehende Persona${updated === 1 ? "" : "s"} ergänzt.`
            : "Ausgewertet. Anbieterwissen wurde übernommen.",
      );
      if (json.warnings?.length) {
        toast.message(json.warnings.slice(0, 3).join(" · "));
      }
    } catch {
      toast.error("Auswertung fehlgeschlagen.");
      await refresh();
    } finally {
      setProcessingId(null);
    }
  }

  async function saveAndProcess() {
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
      toast.success("Transkript gespeichert — Auswertung startet.");
      await processTranscript(json.transcript.id);
    } catch {
      toast.error("Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  function togglePersona(transcriptId: string, name: string, checked: boolean) {
    setSelectedNames((prev) => {
      const current = prev[transcriptId] ?? [];
      const next = checked
        ? [...current, name]
        : current.filter((item) => item !== name);
      return { ...prev, [transcriptId]: next };
    });
  }

  async function confirmPersonas(item: DtTranscriptListItem) {
    const names = selectedNames[item.id] ?? [];
    if (names.length === 0) {
      toast.error("Bitte mindestens eine Persona auswählen.");
      return;
    }
    setConfirmingId(item.id);
    try {
      const res = await fetch(`/api/dt/transcripts/${encodeURIComponent(item.id)}/personas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        createdNames?: string[];
        pendingPersonas?: DtTranscriptPersonaExtract[];
        warnings?: string[];
      };
      if (!res.ok || !json.ok) {
        toast.error(json.message ?? "Personas konnten nicht angelegt werden.");
        return;
      }
      const created = json.createdNames?.length ?? 0;
      setItems((prev) =>
        prev.map((row) =>
          row.id === item.id
            ? { ...row, pendingPersonas: json.pendingPersonas ?? [] }
            : row,
        ),
      );
      setSelectedNames((prev) => ({ ...prev, [item.id]: [] }));
      toast.success(
        created
          ? `${created} Persona${created === 1 ? "" : "s"} angelegt.`
          : "Keine neue Persona angelegt.",
      );
      if (json.warnings?.length) {
        toast.message(json.warnings.slice(0, 3).join(" · "));
      }
    } catch {
      toast.error("Personas konnten nicht angelegt werden.");
    } finally {
      setConfirmingId(null);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Dieses Transkript wirklich löschen?")) return;
    const res = await fetch(`/api/dt/transcripts/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const json = (await res.json()) as { ok?: boolean; message?: string };
    if (!res.ok || !json.ok) {
      toast.error(json.message ?? "Löschen fehlgeschlagen.");
      return;
    }
    setItems((prev) => prev.filter((row) => row.id !== id));
    toast.success("Transkript gelöscht.");
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
          <CardTitle className="text-base">Neues Transkript</CardTitle>
          <CardDescription>
            Nach dem Kundeninterview hier hochladen. Der Twin übernimmt das Anbieterwissen
            automatisch. Erkannte Personas werden erst angelegt, wenn du sie bestätigst.
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
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="transcript-title">Titel (optional)</Label>
              <Input
                id="transcript-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={`Meeting ${props.organisationName}`}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="transcript-notes">Notiz (optional)</Label>
              <Input
                id="transcript-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="z. B. Kick-off, 16.09."
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
                .txt, .md, .docx, .vtt, .srt — oder Datei hierher ziehen / Text einfügen
              </span>
            )}
          </div>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Transkript hier einfügen…"
            className="min-h-[180px] font-mono text-[13px]"
          />
          <div>
            <Button
              type="button"
              disabled={saving || processingId != null}
              onClick={() => void saveAndProcess()}
            >
              {saving || processingId ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Speichern und auswerten…
                </>
              ) : (
                "Speichern und auswerten"
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
              ? "Transkripte"
              : `${items.length} ${items.length === 1 ? "Transkript" : "Transkripte"}`}
          </CardTitle>
          <CardDescription>
            Gespeicherte Interviews dieser Organisation. Anbieterwissen fließt in den
            SEO-Berater. Neue Personas legt nur eine Bestätigung an.
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
              Noch keine Transkripte. Nach dem Meeting Datei oder Text speichern.
            </p>
          ) : (
            <ul className="grid gap-3">
              {items.map((item) => {
                const open = openId === item.id;
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
                          {statusBadge(item.status)}
                        </div>
                        <p className="text-xs text-secondary">
                          {item.filename ? `${item.filename} · ` : ""}
                          {item.rawTextChars.toLocaleString("de-DE")} Zeichen ·{" "}
                          {formatDeDate(item.createdAt)}
                        </p>
                        {item.summary ? (
                          <p className="text-sm text-sbkm-navy/80 dark:text-white/80">{item.summary}</p>
                        ) : null}
                        {item.personas.length > 0 ? (
                          <p className="text-xs text-secondary">
                            Personas:{" "}
                            {item.personas
                              .map((p) => `${p.name} (${p.priority})`)
                              .join(" · ")}
                          </p>
                        ) : null}
                        {item.errorMessage ? (
                          <p className="flex items-start gap-1.5 text-xs text-destructive">
                            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                            {item.errorMessage}
                          </p>
                        ) : null}
                        {item.appliedAt && item.status === "processed" ? (
                          <p className="flex items-center gap-1 text-xs text-secondary">
                            <CheckCircle2 className="size-3.5 text-emerald-600" aria-hidden />
                            Dem Twin-Wissen zugeordnet {formatDeDate(item.appliedAt)}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={processingId === item.id || saving}
                          onClick={() => void processTranscript(item.id)}
                        >
                          {processingId === item.id ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden />
                          ) : (
                            <RefreshCw className="size-3.5" aria-hidden />
                          )}
                          {item.status === "processed" ? "Erneut auswerten" : "Auswerten"}
                        </Button>
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
                    {(item.pendingPersonas ?? []).length > 0 ? (
                      <div className="mt-3 grid gap-3 rounded-lg border border-sbkm-navy/10 bg-sbkm-mint/[0.06] p-3 dark:border-white/10">
                        <div className="grid gap-1">
                          <p className="text-xs font-semibold uppercase tracking-wide text-secondary">
                            Erkannte Personas
                          </p>
                          <p className="text-sm text-primary">
                            Diese Typen stehen im Transkript. Es wird nichts angelegt, solange du
                            keine auswählst.
                          </p>
                        </div>
                        <ul className="grid gap-2">
                          {item.pendingPersonas.map((persona, index) => {
                            const checked = (selectedNames[item.id] ?? []).includes(persona.name);
                            const inputId = `persona-${item.id}-${index}`;
                            return (
                              <li key={persona.name} className="flex items-start gap-2">
                                <Checkbox
                                  id={inputId}
                                  className="mt-0.5"
                                  checked={checked}
                                  disabled={confirmingId === item.id}
                                  onCheckedChange={(value) =>
                                    togglePersona(item.id, persona.name, value === true)
                                  }
                                />
                                <label htmlFor={inputId} className="grid gap-0.5 text-sm">
                                  <span className="font-medium text-primary">
                                    {persona.name}
                                    {persona.role ? ` · ${persona.role}` : ""}{" "}
                                    <span className="font-normal text-secondary">
                                      ({persona.priority})
                                    </span>
                                  </span>
                                  {persona.description ? (
                                    <span className="text-xs text-secondary">
                                      {persona.description}
                                    </span>
                                  ) : null}
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                        <div>
                          <Button
                            type="button"
                            size="sm"
                            disabled={
                              confirmingId === item.id ||
                              (selectedNames[item.id] ?? []).length === 0
                            }
                            onClick={() => void confirmPersonas(item)}
                          >
                            {confirmingId === item.id ? (
                              <Loader2 className="size-3.5 animate-spin" aria-hidden />
                            ) : null}
                            Ausgewählte anlegen
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    {open ? (
                      <pre
                        className={cn(
                          "mt-3 max-h-64 overflow-auto rounded-lg bg-muted/50 p-3 text-[12px] leading-relaxed whitespace-pre-wrap",
                        )}
                      >
                        {rawById[item.id] || "…"}
                      </pre>
                    ) : null}
                    {open && item.anbieterMarkdown ? (
                      <div className="mt-3 rounded-lg border border-sbkm-navy/10 p-3 text-sm dark:border-white/10">
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-secondary">
                          Anbieterwissen
                        </p>
                        <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed">
                          {item.anbieterMarkdown}
                        </pre>
                      </div>
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
