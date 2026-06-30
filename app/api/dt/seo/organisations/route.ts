import { NextResponse } from "next/server";

import { loadDtSeoOrganisations } from "@/lib/dt/load-seo-organisations";
import { requireAuthUser } from "@/lib/dt/db";

export async function GET() {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const result = await loadDtSeoOrganisations(auth.userId);
  if (!result.canAccessSeo) {
    return NextResponse.json({ ok: false, message: "Kein SEO-Zugang." }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    organisations: result.organisations,
    isPlatformAdmin: result.isPlatformAdmin,
  });
}
