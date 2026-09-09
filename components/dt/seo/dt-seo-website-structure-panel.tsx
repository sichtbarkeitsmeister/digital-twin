"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FolderTree, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { DtField } from "@/components/dt/dt-field";
import { Textarea } from "@/components/ui/textarea";
import { readQuestionnaireFileText } from "@/lib/surveys/read-questionnaire-file-text";

type StructurePayload = {
  organisationId: string;
  filename: string | null;
  outline: string;
  nodeCount: number;
  notes: string | null;
  uploadedAt: string;
  rawText: string;
};

function formatDeDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("de-DE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const FILE_ACCEPT =
  ".txt,.md,.markdown,.csv,.json,.xml,.docx,text/plain,text/markdown,text/csv,application/json,application/xml,text/xml,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function readStructureFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".docx") || name.endsWith(".doc")) {
    return readQuestionnaireFileText(file);
  }
  const text = (await file.text()).trim();
  if (!text) throw new Error(`„${file.name}“ ist leer.`);
  return text;
}

export function DtSeoWebsiteStructurePanel(props: {
  organisationId: string;
  canEdit: boolean;
  onOpenChat?: () => void;
}) {
  const [data, setData] = useState<StructurePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [notes, setNotes] = useState("");
  const [filename, setFilename] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/dt/seo/website-structure?org=${encodeURIComponent(props.organisationId)}`,
      );
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        structure?: StructurePayload | null;
      };
      if (!res.ok || !json.ok) {
        setError(json.message ?? "Struktur konnte nicht geladen werden.");
        setData(null);
        return;
      }
      setData(json.structure ?? null);
      setDraft(json.structure?.rawText ?? "");
      setNotes(json.structure?.notes ?? "");
      setFilename(json.structure?.filename ?? null);
    } catch {
      setError("Struktur konnte nicht geladen werden.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [props.organisationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function save() {
    if (!props.canEdit) return;
    const text = draft.trim();
    if (!text) {
      toast.error("Bitte zuerst eine Struktur einfügen oder eine Datei wählen.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/dt/seo/website-structure", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organisationId: props.organisationId,
          text,
          filename,
          notes: notes.trim() || null,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        structure?: StructurePayload;
      };
      if (!res.ok || !json.ok || !json.structure) {
        toast.error(json.message ?? "Speichern fehlgeschlagen.");
        return;
      }
      setData(json.structure);
      setDraft(json.structure.rawText);
      setNotes(json.structure.notes ?? "");
      setFilename(json.structure.filename);
      toast.success("Webseitenstruktur gespeichert. Der DigitalTwin kann sie jetzt lesen.");
    } catch {
      toast.error("Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!props.canEdit || !data) return;
    if (!window.confirm("Hochgeladene Webseitenstruktur wirklich löschen?")) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/dt/seo/website-structure?org=${encodeURIComponent(props.organisationId)}`,
        { method: "DELETE" },
      );
      const json = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !json.ok) {
        toast.error(json.message ?? "Löschen fehlgeschlagen.");
        return;
      }
      setData(null);
      setDraft("");
      setNotes("");
      setFilename(null);
      toast.success("Webseitenstruktur entfernt.");
    } catch {
      toast.error("Löschen fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  async function onPickFile(file: File | undefined) {
    if (!file || !props.canEdit) return;
    try {
      const text = await readStructureFile(file);
      setDraft(text);
      setFilename(file.name);
      toast.success(`„${file.name}“ gelesen — bitte speichern.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Datei konnte nicht gelesen werden.");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-10">
      <DtGlassCard>
        <div className="flex items-start gap-3">
          <span className="inline-grid size-10 shrink-0 place-items-center rounded-xl bg-sbkm-mint/20 text-sbkm-navy dark:text-sbkm-mint">
            <FolderTree className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight text-sbkm-navy dark:text-white">
              Webseitenstruktur
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-sbkm-ink-600 dark:text-white/65">
              Lade die Informationsarchitektur dieser Organisation hoch (Menübaum, Sitemap,
              URL-Liste). Der DigitalTwin liest sie im SEO-Chat, kann sie einsehen und
              Verbesserungsvorschläge machen — getrennt vom Crawl der Live-Seiten.
            </p>
          </div>
        </div>

        {loading ? (
          <p className="mt-5 flex items-center gap-2 text-sm text-sbkm-ink-500">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Wird geladen …
          </p>
        ) : error ? (
          <p className="mt-5 text-sm text-red-700 dark:text-red-300">{error}</p>
        ) : (
          <>
            {data ? (
              <div className="mt-5 rounded-xl border border-sbkm-navy/10 bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.04]">
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-sbkm-ink-500 dark:text-white/45">
                  Aktuell für den Twin
                </p>
                <p className="mt-1 text-sm text-sbkm-ink-600 dark:text-white/60">
                  {data.nodeCount} Einträge
                  {data.filename ? ` · ${data.filename}` : ""}
                  {` · ${formatDeDate(data.uploadedAt)}`}
                </p>
                <pre className="mt-3 max-h-[min(22rem,50vh)] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-sbkm-navy/[0.04] p-3 text-xs leading-relaxed text-sbkm-navy scrollbar-subtle dark:bg-white/[0.05] dark:text-white/85">
                  {data.outline}
                </pre>
              </div>
            ) : (
              <p className="mt-5 rounded-xl border border-dashed border-sbkm-navy/15 px-4 py-6 text-sm text-sbkm-ink-500 dark:border-white/15 dark:text-white/50">
                Noch keine Struktur hinterlegt. Datei wählen oder Text einfügen, dann speichern.
              </p>
            )}

            {props.canEdit ? (
              <div className="mt-5 grid gap-4">
                <DtField label="Datei" htmlFor="dt-website-structure-file" optional>
                  <input
                    ref={fileRef}
                    id="dt-website-structure-file"
                    type="file"
                    accept={FILE_ACCEPT}
                    className="block w-full min-w-0 text-sm text-sbkm-ink-600 file:mr-3 file:rounded-pill file:border-0 file:bg-sbkm-navy file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white dark:text-white/70 dark:file:bg-sbkm-mint dark:file:text-sbkm-navy"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      void onPickFile(file);
                    }}
                  />
                  <p className="text-[11px] text-sbkm-ink-500 dark:text-white/45">
                    .md, .txt, Sitemap-.xml, .csv, .json oder .docx
                  </p>
                </DtField>

                <DtField label="Struktur als Text" htmlFor="dt-website-structure-draft">
                  <Textarea
                    id="dt-website-structure-draft"
                    rows={10}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={`- Startseite /\n  - Leistungen /leistungen\n    - SEO /leistungen/seo\n  - Kontakt /kontakt`}
                    className="min-h-[12rem] font-mono text-sm"
                  />
                </DtField>

                <DtField label="Notiz" htmlFor="dt-website-structure-notes" optional>
                  <Textarea
                    id="dt-website-structure-notes"
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="z. B. Stand nach Relaunch-Workshop, Soll-Struktur 2026 …"
                  />
                </DtField>

                <div className="flex flex-wrap items-center gap-2">
                  <DtPillButton
                    type="button"
                    size="sm"
                    disabled={saving || !draft.trim()}
                    onClick={() => void save()}
                  >
                    {saving ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Upload className="size-4" aria-hidden />
                    )}
                    Speichern für den Twin
                  </DtPillButton>
                  {data ? (
                    <DtPillButton
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={saving}
                      onClick={() => void remove()}
                    >
                      <Trash2 className="size-4" aria-hidden />
                      Entfernen
                    </DtPillButton>
                  ) : null}
                  {props.onOpenChat ? (
                    <DtPillButton
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={props.onOpenChat}
                    >
                      Im SEO-Chat prüfen
                    </DtPillButton>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="mt-4 text-xs text-sbkm-ink-500 dark:text-white/50">
                Nur Plattform-Administratoren können die Struktur ändern.
              </p>
            )}
          </>
        )}
      </DtGlassCard>
    </div>
  );
}
