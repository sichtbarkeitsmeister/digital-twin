import { NextResponse } from "next/server";

import { requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import {
  DT_GROUNDING_PAGE_SELECT,
  buildGroundingPageUpdate,
  serializeGroundingPage,
  summarizeGroundingPages,
} from "@/lib/dt/seo/grounding-pages";
import {
  groundingPagePatchSchema,
  loadGroundingPageRow,
  loadGroundingPageViews,
} from "@/lib/dt/seo/grounding-pages-server";
import type { DtGroundingPageRow } from "@/lib/dt/types";

async function gatePage(
  auth: Awaited<ReturnType<typeof requireAuthUser>> & { ok: true; userId: string },
  pageId: string,
) {
  const row = await loadGroundingPageRow(auth.supabase, pageId);
  if (!row) {
    return { ok: false as const, status: 404, message: "Grounding Page nicht gefunden." };
  }
  const gate = await requireDtSeoAccess(auth.supabase, auth.userId, row.organisation_id);
  if (!gate.ok) return gate;
  return { ok: true as const, row };
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ pageId: string }> },
) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }
  const { pageId } = await context.params;
  const gate = await gatePage(auth, pageId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const parsed = groundingPagePatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  const built = buildGroundingPageUpdate(parsed.data, gate.row);
  if (!built.ok) {
    return NextResponse.json({ ok: false, message: built.message }, { status: 400 });
  }
  if (Object.keys(built.update).length === 0) {
    return NextResponse.json({ ok: false, message: "Keine Änderungen." }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from("dt_grounding_pages")
    .update(built.update)
    .eq("id", pageId)
    .select(DT_GROUNDING_PAGE_SELECT)
    .maybeSingle();

  if (error || !data) {
    const duplicate = error?.code === "23505";
    return NextResponse.json(
      {
        ok: false,
        message: duplicate
          ? "Diese URL ist bereits erfasst (oder es gibt schon einen Hub)."
          : (error?.message ?? "Speichern fehlgeschlagen."),
      },
      { status: duplicate ? 409 : 500 },
    );
  }

  const pages = await loadGroundingPageViews(auth.supabase, gate.row.organisation_id);
  return NextResponse.json({
    ok: true,
    page: serializeGroundingPage(data as DtGroundingPageRow),
    pages,
    summary: summarizeGroundingPages(pages),
  });
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ pageId: string }> },
) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }
  const { pageId } = await context.params;
  const gate = await gatePage(auth, pageId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const { error } = await auth.supabase.from("dt_grounding_pages").delete().eq("id", pageId);
  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  const pages = await loadGroundingPageViews(auth.supabase, gate.row.organisation_id);
  return NextResponse.json({ ok: true, pages, summary: summarizeGroundingPages(pages) });
}
