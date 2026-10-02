import { NextResponse } from "next/server";

import { requireAuthUser } from "@/lib/dt/db";
import { requireTranscriptAccess } from "@/lib/dt/transcripts/access";
import { orderWorkshopSources } from "@/lib/dt/transcripts/workshop-model";
import { loadWorkshopState, reconcileAvatarAgents } from "@/lib/dt/transcripts/workshop-store";

export async function GET(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }
  const orgId = new URL(req.url).searchParams.get("org");
  if (!orgId) {
    return NextResponse.json({ ok: false, message: "Organisation fehlt." }, { status: 400 });
  }
  const gate = await requireTranscriptAccess(auth.supabase, auth.userId, orgId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  try {
    const state = await loadWorkshopState(auth.supabase, orgId);
    const avatarPlan = await reconcileAvatarAgents(auth.supabase, orgId, state.avatarPlan);
    return NextResponse.json({
      ok: true,
      fingerprint: state.fingerprint,
      sources: orderWorkshopSources(state.sources).map((source) => ({
        id: source.id,
        title: source.title,
        filename: source.filename,
        sourceKind: source.sourceKind,
        spokenOn: source.spokenOn,
        createdAt: source.createdAt,
        hasSummary: Boolean(source.summary?.trim()),
      })),
      anbieter: state.anbieter,
      avatarPlan,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bestand konnte nicht geladen werden.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
