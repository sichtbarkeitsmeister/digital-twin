"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Upload } from "lucide-react";

import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtHeading } from "@/components/dt/dt-heading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DT_ONBOARDING_MEDIA_INTRO,
  DT_ONBOARDING_MEDIA_ITEMS,
} from "@/lib/dt/onboarding/copy";
import { uploadOnboardingFileToSignedUrl } from "@/lib/dt/onboarding/client-upload";
import { guessOnboardingMime } from "@/lib/dt/onboarding/mime";
import { cn } from "@/lib/utils";

const ACCEPT =
  "image/jpeg,image/png,image/gif,image/webp,image/svg+xml,application/pdf,video/mp4,video/quicktime,video/webm,.svg,.jpg,.jpeg,.png,.gif,.webp,.pdf,.mp4,.mov,.webm";

export function PublicOnboardingUpload(props: { token: string }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);

  async function uploadFile(file: File) {
    const mimeType = guessOnboardingMime(file.name, file.type);
    const startRes = await fetch("/api/dt/onboarding/public-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "start",
        token: props.token,
        password,
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
      throw new Error(startJson.message ?? "Upload fehlgeschlagen.");
    }
    await uploadOnboardingFileToSignedUrl({
      file,
      signedUrl: startJson.signedUrl,
      mimeType: startJson.mimeType || mimeType,
    });
    const completeRes = await fetch("/api/dt/onboarding/public-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "complete",
        token: props.token,
        password,
        fileId: startJson.fileId,
        path: startJson.path,
        fileName: file.name,
        mimeType: startJson.mimeType || mimeType,
        sizeBytes: file.size,
      }),
    });
    const completeJson = (await completeRes.json()) as {
      ok?: boolean;
      fileName?: string;
      message?: string;
    };
    if (!completeJson.ok) {
      throw new Error(completeJson.message ?? "Upload fehlgeschlagen.");
    }
    return completeJson.fileName ?? file.name;
  }

  async function onFiles(list: FileList | File[]) {
    if (!password.trim()) {
      setError("Bitte zuerst das Passwort eingeben.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const names: string[] = [];
      for (const file of Array.from(list)) {
        names.push(await uploadFile(file));
      }
      setUploaded((prev) => [...names, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DtGlassCard>
      <DtHeading as="h1" variant="h3">
        Dateien hochladen
      </DtHeading>
      <p className="mt-3 text-sm font-medium text-primary">{DT_ONBOARDING_MEDIA_INTRO}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-secondary">
        {DT_ONBOARDING_MEDIA_ITEMS.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-secondary">
        Dieser Link ist nur zum Hochladen. Ein Download oder eine Dateiliste ist von außen nicht
        möglich.
      </p>

      <div className="mt-6 grid gap-2">
        <Label htmlFor="upload-pass">Passwort</Label>
        <Input
          id="upload-pass"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="off"
        />
      </div>

      <label
        className={cn(
          "mt-5 grid cursor-pointer place-items-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center transition",
          dragOver
            ? "border-sbkm-navy bg-sbkm-mint/15"
            : "border-sbkm-navy/20 bg-sbkm-navy/[0.02] dark:border-white/15",
          busy && "pointer-events-none opacity-60",
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
        {busy ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <Upload className="size-5" aria-hidden />
        )}
        <span className="text-sm font-medium">
          {busy ? "Lade hoch…" : "Dateien hierher ziehen oder klicken"}
        </span>
        <span className="text-xs text-secondary">Bilder, Videos, PDF, SVG — max. 50 MB</span>
        <input
          type="file"
          className="sr-only"
          accept={ACCEPT}
          multiple
          disabled={busy}
          onChange={(e) => {
            if (e.target.files?.length) void onFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </label>

      {error ? (
        <p className="mt-4 text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      {uploaded.length > 0 ? (
        <ul className="mt-4 grid gap-1.5 text-sm text-primary">
          {uploaded.map((name, index) => (
            <li key={`${name}-${index}`} className="flex items-center gap-2">
              <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-hidden />
              {name} hochgeladen
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-6">
        <Button type="button" variant="outline" asChild>
          <a href="/auth/login">Zum DigitalTwin anmelden</a>
        </Button>
      </div>
    </DtGlassCard>
  );
}
