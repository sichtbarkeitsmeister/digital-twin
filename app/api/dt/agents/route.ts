import { NextResponse } from "next/server";
import { z } from "zod";

import { loadAgentsForOrg, requireAuthUser } from "@/lib/dt/db";

const querySchema = z.object({
  org: z.string().uuid(),
});

export async function GET(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ org: url.searchParams.get("org") });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Ungültige Organisation." }, { status: 400 });
  }

  const agents = await loadAgentsForOrg(parsed.data.org);
  return NextResponse.json({ ok: true, agents });
}
