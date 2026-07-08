import { NextResponse } from "next/server";

import { requireAuthUser } from "@/lib/dt/db";
import { loadDtManageOrganisations } from "@/lib/dt/load-manage-organisations";
import { loadDtUserOrganisations } from "@/lib/dt/load-user-organisations";

export async function GET() {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const manage = await loadDtManageOrganisations(auth.userId);
  if (manage.isPlatformAdmin) {
    return NextResponse.json({
      ok: true,
      organisations: manage.organisations,
      isPlatformAdmin: true,
    });
  }

  const { organisations, error } = await loadDtUserOrganisations(auth.userId);
  if (error) {
    return NextResponse.json({ ok: false, message: error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    organisations: organisations.map((organisation) => ({
      id: organisation.id,
      name: organisation.name,
    })),
    isPlatformAdmin: false,
  });
}
