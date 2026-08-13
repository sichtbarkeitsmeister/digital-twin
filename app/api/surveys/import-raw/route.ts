import { NextResponse } from "next/server";
import { z } from "zod";

import { runRawFilledQuestionnairesBatch } from "@/lib/surveys/raw-filled-import";
import { requireSurveyPlatformAdmin } from "@/lib/surveys/platform-admin";

/**
 * Long-running Word/KI import.
 * Must use a Route Handler (not a Server Action) so Vercel can honor maxDuration > ~120s.
 */
export const maxDuration = 300;
export const runtime = "nodejs";

const bodySchema = z.object({
  items: z
    .array(
      z.object({
        text: z.string().trim().min(50),
        title: z.string().trim().max(120).optional(),
      }),
    )
    .min(1)
    .max(30),
  folderId: z.string().uuid().nullable().optional(),
});

export async function POST(req: Request) {
  const auth = await requireSurveyPlatformAdmin();
  if (!auth.ok) {
    return NextResponse.json(
      {
        ok: false,
        message: auth.message,
        results: [],
        failed: [],
      },
      { status: auth.message.includes("angemeldet") ? 401 : 403 },
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe.",
        results: [],
        failed: [],
      },
      { status: 400 },
    );
  }

  try {
    const result = await runRawFilledQuestionnairesBatch({
      items: parsed.data.items,
      folderId: parsed.data.folderId,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Import unerwartet fehlgeschlagen.";
    return NextResponse.json(
      { ok: false, message, results: [], failed: [] },
      { status: 500 },
    );
  }
}
