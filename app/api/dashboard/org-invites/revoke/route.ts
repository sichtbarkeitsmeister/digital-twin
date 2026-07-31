import { NextResponse } from "next/server";
import { z } from "zod";

import { revokeOrganisationInvite } from "@/lib/dashboard/revoke-org-invite";

export const runtime = "nodejs";

const bodySchema = z.object({
  inviteId: z.string().uuid(),
  organisationId: z.string().uuid(),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" },
      { status: 400 },
    );
  }

  const result = await revokeOrganisationInvite(parsed.data);
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json({ ok: true, message: "Einladung gelöscht." });
}
