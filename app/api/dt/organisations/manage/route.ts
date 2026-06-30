import { NextResponse } from "next/server";

import { requireAuthUser } from "@/lib/dt/db";
import { loadDtManageOrganisations } from "@/lib/dt/load-manage-organisations";

export async function GET() {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const result = await loadDtManageOrganisations(auth.userId);
  if (result.organisations.length === 0) {
    return NextResponse.json({ ok: false, message: "Keine Organisationen." }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    organisations: result.organisations,
    isPlatformAdmin: result.isPlatformAdmin,
  });
}
