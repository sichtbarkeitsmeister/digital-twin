"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, Loader2, X } from "lucide-react";

import { DtSeoReportHtmlViewer } from "@/components/dt/seo/dt-seo-report-html-viewer";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { CenteredModal } from "@/components/ui/centered-modal";
import { formatOrgDate } from "@/lib/dashboard/organisation-ui";
import { parseSeoReportPayload } from "@/lib/dt/seo/report-payload";
import type { DtSeoReportRow } from "@/lib/dt/types";

function wrapHtmlDocument(fragment: string): string {
  const trimmed = fragment.trim();
  if (/<html[\s>]/i.test(trimmed)) return trimmed;
  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:16px;font-family:'Poppins',-apple-system,sans-serif;">${trimmed}</body></html>`;
}

function reportFilename(report: DtSeoReportRow, ext: "html" | "pdf"): string {
  const date = (report.finished_at ?? report.created_at ?? "").slice(0, 10) || "report";
  return `seo-report-${date}.${ext}`;
}

export function OrgSeoReportModal(props: {
  open: boolean;
  reportId: string | null;
  onClose: () => void;
}) {
  const [report, setReport] = useState<DtSeoReportRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = useCallback(async (reportId: string) => {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/dt/seo/reports/${encodeURIComponent(reportId)}`);
    const json = (await res.json()) as {
      ok?: boolean;
      message?: string;
      report?: DtSeoReportRow;
    };
    setLoading(false);
    if (!res.ok || !json.ok || !json.report) {
      setReport(null);
      setError(json.message ?? "Report konnte nicht geladen werden.");
      return;
    }
    setReport(json.report);
  }, []);

  useEffect(() => {
    if (!props.open || !props.reportId) {
      setReport(null);
      setError(null);
      return;
    }
    void fetchReport(props.reportId);
  }, [props.open, props.reportId, fetchReport]);

  const parsed = useMemo(() => parseSeoReportPayload(report?.payload), [report?.payload]);
  const pdfUrl =
    report?.pdf_path && /^https?:\/\//i.test(report.pdf_path) ? report.pdf_path : null;

  const downloadHtml = useCallback(() => {
    if (!report || !parsed.reportHtml) return;
    const blob = new Blob([wrapHtmlDocument(parsed.reportHtml)], {
      type: "text/html;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = reportFilename(report, "html");
    anchor.click();
    URL.revokeObjectURL(url);
  }, [report, parsed.reportHtml]);

  const handleClose = () => {
    if (loading) return;
    props.onClose();
  };

  return (
    <CenteredModal
      open={props.open && props.reportId != null}
      onClose={handleClose}
      size="lg"
      titleId="org-seo-report-modal-title"
      closeDisabled={loading}
      header={
        <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-sbkm-navy/10 px-5 py-4 dark:border-white/10">
          <div className="min-w-0">
            <h2
              id="org-seo-report-modal-title"
              className="text-lg font-semibold tracking-tight text-sbkm-navy dark:text-white"
            >
              SEO-Report
            </h2>
            {report ? (
              <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/55">
                {formatOrgDate(report.finished_at ?? report.created_at)}
                {parsed.recommendations.length > 0
                  ? ` · ${parsed.recommendations.length} Maßnahme${parsed.recommendations.length === 1 ? "" : "n"}`
                  : ""}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {parsed.reportHtml ? (
              <DtPillButton
                type="button"
                variant="outline"
                className="h-9 px-3 text-xs"
                onClick={downloadHtml}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                HTML
              </DtPillButton>
            ) : null}
            {pdfUrl ? (
              <DtPillButton type="button" variant="outline" className="h-9 px-3 text-xs" asChild>
                <a href={pdfUrl} target="_blank" rel="noopener noreferrer" download>
                  <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  PDF
                </a>
              </DtPillButton>
            ) : null}
            {parsed.reportHtml ? (
              <DtPillButton
                type="button"
                variant="outline"
                className="h-9 px-3 text-xs"
                onClick={() => {
                  const blob = new Blob([wrapHtmlDocument(parsed.reportHtml!)], {
                    type: "text/html;charset=utf-8",
                  });
                  const url = URL.createObjectURL(blob);
                  window.open(url, "_blank", "noopener,noreferrer");
                  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
                }}
              >
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Neuer Tab
              </DtPillButton>
            ) : null}
            <button
              type="button"
              aria-label="Schließen"
              disabled={loading}
              onClick={handleClose}
              className="rounded-full p-1.5 text-sbkm-ink-500 transition-colors hover:bg-sbkm-navy/5 hover:text-sbkm-navy disabled:opacity-50 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      }
    >
      {loading ? (
        <div className="flex min-h-[min(40vh,240px)] items-center justify-center gap-2 text-sm text-sbkm-ink-600 dark:text-white/60">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          Report wird geladen…
        </div>
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : (
        <>
          {parsed.summaryText ? (
            <p className="mb-4 text-sm leading-relaxed text-sbkm-navy dark:text-white/90">
              {parsed.summaryText}
            </p>
          ) : null}

          {parsed.reportHtml ? (
            <DtSeoReportHtmlViewer html={parsed.reportHtml} title="SEO-Report" embedded />
          ) : report ? (
            <p className="text-sm text-sbkm-ink-600 dark:text-white/60">
              Kein HTML-Inhalt für diesen Report gespeichert.
              {pdfUrl ? " Du kannst die PDF-Version herunterladen." : ""}
            </p>
          ) : null}
        </>
      )}
    </CenteredModal>
  );
}
