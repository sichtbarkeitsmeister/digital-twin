import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import { detectGroundingPageUploadedAt } from "@/lib/dt/seo/detect-grounding-page-date";
import {
  DT_GROUNDING_PAGE_SELECT,
  buildGroundingPageUpdate,
  patchFromLiveFacts,
  serializeGroundingPage,
  summarizeGroundingPages,
} from "@/lib/dt/seo/grounding-pages";
import {
  groundingPagePatchSchema,
  loadGroundingPageViews,
} from "@/lib/dt/seo/grounding-pages-server";
import type { DtGroundingPageRow } from "@/lib/dt/types";

const createSchema = groundingPagePatchSchema.extend({
  organisationId: z.string().uuid(),
  url: z.string().trim().url().max(2000),
  /** Read dates + review facts from the live page before saving. */
  detect: z.boolean().optional(),
});

export async function POST(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  const { organisationId, detect, ...patch } = parsed.data;
  const gate = await requireDtSeoAccess(auth.supabase, auth.userId, organisationId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const existing = await loadGroundingPageViews(auth.supabase, organisationId);
  const kind = patch.kind ?? (existing.some((p) => p.kind === "hub") ? "entity" : "hub");
  if (kind === "hub" && existing.some((p) => p.kind === "hub")) {
    return NextResponse.json(
      { ok: false, message: "Es gibt bereits einen Hub. Weitere Seiten als Entitätsseite anlegen." },
      { status: 409 },
    );
  }

  let merged = { ...patch, kind };
  let detectionMessage: string | null = null;
  if (detect) {
    const detected = await detectGroundingPageUploadedAt(patch.url);
    if (detected.ok) {
      merged = { ...merged, ...patchFromLiveFacts(null, detected), url: detected.finalUrl || patch.url };
    } else {
      detectionMessage = detected.message;
    }
  }

  const built = buildGroundingPageUpdate(merged, null);
  if (!built.ok) {
    return NextResponse.json({ ok: false, message: built.message }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from("dt_grounding_pages")
    .insert({
      organisation_id: organisationId,
      created_by_user_id: auth.userId,
      position: patch.position ?? existing.length,
      ...built.update,
    })
    .select(DT_GROUNDING_PAGE_SELECT)
    .maybeSingle();

  if (error || !data) {
    const duplicate = error?.code === "23505";
    return NextResponse.json(
      {
        ok: false,
        message: duplicate
          ? "Diese URL ist für die Organisation bereits erfasst."
          : (error?.message ?? "Anlegen fehlgeschlagen."),
      },
      { status: duplicate ? 409 : 500 },
    );
  }

  const pages = await loadGroundingPageViews(auth.supabase, organisationId);
  return NextResponse.json({
    ok: true,
    page: serializeGroundingPage(data as DtGroundingPageRow),
    pages,
    summary: summarizeGroundingPages(pages),
    detectionMessage,
  });
}
