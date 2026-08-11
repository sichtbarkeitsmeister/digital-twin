import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { checkExamAnswerAgainstExpected } from "@/lib/dt/exam-answer-check";

const bodySchema = z.object({
  question: z.string().trim().min(1).max(2_000),
  expectedHint: z.string().trim().min(1).max(4_000),
  assistantAnswer: z.string().trim().min(1).max(12_000),
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

  try {
    const suggestion = await checkExamAnswerAgainstExpected(parsed.data);
    if (!suggestion) {
      return NextResponse.json(
        { ok: false, message: "KI-Prüfung nicht verfügbar." },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, suggestion });
  } catch (error) {
    console.warn("[dt] exam-answer-check route failed", error);
    return NextResponse.json(
      { ok: false, message: "KI-Prüfung fehlgeschlagen." },
      { status: 500 },
    );
  }
}
