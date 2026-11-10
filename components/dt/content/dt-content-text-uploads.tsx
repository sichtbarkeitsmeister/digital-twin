"use client";

import { CONTENT_MAX_BLOCKS } from "@/lib/dt/content/render";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/components/dt/cn";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { DtSelect } from "@/components/dt/dt-select";
import { contentApi, contentQuery } from "@/components/dt/content/content-api";
import type {
  ContentApiResponse,
  ContentOverview,
  ContentTextUploadResult,
  ContentTextUploadTakeoverResult,
  ContentTextUploadView,
  ContentTextUploadsResult,
} from "@/lib/dt/content/types";
import {
  TEXT_UPLOAD_ACCEPT,
  TEXT_UPLOAD_MAX_FILE_BYTES,
  TEXT_UPLOAD_PARALLEL,
  TEXT_UPLOAD_STATUS_LABELS,
  pageNameKey,
  type TextUploadStatus,
} from "@/lib/dt/content/upload-match";

/** A file that never reached the table: refused in the browser, a second file with the same name in one selection, or a failed request. */
type LocalRow = {
  id: string;
  file_name: string;
  kind: "error" | "duplicate";
  note: string;
  /** Kept for „Ersetzen“ on a duplicate: it then replaces the text of the first file. */
  file: File | null;
};

const boxClass = "grid gap-3 rounded-xl border border-sbkm-navy/8 bg-sbkm-navy/[0.02] p-4 text-sm dark:border-white/8 dark:bg-white/[0.03]";
const linkButtonClass =
  "text-xs font-semibold text-sbkm-navy underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-sbkm-mint";

const STATUS_TONE: Record<TextUploadStatus, string> = {
  auto: "bg-sbkm-mint/30 text-sbkm-navy dark:bg-sbkm-mint/20 dark:text-white",
  manual: "bg-sbkm-mint/30 text-sbkm-navy dark:bg-sbkm-mint/20 dark:text-white",
  unassigned: "bg-sbkm-navy/[0.06] text-sbkm-ink-600 dark:bg-white/10 dark:text-white/70",
  waiting: "bg-sbkm-navy/[0.06] text-sbkm-ink-600 dark:bg-white/10 dark:text-white/70",
  ambiguous: "bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200",
  duplicate: "bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200",
  error: "bg-red-100 text-red-800 dark:bg-red-400/15 dark:text-red-200",
};

function filesWord(n: number): string {
  return `${n} ${n === 1 ? "Datei" : "Dateien"}`;
}

function pagesWord(n: number): string {
  return `${n} ${n === 1 ? "Seite" : "Seiten"}`;
}

/** One Word file per request (multipart); never throws. */
async function postUpload(
  organisationId: string,
  file: File,
  options: { replace?: boolean; uploadId?: string } = {},
): Promise<ContentApiResponse<ContentTextUploadResult>> {
  const form = new FormData();
  form.set("organisationId", organisationId);
  form.set("file", file);
  if (options.replace) form.set("replace", "1");
  if (options.uploadId) form.set("uploadId", options.uploadId);
  try {
    const res = await fetch("/api/dt/content/uploads", { method: "POST", body: form, cache: "no-store" });
    const json = (await res.json().catch(() => null)) as ContentApiResponse<ContentTextUploadResult> | null;
    if (!json) {
      return { ok: false, message: res.status === 413 ? "Die Datei ist zu groß für den Upload." : `Unerwartete Antwort (${res.status}).` };
    }
    if (!res.ok && json.ok) return { ok: false, message: `Fehler (${res.status}).` };
    return json;
  } catch {
    return { ok: false, message: "Keine Verbindung. Bitte erneut versuchen." };
  }
}

function StatusCell(props: { status: TextUploadStatus; note: string | null }) {
  const label = props.status === "error" ? `Fehler: ${props.note ?? "Datei nicht lesbar"}` : TEXT_UPLOAD_STATUS_LABELS[props.status];
  return (
    <span className="grid gap-1">
      <span className={cn("w-fit rounded-pill px-2 py-0.5 text-[11px] font-bold", STATUS_TONE[props.status], props.status === "error" && "rounded-lg")}>
        {label}
      </span>
      {props.status !== "error" && props.note ? (
        <span className="text-[11px] leading-snug text-sbkm-ink-500 dark:text-white/50">{props.note}</span>
      ) : null}
    </span>
  );
}

/**
 * „Verbesserung → Texte hochladen“: Word files (file name = page name) for a client whose
 * website is not live yet. Upload (one request per file, three at a time), the table
 * „Hochgeladene Texte“ with the name match and the manual assignment, the summary line and
 * „Zugeordnete Seiten übernehmen“.
 */
export function DtContentTextUploads(props: {
  organisationId: string;
  /** Changes when the Seitenstruktur or the table changed: the files are matched again. */
  refreshKey: string;
  /** After every load: the card filters „Seiten ohne Word-Datei“ with it. */
  onLoaded: (result: ContentTextUploadsResult) => void;
  /** After a takeover or a removal that touched the table. */
  onChanged: (overview?: ContentOverview) => void;
}) {
  const { organisationId, onLoaded, onChanged } = props;
  const [data, setData] = useState<ContentTextUploadsResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [localRows, setLocalRows] = useState<LocalRow[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [taking, setTaking] = useState(false);
  const [takeoverNote, setTakeoverNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const filesRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<ContentTextUploadView | null>(null);
  const localSeq = useRef(0);

  const apply = useCallback(
    (result: ContentTextUploadsResult) => {
      setData(result);
      setLoadError(null);
      onLoaded(result);
    },
    [onLoaded],
  );

  const load = useCallback(async () => {
    const res = await contentApi<ContentTextUploadsResult>(`/api/dt/content/uploads?${contentQuery(organisationId)}`);
    if (res.ok) apply(res.data);
    else setLoadError(res.message);
  }, [organisationId, apply]);

  useEffect(() => {
    void load();
  }, [load, props.refreshKey]);

  const uploading = progress != null;
  const busy = uploading || busyId != null || taking;

  function addLocal(file_name: string, kind: LocalRow["kind"], note: string, file: File | null = null) {
    localSeq.current += 1;
    const id = `local-${localSeq.current}`;
    setLocalRows((rows) => [...rows, { id, file_name, kind, note, file }]);
  }

  /** The queue: at most `TEXT_UPLOAD_PARALLEL` requests at once, each with one file. */
  async function runQueue(jobs: Array<{ file: File; replace: boolean }>) {
    if (jobs.length === 0) return;
    setProgress({ done: 0, total: jobs.length });
    let next = 0;
    let read = 0;
    let failed = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next++]!;
        const res = await postUpload(organisationId, job.file, { replace: job.replace });
        if (!res.ok) {
          failed += 1;
          addLocal(job.file.name, "error", res.message);
        } else if (res.data.error) {
          failed += 1;
          // A stored file shows its error in the table; a refused replacement only here.
          if (job.replace) addLocal(job.file.name, "error", res.data.error);
        } else {
          read += 1;
        }
        setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
      }
    };
    await Promise.all(Array.from({ length: Math.min(TEXT_UPLOAD_PARALLEL, jobs.length) }, worker));
    setProgress(null);
    await load();
    const parts = [`${filesWord(read)} gelesen`, failed > 0 ? `${failed} mit Fehler (siehe Tabelle)` : ""].filter(Boolean);
    if (failed > 0 && read === 0) toast.error(parts.join(" · "));
    else toast.success(parts.join(" · "));
  }

  async function addFiles(list: FileList | File[] | null | undefined) {
    const files = Array.from(list ?? []);
    if (files.length === 0 || busy) return;
    const stored = new Map((data?.uploads ?? []).map((u) => [pageNameKey(u.file_name), u]));
    const seen = new Map<string, File>();
    const fresh: File[] = [];
    const existing: File[] = [];
    for (const file of files) {
      if (!/\.docx?$/i.test(file.name)) {
        addLocal(file.name, "error", "Keine Word-Datei. Erlaubt ist nur .docx.");
        continue;
      }
      if (file.size > TEXT_UPLOAD_MAX_FILE_BYTES) {
        addLocal(file.name, "error", `Zu groß (max. ${Math.round(TEXT_UPLOAD_MAX_FILE_BYTES / (1024 * 1024))} MB).`);
        continue;
      }
      const key = pageNameKey(file.name);
      if (!key) {
        addLocal(file.name, "error", "Der Dateiname ergibt keinen Seitennamen.");
        continue;
      }
      const first = seen.get(key);
      if (first) {
        addLocal(file.name, "duplicate", `Gleicher Seitenname wie die Datei „${first.name}“`, file);
        continue;
      }
      seen.set(key, file);
      const known = stored.get(key);
      if (known && known.status !== "error") existing.push(file);
      else fresh.push(file);
    }
    let replace: File[] = [];
    if (existing.length > 0) {
      const names = existing.slice(0, 8).map((f) => `„${f.name}“`).join(", ");
      const more = existing.length > 8 ? ` und ${existing.length - 8} weitere` : "";
      const question =
        existing.length === 1
          ? `${names} ist bereits hochgeladen. Den gespeicherten Text durch die neue Datei ersetzen?`
          : `${existing.length} Dateien sind bereits hochgeladen: ${names}${more}. Die gespeicherten Texte durch die neuen Dateien ersetzen?`;
      if (window.confirm(question)) replace = existing;
      else toast.message(`${filesWord(existing.length)} übersprungen – der gespeicherte Text bleibt.`);
    }
    await runQueue([...fresh.map((file) => ({ file, replace: false })), ...replace.map((file) => ({ file, replace: true }))]);
  }

  /** „Ersetzen“ on a duplicate of one selection: it takes the place of the first file's text. */
  async function replaceWithLocal(row: LocalRow) {
    if (!row.file || busy) return;
    if (!window.confirm(`Den gespeicherten Text dieses Seitennamens durch „${row.file_name}“ ersetzen?`)) return;
    setLocalRows((rows) => rows.filter((r) => r.id !== row.id));
    await runQueue([{ file: row.file, replace: true }]);
  }

  async function replaceStored(file: File | undefined) {
    const target = replaceTarget.current;
    replaceTarget.current = null;
    if (!file || !target || busy) return;
    if (!/\.docx?$/i.test(file.name)) {
      toast.error("Keine Word-Datei. Erlaubt ist nur .docx.");
      return;
    }
    if (file.size > TEXT_UPLOAD_MAX_FILE_BYTES) {
      toast.error(`„${file.name}“ ist zu groß (max. ${Math.round(TEXT_UPLOAD_MAX_FILE_BYTES / (1024 * 1024))} MB).`);
      return;
    }
    if (target.status !== "error" && !window.confirm(`Den Text von „${target.file_name}“ durch „${file.name}“ ersetzen?`)) return;
    setBusyId(target.id);
    try {
      const res = await postUpload(organisationId, file, { uploadId: target.id });
      if (!res.ok) toast.error(res.message);
      else if (res.data.error) toast.error(res.data.error);
      else {
        toast.success(`Text ersetzt: „${file.name}“`, {
          description: target.page ? "Die Seite nutzt den neuen Text ab ihrem nächsten Lauf oder nach „Zurücksetzen“." : undefined,
        });
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function assign(upload: ContentTextUploadView, structureSlug: string | null) {
    if (busy) return;
    if (!structureSlug && upload.page && !window.confirm(`„${upload.file_name}“ wird von der Seite „${upload.page.name}“ gelöst. Die Seite bleibt in der Tabelle und wird beim nächsten Lauf neu geschrieben. Fortfahren?`)) {
      return;
    }
    setBusyId(upload.id);
    try {
      const res = await contentApi<ContentTextUploadsResult>("/api/dt/content/uploads/assign", {
        method: "POST",
        body: { organisationId, uploadId: upload.id, structureSlug },
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      apply(res.data);
      if (upload.page) onChanged();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(upload: ContentTextUploadView) {
    if (busy) return;
    const question = upload.page
      ? `„${upload.file_name}“ entfernen? Die Seite „${upload.page.name}“ bleibt in der Tabelle (mit Stand und Text) und wird beim nächsten Lauf neu geschrieben.`
      : `„${upload.file_name}“ entfernen? Der gespeicherte Text wird gelöscht.`;
    if (!window.confirm(question)) return;
    setBusyId(upload.id);
    try {
      const res = await contentApi<ContentTextUploadsResult>(`/api/dt/content/uploads/${upload.id}?${contentQuery(organisationId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      apply(res.data);
      if (upload.page) onChanged();
    } finally {
      setBusyId(null);
    }
  }

  async function takeOver() {
    if (busy) return;
    setTaking(true);
    try {
      const res = await contentApi<ContentTextUploadTakeoverResult>("/api/dt/content/uploads/takeover", {
        method: "POST",
        body: { organisationId },
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const d = res.data;
      const parts = [
        d.created > 0 ? `${pagesWord(d.created)} neu in der Tabelle` : "",
        d.attached > 0 ? `${d.attached} vorhandene mit der Word-Datei verknüpft` : "",
        d.created + d.attached === 0 ? "Keine neue Seite" : "",
        d.over_limit > 0 ? `${d.over_limit} über dem Limit von 300` : "",
        d.skipped.length > 0 ? `${d.skipped.length} übersprungen` : "",
      ].filter(Boolean);
      toast.success("Zugeordnete Seiten übernommen", { description: parts.join(" · ") });
      const notes = [
        d.kept_started > 0
          ? `${pagesWord(d.kept_started)} ${d.kept_started === 1 ? "war" : "waren"} bereits begonnen: Stand und Text bleiben. Die Word-Datei zählt ab dem nächsten Lauf oder nach „Zurücksetzen“.`
          : "",
        ...d.skipped.map((s) => `„${s.file}“: ${s.reason}`),
      ].filter(Boolean);
      setTakeoverNote(notes.length > 0 ? notes.join(" ") : null);
      apply(d.uploads);
      onChanged(d.overview);
    } finally {
      setTaking(false);
    }
  }

  if (data && !data.supported) {
    return (
      <div className={boxClass} data-testid="content-text-uploads">
        <p className="text-xs text-red-700 dark:text-red-300">{data.hint}</p>
      </div>
    );
  }

  const uploads = data?.uploads ?? [];
  const freeOptions = (data?.free_pages ?? []).map((p) => ({ value: p.slug, label: p.name, description: p.path ?? undefined }));
  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const pending = data?.summary.pending ?? 0;

  return (
    <div className={boxClass} data-testid="content-text-uploads">
      <div className="grid gap-1">
        <h3 className="text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/60">Word-Dateien hochladen</h3>
        <p className="text-xs text-sbkm-ink-600 dark:text-white/65">
          Je Seite eine Word-Datei (.docx): Der Dateiname ist der Seitenname, der Inhalt ist der bisherige Text der Seite.
        </p>
      </div>

      <input
        ref={filesRef}
        type="file"
        multiple
        accept={TEXT_UPLOAD_ACCEPT}
        className="sr-only"
        aria-label="Word-Dateien wählen"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void addFiles(files);
        }}
      />
      <input
        ref={replaceRef}
        type="file"
        accept={TEXT_UPLOAD_ACCEPT}
        className="sr-only"
        aria-label="Ersatzdatei wählen"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void replaceStored(file);
        }}
      />

      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void addFiles(event.dataTransfer.files);
        }}
        className={cn(
          "flex flex-wrap items-center gap-3 rounded-xl border border-dashed p-4 transition-colors",
          dragging
            ? "border-sbkm-mint bg-sbkm-mint/[0.12] dark:border-sbkm-mint/70 dark:bg-sbkm-mint/[0.08]"
            : "border-sbkm-navy/20 bg-white/60 dark:border-white/15 dark:bg-white/[0.03]",
        )}
      >
        <DtPillButton type="button" size="sm" disabled={busy} onClick={() => filesRef.current?.click()}>
          {uploading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
          Word-Dateien wählen
        </DtPillButton>
        <span className="text-xs text-sbkm-ink-600 dark:text-white/65">
          oder Dateien hierher ziehen · eine oder viele · nur .docx · je Datei höchstens{" "}
          {Math.round(TEXT_UPLOAD_MAX_FILE_BYTES / (1024 * 1024))} MB, 60.000 Zeichen und {CONTENT_MAX_BLOCKS} Abschnitte
        </span>
      </div>

      {progress ? (
        <div className="grid gap-1.5" data-testid="content-text-uploads-progress">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
            aria-label="Word-Dateien werden gelesen"
            className="h-1.5 overflow-hidden rounded-pill bg-sbkm-navy/10 dark:bg-white/10"
          >
            <div className="h-full rounded-pill bg-sbkm-mint transition-[width] duration-200" style={{ width: `${percent}%` }} />
          </div>
          <p className="text-xs tabular-nums text-sbkm-ink-600 dark:text-white/65">
            {progress.done} von {progress.total} gelesen
          </p>
        </div>
      ) : null}

      {loadError ? <p className="text-xs text-red-700 dark:text-red-300">{loadError}</p> : null}

      {!data && !loadError ? (
        <p className="flex items-center gap-2 text-xs text-sbkm-ink-600 dark:text-white/65">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Hochgeladene Texte werden geladen …
        </p>
      ) : null}

      {data && !data.has_structure && uploads.length > 0 ? (
        <p className="text-xs text-sbkm-ink-600 dark:text-white/65">
          Noch keine Seitenstruktur: Die Dateien warten und werden zugeordnet, sobald die Seitenstruktur hochgeladen ist.
        </p>
      ) : null}

      {uploads.length > 0 || localRows.length > 0 ? (
        <div className="grid gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/60">Hochgeladene Texte</h3>
          <div className="max-h-[28rem] overflow-auto rounded-lg border border-sbkm-navy/8 bg-white/70 scrollbar-subtle dark:border-white/8 dark:bg-white/[0.04]">
            <table className="w-full min-w-[46rem] border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-white/95 text-[11px] uppercase tracking-wider text-sbkm-ink-500 backdrop-blur dark:bg-sbkm-navy/95 dark:text-white/45">
                <tr>
                  <th className="px-3 py-2 font-bold">Dateiname</th>
                  <th className="px-3 py-2 font-bold">Seite aus der Seitenstruktur</th>
                  <th className="px-3 py-2 font-bold">Status</th>
                  <th className="px-3 py-2 font-bold">Abschnitte / Zeichen</th>
                  <th className="px-3 py-2 font-bold">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sbkm-navy/8 dark:divide-white/8">
                {uploads.map((upload) => {
                  const rowBusy = busyId === upload.id;
                  const assignable = data?.has_structure && !upload.structure && upload.status !== "error";
                  return (
                    <tr key={upload.id} className="align-top">
                      <td className="px-3 py-2">
                        <span className="flex items-start gap-1.5 font-semibold text-sbkm-navy dark:text-white">
                          <FileText className="mt-0.5 size-3.5 shrink-0 text-sbkm-ink-500 dark:text-white/45" aria-hidden />
                          <span className="break-all">{upload.file_name}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {upload.structure ? (
                          <span className="grid gap-0.5">
                            <span className="font-semibold text-sbkm-navy dark:text-white">{upload.structure.name}</span>
                            {upload.structure.path ? (
                              <span className="font-mono text-[11px] text-sbkm-ink-500 dark:text-white/45">{upload.structure.path}</span>
                            ) : null}
                            <span className="text-[11px] text-sbkm-ink-500 dark:text-white/50">
                              {upload.page ? "in der Tabelle" : "noch nicht übernommen"}
                            </span>
                          </span>
                        ) : assignable ? (
                          <DtSelect
                            size="sm"
                            searchable
                            value=""
                            placeholder={freeOptions.length > 0 ? "Seite wählen …" : "Keine freie Seite"}
                            srLabel={`Seite für ${upload.file_name} wählen`}
                            disabled={busy || freeOptions.length === 0}
                            options={freeOptions}
                            onValueChange={(slug) => void assign(upload, slug)}
                          />
                        ) : (
                          <span className="text-sbkm-ink-500 dark:text-white/45">—</span>
                        )}
                        {!upload.structure && upload.page ? (
                          <span className="mt-1 block text-[11px] text-sbkm-ink-500 dark:text-white/50">
                            noch von der Seite „{upload.page.name}“ genutzt
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <StatusCell status={upload.status} note={upload.note} />
                      </td>
                      <td className="px-3 py-2 tabular-nums text-sbkm-ink-600 dark:text-white/65">
                        {upload.status === "error" ? "—" : `${upload.sections} / ${upload.chars.toLocaleString("de-DE")}`}
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          {rowBusy ? <Loader2 className="size-3.5 animate-spin text-sbkm-ink-500" aria-hidden /> : null}
                          {upload.structure ? (
                            <button type="button" className={linkButtonClass} disabled={busy} onClick={() => void assign(upload, null)}>
                              Zuordnung lösen
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className={linkButtonClass}
                            disabled={busy}
                            onClick={() => {
                              replaceTarget.current = upload;
                              replaceRef.current?.click();
                            }}
                          >
                            Ersetzen
                          </button>
                          <button type="button" className={linkButtonClass} disabled={busy} onClick={() => void remove(upload)}>
                            Entfernen
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {localRows.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="px-3 py-2">
                      <span className="flex items-start gap-1.5 font-semibold text-sbkm-navy dark:text-white">
                        <FileText className="mt-0.5 size-3.5 shrink-0 text-sbkm-ink-500 dark:text-white/45" aria-hidden />
                        <span className="break-all">{row.file_name}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-sbkm-ink-500 dark:text-white/45">—</td>
                    <td className="px-3 py-2">
                      <StatusCell status={row.kind} note={row.note} />
                    </td>
                    <td className="px-3 py-2 text-sbkm-ink-500 dark:text-white/45">nicht gespeichert</td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {row.kind === "duplicate" && row.file ? (
                          <button type="button" className={linkButtonClass} disabled={busy} onClick={() => void replaceWithLocal(row)}>
                            Ersetzen
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={linkButtonClass}
                          onClick={() => setLocalRows((rows) => rows.filter((r) => r.id !== row.id))}
                        >
                          Entfernen
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : data ? (
        <p className="text-xs text-sbkm-ink-600 dark:text-white/65">Noch keine Word-Datei hochgeladen.</p>
      ) : null}

      {data ? (
        <p className="text-xs font-semibold text-sbkm-navy dark:text-white" data-testid="content-text-uploads-summary">
          {data.summary.assigned} zugeordnet · {data.summary.unassigned} ohne Zuordnung · {pagesWord(data.summary.pages_without_text)} der
          Seitenstruktur ohne Text
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <DtPillButton type="button" size="sm" disabled={busy || pending === 0} onClick={() => void takeOver()}>
          {taking ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Zugeordnete Seiten übernehmen
        </DtPillButton>
        {data && data.summary.assigned > 0 && pending === 0 ? (
          <span className="text-xs text-sbkm-ink-600 dark:text-white/65">Alle zugeordneten Dateien stehen in der Tabelle.</span>
        ) : null}
      </div>
      {takeoverNote ? <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-200">{takeoverNote}</p> : null}
      <p className="text-[11px] leading-relaxed text-sbkm-ink-500 dark:text-white/45">
        Zugeordnet wird nur über den Namen, ohne KI: Groß- und Kleinschreibung, Umlaute (ä = ae, ß = ss), Unterstrich, Bindestrich und
        Zeichen, die in Dateinamen nicht erlaubt sind (/ \ : * ? &quot; &lt; &gt; |), zählen nicht. Alles andere ordnen Sie von Hand zu;
        eine Zuordnung von Hand bleibt, auch wenn die Seitenstruktur neu hochgeladen wird. „Übernehmen“ legt je zugeordneter Datei eine
        Zeile an oder hängt die Datei an die vorhandene Zeile (höchstens 300 Zeilen); die Seiten werden dann wie gecrawlte Seiten
        verbessert. Gespeichert wird nur der ausgelesene Text, nicht die Word-Datei.
      </p>
    </div>
  );
}
