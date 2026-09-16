import { NextResponse } from "next/server";
import { z } from "zod";

import { verifyDtInternalWebhookSecret } from "@/lib/dt/internal-webhook";
import { ingestGscPages } from "@/lib/dt/seo/ingest-gsc-pages";

export const maxDuration = 60;

const pageSchema = z.object({
  url: z.string().trim().min(1).max(2048).optional(),
  keys: z.array(z.string()).optional(),
  clicks: z.number().optional(),
  impressions: z.number().optional(),
  ctr: z.number().nullable().optional(),
  position: z.number().nullable().optional(),
});

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  crawlId: z.string().uuid().optional().nullable(),
  startDate: z.string().trim().min(8).max(10).optional().nullable(),
  endDate: z.string().trim().min(8).max(10).optional().nullable(),
  error: z.string().trim().max(1000).optional().nullable(),
  pages: z.array(pageSchema).max(25_000).optional(),
});

export async function POST(req: Request) {
  if (!verifyDtInternalWebhookSecret(req)) {
    return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  try {
    const result = await ingestGscPages(parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "GSC-Seiten konnten nicht gespeichert werden.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
