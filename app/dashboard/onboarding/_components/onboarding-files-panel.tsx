"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { DtOnboardingFileRow } from "@/lib/dt/onboarding/copy";
import { uploadOnboardingFileToSignedUrl } from "@/lib/dt/onboarding/client-upload";
import {
  guessOnboardingMime,
  isOnboardingImageMime,
  isOnboardingVideoMime,
} from "@/lib/dt/onboarding/mime";
import { cn } from "@/lib/utils";

const ACCEPT =
  "image/jpeg,image/png,image/gif,image/webp,image/svg+xml,application/pdf,video/mp4,video/quicktime,video/webm,.svg,.jpg,.jpeg,.png,.gif,.webp,.pdf,.mp4,.mov,.webm";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("de-DE", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function FilePreview(props: { file: DtOnboardingFileRow }) {
  const { file } = props;
  if (file.previewUrl && isOnboardingImageMime(file.mimeType)) {
    return (
      <img
        src={file.previewUrl}
        alt={file.fileName}
        className="h-full w-full object-cover"
      />
    );
  }
  if (file.previewUrl && isOnboardingVideoMime(file.mimeType)) {
    return (
      <video
        src={file.previewUrl}
        className="h-full w-full object-cover"
        muted
        playsInline
        preload="metadata"
      />
    );
  }
  return (
    <div className="grid h-full w-full place-items-center bg-muted/50">
      <FileText className="size-5 text-secondary" aria-hidden />
    </div>
  );
}

export function OnboardingFilesPanel(props: {
  organisationId: string | null;
  onCountChange?: (count: number) => void;
}) {
  const organisationId = props.organisationId;
  const onCountChange = props.onCountChange;
  const [files, setFiles] = useState<DtOnboardingFileRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const reload = useCallback(async () => {
    if (!organisationId) {
      setFiles([]);
      onCountChange?.(0);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/dt/onboarding/files?org=${encodeURIComponent(organisationId)}`,
      );
      const json = (await res.json()) as { ok?: boolean; files?: DtOnboardingFileRow[]; message?: string };
      if (!json.ok) {
        toast.error(json.message ?? "Dateien konnten nicht geladen werden.");
        return;
      }
      const next = json.files ?? [];
      setFiles(next);
      onCountChange?.(next.length);
    } catch {
      toast.error("Dateien konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [organisationId, onCountChange]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function uploadFile(file: File) {
    if (!organisationId) return;
    setUploading(true);
    try {
      const mimeType = guessOnboardingMime(file.name, file.type);
      const startRes = await fetch("/api/dt/onboarding/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          organisationId: organisationId,
          fileName: file.name,
          mimeType,
          sizeBytes: file.size,
        }),
      });
      const startJson = (await startRes.json()) as {
        ok?: boolean;
        message?: string;
        fileId?: string;
        path?: string;
        signedUrl?: string;
        mimeType?: string;
      };
      if (!startJson.ok || !startJson.signedUrl || !startJson.fileId || !startJson.path) {
        toast.error(startJson.message ?? "Upload fehlgeschlagen.");
        return;
      }
      await uploadOnboardingFileToSignedUrl({
        file,
        signedUrl: startJson.signedUrl,
        mimeType: startJson.mimeType || mimeType,
      });
      const completeRes = await fetch("/api/dt/onboarding/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "complete",
          organisationId: organisationId,
          fileId: startJson.fileId,
          path: startJson.path,
          fileName: file.name,
          mimeType: startJson.mimeType || mimeType,
          sizeBytes: file.size,
        }),
      });
      const completeJson = (await completeRes.json()) as { ok?: boolean; message?: string };
      if (!completeJson.ok) {
        toast.error(completeJson.message ?? "Upload fehlgeschlagen.");
        return;
      }
      toast.success(`„${file.name}“ hochgeladen.`);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload fehlgeschlagen.");
    } finally {
      setUploading(false);
    }
  }

  async function onFiles(list: FileList | File[]) {
    const arr = Array.from(list);
    for (const file of arr) {
      await uploadFile(file);
    }
  }

  async function download(fileId: string) {
    if (!organisationId) return;
    try {
      const res = await fetch(
        `/api/dt/onboarding/files/${encodeURIComponent(fileId)}?org=${encodeURIComponent(organisationId)}`,
      );
      const json = (await res.json()) as { ok?: boolean; url?: string; message?: string };
      if (!json.ok || !json.url) {
        toast.error(json.message ?? "Download nicht möglich.");
        return;
      }
      window.open(json.url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Download nicht möglich.");
    }
  }

  async function remove(fileId: string, fileName: string) {
    if (!organisationId) return;
    if (!window.confirm(`„${fileName}“ wirklich löschen?`)) return;
    try {
      const res = await fetch(
        `/api/dt/onboarding/files?org=${encodeURIComponent(organisationId)}&file=${encodeURIComponent(fileId)}`,
        { method: "DELETE" },
      );
      const json = (await res.json()) as { ok?: boolean; message?: string };
      if (!json.ok) {
        toast.error(json.message ?? "Löschen fehlgeschlagen.");
        return;
      }
      toast.success("Datei gelöscht.");
      await reload();
    } catch {
      toast.error("Löschen fehlgeschlagen.");
    }
  }

  return (
    <div className="grid gap-3">
      <label
        className={cn(
          "grid cursor-pointer place-items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition",
          dragOver
            ? "border-sbkm-navy bg-sbkm-mint/15 dark:border-sbkm-mint"
            : "border-sbkm-navy/20 bg-sbkm-navy/[0.02] dark:border-white/15",
          (!organisationId || uploading) && "pointer-events-none opacity-60",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) void onFiles(e.dataTransfer.files);
        }}
      >
        <Upload className="size-5 text-sbkm-navy dark:text-sbkm-mint" aria-hidden />
        <span className="text-sm font-medium text-primary">
          {uploading ? "Lade hoch…" : "Dateien hierher ziehen oder klicken"}
        </span>
        <span className="text-xs text-secondary">
          Bilder, Videos, PDF, SVG — max. 50 MB je Datei
        </span>
        <input
          type="file"
          className="sr-only"
          accept={ACCEPT}
          multiple
          disabled={!organisationId || uploading}
          onChange={(e) => {
            if (e.target.files?.length) void onFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </label>

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-secondary">
          <Loader2 className="size-4 animate-spin" />
          Lade Dateien…
        </p>
      ) : files.length === 0 ? (
        <p className="text-sm text-secondary">
          Noch keine Dateien. Hochgeladene Bilder und Videos erscheinen hier.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {files.map((file) => (
            <li
              key={file.id}
              className="overflow-hidden rounded-xl border border-sbkm-navy/10 bg-white/60 dark:border-white/10 dark:bg-white/[0.04]"
            >
              <button
                type="button"
                className="block aspect-[4/3] w-full overflow-hidden bg-muted/40"
                onClick={() => void download(file.id)}
                aria-label={`${file.fileName} öffnen`}
              >
                <FilePreview file={file} />
              </button>
              <div className="grid gap-1.5 p-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-primary">{file.fileName}</p>
                  <p className="text-xs text-secondary">
                    {formatSize(file.sizeBytes)} · {formatDate(file.createdAt)}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void download(file.id)}
                  >
                    <Download className="size-3.5" />
                    Öffnen
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void remove(file.id, file.fileName)}
                  >
                    <Trash2 className="size-3.5" />
                    Löschen
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
