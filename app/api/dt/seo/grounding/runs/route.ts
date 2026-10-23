import { NextResponse } from "next/server";

import { loadDtAuthorLabels } from "@/lib/dt/author-labels";
import { requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import { reconcileGroundingRuns } from "@/lib/dt/seo/grounding-check/health";
import {
  RUN_DETAIL_COLUMNS,
  RUN_SUMMARY_COLUMNS,
  groundingCheckHeadline,
  groundingRunsDbErrorMessage,
  isMissingGroundingRunsTable,
  serializeRunDetail,
  serializeRunSummary,
} from "@/lib/dt/seo/grounding-check/store";
import { createServiceClient } from "@/lib/supabase/service";
import type { DtGroundingRunRow } from "@/lib/dt/types";

const HISTORY_LIMIT = 20;

/**
 * Grounding checks of an organisation: the history (newest first), the detail of the latest
 * run (or of `run=`), the headline for the tab and the name to prefill as reviewer.
 */
export async function GET(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }
  const url = new URL(req.url);
  const organisationId = url.searchParams.get("org") ?? "";
  const runId = url.searchParams.get("run");
  if (!/^[0-9a-f-]{36}$/i.test(organisationId) || (runId && !/^[0-9a-f-]{36}$/i.test(runId))) {
    return NextResponse.json({ ok: false, message: "Ungültige Anfrage." }, { status: 400 });
  }
  const gate = await requireDtSeoAccess(auth.supabase, auth.userId, organisationId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from("dt_grounding_runs")
    .select(RUN_SUMMARY_COLUMNS)
    .eq("organisation_id", organisationId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) {
    return NextResponse.json(
      { ok: false, message: groundingRunsDbErrorMessage(error, "Prüfungen konnten nicht geladen werden"), migrationMissing: isMissingGroundingRunsTable(error) },
      { status: isMissingGroundingRunsTable(error) ? 503 : 500 },
    );
  }
  const rows = await reconcileGroundingRuns(service, (data ?? []) as unknown as DtGroundingRunRow[]);
  const runs = rows.map(serializeRunSummary);

  const detailId = runId ?? runs[0]?.id ?? null;
  let detail = null;
  if (detailId) {
    const { data: row } = await service
      .from("dt_grounding_runs")
      .select(RUN_DETAIL_COLUMNS)
      .eq("id", detailId)
      .eq("organisation_id", organisationId)
      .maybeSingle();
    if (row) {
      const reconciled = rows.find((r) => r.id === detailId);
      const merged = reconciled ? { ...(row as unknown as DtGroundingRunRow), status: reconciled.status, error: reconciled.error } : (row as unknown as DtGroundingRunRow);
      detail = serializeRunDetail(merged);
    }
  }

  const labels = await loadDtAuthorLabels([auth.userId]).catch(() => ({}) as Record<string, string>);
  return NextResponse.json({
    ok: true,
    runs,
    detail,
    headline: groundingCheckHeadline(runs[0] ?? null),
    viewerName: labels[auth.userId] ?? "",
  });
}
