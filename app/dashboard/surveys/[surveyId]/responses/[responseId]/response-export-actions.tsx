"use client";

import { useMemo, useState } from "react";
import { Copy, Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ExportItem = {
  stepTitle: string;
  fieldId: string;
  fieldTitle: string;
  fieldDescription?: string | null;
  answer: string;
};

type ExportQuestion = {
  id: string;
  field_id: string;
  question: string;
  asked_at: string | null;
  answer: string | null;
  answered_at: string | null;
};

export type ResponseExportPayload = {
  survey: { id: string; title: string };
  response: {
    id: string;
    status: string;
    created_at: string | null;
    updated_at: string | null;
    completed_at: string | null;
  };
  items: ExportItem[];
  fieldQuestions: ExportQuestion[];
};

function quoteCsv(v: string) {
  const s = v ?? "";
  if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ResponseExportActions(props: { payload: ResponseExportPayload }) {
  const [isCopying, setIsCopying] = useState(false);
  const [copied, setCopied] = useState(false);

  const { plainText, jsonText, csvText, baseFilename } = useMemo(() => {
    const title = props.payload.survey.title?.trim() || "umfrage";
    const safeTitle = title
      .toLowerCase()
      .replace(/[^a-z0-9äöüß]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "umfrage";

    const baseFilename = `${safeTitle}-antwort-${props.payload.response.id}`;

    const header = [
      `Umfrage: ${props.payload.survey.title}`,
      `Antwort-ID: ${props.payload.response.id}`,
      `Status: ${props.payload.response.status}`,
      props.payload.response.created_at ? `Erstellt: ${props.payload.response.created_at}` : null,
      props.payload.response.completed_at ? `Abgeschlossen: ${props.payload.response.completed_at}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const byStep = new Map<string, ExportItem[]>();
    for (const it of props.payload.items) {
      const key = it.stepTitle || "Antworten";
      byStep.set(key, [...(byStep.get(key) ?? []), it]);
    }

    const bodyParts: string[] = [];
    for (const [stepTitle, items] of byStep.entries()) {
      bodyParts.push(`\n${stepTitle}\n${"-".repeat(stepTitle.length)}`);
      for (const it of items) {
        const q = it.fieldTitle || it.fieldId;
        const a = it.answer?.trim() ? it.answer.trim() : "—";
        bodyParts.push(`- ${q}: ${a}`);
      }
    }

    const questionsPart =
      props.payload.fieldQuestions.length > 0
        ? [
            `\nRückfragen\n---------`,
            ...props.payload.fieldQuestions.map((q) => {
              const a = q.answer?.trim() ? q.answer.trim() : "—";
              return `- ${q.field_id}: Nutzer: ${q.question} | Admin: ${a}`;
            }),
          ].join("\n")
        : "";

    const plainText = [header, ...bodyParts, questionsPart].filter(Boolean).join("\n");

    const jsonText = JSON.stringify(props.payload, null, 2);

    const csvHeader = ["step_title", "field_id", "field_title", "answer"].join(",");
    const csvRows = props.payload.items.map((it) =>
      [
        quoteCsv(it.stepTitle ?? ""),
        quoteCsv(it.fieldId ?? ""),
        quoteCsv(it.fieldTitle ?? ""),
        quoteCsv(it.answer ?? ""),
      ].join(","),
    );
    const csvText = [csvHeader, ...csvRows].join("\n");

    return { plainText, jsonText, csvText, baseFilename };
  }, [props.payload]);

  async function copyToClipboard() {
    try {
      setIsCopying(true);
      await navigator.clipboard.writeText(plainText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      window.alert("Kopieren ist fehlgeschlagen. (Zwischenablage nicht verfügbar)");
    } finally {
      setIsCopying(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={copyToClipboard}
        disabled={isCopying}
      >
        <Copy className="h-4 w-4" />
        {copied ? "Kopiert" : "Antworten kopieren"}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="sm" variant="outline" aria-label="Download">
            <Download className="h-4 w-4" />
            Download
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              downloadTextFile(`${baseFilename}.txt`, plainText, "text/plain;charset=utf-8");
            }}
          >
            Als Text (.txt)
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              downloadTextFile(`${baseFilename}.json`, jsonText, "application/json;charset=utf-8");
            }}
          >
            Als JSON (.json)
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              downloadTextFile(`${baseFilename}.csv`, csvText, "text/csv;charset=utf-8");
            }}
          >
            Als CSV (.csv)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

