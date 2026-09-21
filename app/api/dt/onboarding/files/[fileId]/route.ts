import { NextResponse } from "next/server";

import { requireAuthUser } from "@/lib/dt/db";
import { requireOnboardingAccess } from "@/lib/dt/onboarding/access";
import { createOnboardingFileSignedUrl } from "@/lib/dt/onboarding/files";

export async function GET(
  req: Request,
  context: { params: Promise<{ fileId: string }> },
) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const { fileId } = await context.params;
  const orgId = new URL(req.url).searchParams.get("org");
  if (!orgId) {
    return NextResponse.json({ ok: false, message: "Organisation fehlt." }, { status: 400 });
  }

  const gate = await requireOnboardingAccess(auth.supabase, auth.userId, orgId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const signed = await createOnboardingFileSignedUrl(orgId, fileId);
  if (!signed.ok) {
    return NextResponse.json({ ok: false, message: signed.message }, { status: 404 });
  }

  return NextResponse.json({ ok: true, url: signed.url, fileName: signed.fileName });
}
