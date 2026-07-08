"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatOrgDate } from "@/lib/dashboard/organisation-ui";
import type { DtSeoReportRow } from "@/lib/dt/types";

function reportStateLabel(state: string): string {
  switch (state) {
    case "done":
      return "Abgeschlossen";
    case "running":
      return "Läuft";
    case "queued":
      return "Warteschlange";
    case "error":
      return "Fehler";
    case "cancelled":
      return "Abgebrochen";
    default:
      return state;
  }
}

export function OrgSeoReportsList(props: {
  organisationId: string;
  onOpenReport: (reportId: string) => void;
  /** Report id already shown as "Letzter Report" — omit from history list */
  excludeReportId?: string | null;
}) {
  const [reports, setReports] = useState<DtSeoReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(
      `/api/dt/seo/reports?org=${encodeURIComponent(props.organisationId)}`,
    );
    const json = (await res.json()) as {
      ok?: boolean;
      message?: string;
      reports?: DtSeoReportRow[];
    };
    setLoading(false);
    if (!res.ok || !json.ok) {
      setReports([]);
      setError(json.message ?? "Reports konnten nicht geladen werden.");
      return;
    }
    setReports(json.reports ?? []);
  }, [props.organisationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = reports.filter(
    (r) => r.id !== props.excludeReportId && r.state === "done",
  );

  if (loading) {
    return <p className="text-xs text-secondary">Weitere Reports werden geladen …</p>;
  }

  if (error) {
    return <p className="text-xs text-red-600 dark:text-red-400">{error}</p>;
  }

  if (visible.length === 0) return null;

  return (
    <div className="grid gap-2 border-t border-sbkm-navy/8 pt-3 dark:border-white/8">
      <p className="text-xs font-medium uppercase tracking-wide text-secondary">
        Frühere Reports
      </p>
      <ul className="grid gap-2">
        {visible.map((report) => (
          <li
            key={report.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sbkm-navy/8 bg-sbkm-navy/[0.02] px-3 py-2.5 dark:border-white/8 dark:bg-white/[0.03]"
          >
            <div className="min-w-0 grid gap-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-primary">
                  {formatOrgDate(report.finished_at ?? report.created_at)}
                </span>
                <Badge variant="secondary" className="text-[10px]">
                  {reportStateLabel(report.state)}
                </Badge>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 shrink-0 px-2 text-xs"
              onClick={() => props.onOpenReport(report.id)}
            >
              Ansehen
              <ArrowRight className="size-3.5" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
