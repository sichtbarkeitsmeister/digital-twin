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
  loadGroundingPageRow,
  loadGroundingPageViews,
} from "@/lib/dt/seo/grounding-pages-server";
import type { DtGroundingPageRow } from "@/lib/dt/types";

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  /** Existing page to read; falls back to `url`. */
  pageId: z.string().uuid().optional(),
  /** URL override (or the URL of a page not yet saved). */
  url: z.string().trim().url().max(2000).optional(),
  /** Persist detected facts on the page (requires pageId). */
  apply: z.boolean().optional(),
});

export async function POST(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  const orgId = parsed.data.organisationId;
  const gate = await requireDtSeoAccess(auth.supabase, auth.userId, orgId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  let page: DtGroundingPageRow | null = null;
  if (parsed.data.pageId) {
    page = await loadGroundingPageRow(auth.supabase, parsed.data.pageId);
    if (!page || page.organisation_id !== orgId) {
      return NextResponse.json(
        { ok: false, message: "Grounding Page nicht gefunden." },
        { status: 404 },
      );
    }
  }

  const url = parsed.data.url?.trim() || page?.url?.trim() || "";
  if (!url) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Bitte zuerst die URL der Grounding Page eintragen — ohne URL kann kein Datum gelesen werden.",
      },
      { status: 400 },
    );
  }

  const detected = await detectGroundingPageUploadedAt(url);
  if (!detected.ok) {
    return NextResponse.json({ ok: false, message: detected.message }, { status: 422 });
  }

  const patch = patchFromLiveFacts(page, detected);
  if (!parsed.data.apply || !page) {
    return NextResponse.json({ ok: true, detection: detected, patch });
  }

  const built = buildGroundingPageUpdate(patch, page);
  if (!built.ok) {
    return NextResponse.json({ ok: false, message: built.message, detection: detected }, { status: 400 });
  }

  const { data: updated, error: updateError } = await auth.supabase
    .from("dt_grounding_pages")
    .update(built.update)
    .eq("id", page.id)
    .select(DT_GROUNDING_PAGE_SELECT)
    .maybeSingle();

  if (updateError || !updated) {
    return NextResponse.json(
      { ok: false, message: updateError?.message ?? "Speichern fehlgeschlagen." },
      { status: 500 },
    );
  }

  const pages = await loadGroundingPageViews(auth.supabase, orgId);
  return NextResponse.json({
    ok: true,
    detection: detected,
    patch,
    page: serializeGroundingPage(updated as DtGroundingPageRow),
    pages,
    summary: summarizeGroundingPages(pages),
  });
}
