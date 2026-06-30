import { NextResponse } from "next/server";

import { requireAuthUser } from "@/lib/dt/db";

const STOP_ERROR_MESSAGES: Record<string, { status: number; message: string }> = {
  not_authenticated: { status: 401, message: "Nicht angemeldet." },
  report_not_found: { status: 404, message: "Report nicht gefunden." },
  forbidden: { status: 403, message: "Kein Zugriff auf diese Organisation." },
  report_not_stoppable: {
    status: 409,
    message: "Report ist bereits abgeschlossen und kann nicht mehr gestoppt werden.",
  },
};

export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const { id } = await context.params;

  const { data, error } = await auth.supabase.rpc("dt_stop_seo_report", {
    p_report_id: id,
  });

  if (error) {
    const mapped = STOP_ERROR_MESSAGES[error.message];
    if (mapped) {
      return NextResponse.json({ ok: false, message: mapped.message }, { status: mapped.status });
    }
    return NextResponse.json(
      { ok: false, message: error.message || "Report konnte nicht gestoppt werden." },
      { status: 500 },
    );
  }

  const report = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ ok: true, report });
}
