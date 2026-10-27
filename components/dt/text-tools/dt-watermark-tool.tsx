"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileText, Loader2, Upload } from "lucide-react";

import { cn } from "@/components/dt/cn";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import type { ContentTextBlock } from "@/lib/dt/content/render";
import { TEXT_TOOL_ACCEPT, TEXT_TOOL_MAX_FILE_BYTES } from "@/lib/dt/text-tools/ingest";
import type { WatermarkChunkResponse, WatermarkDocument } from "@/lib/dt/text-tools/watermark";
import { mergeWatermarkBlocks, watermarkExportFile, type WatermarkExportFormat } from "@/lib/dt/text-tools/watermark-export";

/** Grok calls in flight at once; a 429 is retried with the backoff below. */
const PARALLEL_CHUNKS = 3;
const MAX_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000];
const MAX_MB = Math.round(TEXT_TOOL_MAX_FILE_BYTES / (1024 * 1024));

const cardClass =
  "relative overflow-hidden rounded-dt-lg border border-sbkm-navy/10 bg-white/55 shadow-dt backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.05]";

type Phase =
  | { kind: "idle" }
  | { kind: "reading"; fileName: string }
  | { kind: "running"; fileName: string; done: number; total: number }
  | { kind: "done"; doc: WatermarkDocument; blocks: ContentTextBlock[] }
  | { kind: "error"; message: string };

type Answer<T> = { ok: true; data: T } | { ok: false; message: string; retryable?: boolean; slowModels?: string[] };

class Aborted extends Error {}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new Aborted());
      },
      { once: true },
    );
  });
}

async function post<T>(url: string, body: BodyInit, signal: AbortSignal, json = false): Promise<Answer<T> & { status: number }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      body,
      signal,
      headers: json ? { "Content-Type": "application/json" } : undefined,
    });
    const parsed = (await res.json().catch(() => null)) as Answer<T> | null;
    if (parsed && typeof parsed.ok === "boolean") return { ...parsed, status: res.status };
    // A gateway timeout or crash answers without JSON: worth another try.
    return { ok: false, message: `Unerwartete Antwort vom Server (${res.status}).`, retryable: res.status >= 500, status: res.status };
  } catch (error) {
    if (signal.aborted) throw new Aborted();
    void error;
    return { ok: false, message: "Keine Verbindung zum Server. Bitte erneut versuchen.", retryable: true, status: 0 };
  }
}

function saveFile(format: WatermarkExportFormat, doc: WatermarkDocument, blocks: ContentTextBlock[]) {
  const file = watermarkExportFile(format, { fileName: doc.fileName, title: doc.title, blocks });
  const url = URL.createObjectURL(new Blob([file.body], { type: file.contentType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Verwaltung → Watermark Entfernung: upload a file, every sentence is rewritten on Grok
 * (the Watermark Entfernung step of Texte, in the same groups of sections), download the result as HTML or .txt.
 * The browser drives the run, one request per group; nothing is stored on the server.
 */
export function DtWatermarkTool(props: { xaiConfigured: boolean; xaiMissingMessage: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const busy = phase.kind === "reading" || phase.kind === "running";

  // Stop the run when the page is left; warn before closing the tab mid-run.
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  async function process(file: File) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    try {
      setPhase({ kind: "reading", fileName: file.name });
      const form = new FormData();
      form.set("file", file);
      const parsed = await post<WatermarkDocument>("/api/dt/text-tools/watermark/parse", form, signal);
      if (!parsed.ok) {
        setPhase({ kind: "error", message: parsed.message });
        return;
      }
      const doc = parsed.data;
      const byId = new Map(doc.blocks.map((block) => [block.id, block]));
      const rewritten: Record<string, string> = {};
      let slowModels: string[] = [];
      let done = 0;
      let next = 0;
      let failure: string | null = null;
      setPhase({ kind: "running", fileName: doc.fileName, done: 0, total: doc.total });

      const rewriteChunk = async (blocks: ContentTextBlock[]): Promise<string | null> => {
        for (let attempt = 1; ; attempt++) {
          const answer = await post<WatermarkChunkResponse>(
            "/api/dt/text-tools/watermark/chunk",
            JSON.stringify({ blocks, slowModels }),
            signal,
            true,
          );
          const reported = answer.ok ? answer.data.slowModels : answer.slowModels;
          if (reported?.length) slowModels = Array.from(new Set([...slowModels, ...reported]));
          if (answer.ok) {
            for (const block of answer.data.blocks) rewritten[block.id] = block.html;
            return null;
          }
          if (!answer.retryable || attempt >= MAX_ATTEMPTS || failure) return answer.message;
          await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 10_000, signal);
        }
      };

      const worker = async () => {
        while (!failure && next < doc.chunks.length) {
          const ids = doc.chunks[next++]!;
          const blocks = ids.map((id) => byId.get(id)).filter((block): block is ContentTextBlock => Boolean(block));
          const error = await rewriteChunk(blocks);
          if (error) {
            failure ??= error;
            return;
          }
          done += ids.length;
          setPhase({ kind: "running", fileName: doc.fileName, done: Math.min(done, doc.total), total: doc.total });
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL_CHUNKS, doc.chunks.length) }, worker));

      if (failure) {
        setPhase({ kind: "error", message: failure });
        return;
      }
      setPhase({ kind: "done", doc, blocks: mergeWatermarkBlocks(doc.blocks, rewritten) });
    } catch (error) {
      if (error instanceof Aborted || signal.aborted) return;
      setPhase({ kind: "error", message: error instanceof Error ? error.message : "Die Verarbeitung ist fehlgeschlagen." });
    }
  }

  function pickFile(file: File | undefined) {
    if (!file) return;
    if (file.size > TEXT_TOOL_MAX_FILE_BYTES) {
      setPhase({ kind: "error", message: `„${file.name}“ ist zu groß (max. ${MAX_MB} MB).` });
      return;
    }
    void process(file);
  }

  return (
    <section aria-label="Watermark Entfernung" className={cardClass}>
      <div className="grid gap-4 px-4 py-5 sm:px-5">
        {!props.xaiConfigured ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[10px] border border-red-300/70 bg-red-50 px-3 py-2.5 text-xs leading-relaxed text-red-900 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-100"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <div>{props.xaiMissingMessage}</div>
          </div>
        ) : null}

        <input
          ref={fileRef}
          type="file"
          accept={TEXT_TOOL_ACCEPT}
          className="sr-only"
          aria-label="Datei hochladen"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            pickFile(file);
          }}
        />

        <div className="flex flex-wrap items-center gap-3">
          <DtPillButton type="button" size="sm" disabled={busy || !props.xaiConfigured} onClick={() => fileRef.current?.click()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Upload className="size-3.5" aria-hidden />}
            {phase.kind === "done" ? "Weitere Datei hochladen" : "Datei hochladen"}
          </DtPillButton>
          <span className="text-[11px] text-sbkm-ink-500 dark:text-white/45">.txt, .html, .pdf oder .docx, höchstens {MAX_MB} MB</span>
        </div>

        <div aria-live="polite" className="min-h-[1.25rem] text-xs text-sbkm-ink-600 dark:text-white/60">
          {phase.kind === "reading" ? <>„{phase.fileName}“ wird gelesen …</> : null}
          {phase.kind === "running" ? (
            <>
              „{phase.fileName}“: {phase.done} von {phase.total} Abschnitten neu formuliert …
            </>
          ) : null}
          {phase.kind === "error" ? (
            <span role="alert" className={cn("inline-flex items-start gap-1.5 text-red-700 dark:text-red-300")}>
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {phase.message}
            </span>
          ) : null}
          {phase.kind === "done" ? (
            <span className="inline-flex items-center gap-1.5 text-sbkm-navy dark:text-white/85">
              <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
              „{phase.doc.fileName}“ ist fertig: {phase.doc.total} von {phase.doc.blocks.length} Abschnitten neu formuliert.
            </span>
          ) : null}
        </div>

        {phase.kind === "done" ? (
          <div className="flex flex-wrap items-center gap-2">
            <DtPillButton type="button" size="sm" variant="outline" onClick={() => saveFile("html", phase.doc, phase.blocks)}>
              <Download className="size-3.5" aria-hidden />
              HTML herunterladen
            </DtPillButton>
            <DtPillButton type="button" size="sm" variant="outline" onClick={() => saveFile("txt", phase.doc, phase.blocks)}>
              <FileText className="size-3.5" aria-hidden />
              Text (.txt) herunterladen
            </DtPillButton>
          </div>
        ) : null}
      </div>
    </section>
  );
}
