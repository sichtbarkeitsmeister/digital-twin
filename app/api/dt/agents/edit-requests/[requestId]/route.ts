import { NextResponse } from "next/server";
import { z } from "zod";

import { cancelDtAgentEditRequest, reviewDtAgentEditRequest } from "@/lib/dt/agent-edit-requests";
import { requireAuthUser } from "@/lib/dt/db";
import { canDirectlyEditDtAgents } from "@/lib/dt/org-access";

const reviewSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reviewerNote: z.string().trim().max(2000).optional(),
});

export async function PATCH(
  req: Request,
  context: { params: Promise<{ requestId: string }> },
) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const { requestId } = await context.params;
  const body = await req.json().catch(() => null);

  if (body?.action === "cancel") {
    const { ok, error } = await cancelDtAgentEditRequest({
      supabase: auth.supabase,
      requestId,
      userId: auth.userId,
    });
    if (!ok) {
      return NextResponse.json(
        { ok: false, message: error ?? "Zurückziehen fehlgeschlagen." },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, message: "Anfrage zurückgezogen." });
  }

  if (!(await canDirectlyEditDtAgents(auth.supabase, auth.userId))) {
    return NextResponse.json({ ok: false, message: "Keine Berechtigung." }, { status: 403 });
  }

  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  const { request, error } = await reviewDtAgentEditRequest({
    supabase: auth.supabase,
    requestId,
    decision: parsed.data.decision,
    reviewerNote: parsed.data.reviewerNote,
  });

  if (error || !request) {
    return NextResponse.json(
      { ok: false, message: error ?? "Bearbeitung fehlgeschlagen." },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    request,
    message:
      parsed.data.decision === "approve"
        ? "Änderungen übernommen."
        : "Anfrage abgelehnt.",
  });
}
