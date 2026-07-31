import { NextResponse } from "next/server";
import { z } from "zod";

import { verifyDtInternalWebhookSecret } from "@/lib/dt/internal-webhook";
import { formatSerpSnippetCheckForTool } from "@/lib/dt/seo/serp-pixel";

export const maxDuration = 15;

const bodySchema = z.object({
  title: z.string().trim().max(500).optional(),
  description: z.string().trim().max(2000).optional(),
});

/** Webhook-authenticated SERP pixel check for the n8n SEO chat agent. */
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

  const text = formatSerpSnippetCheckForTool(parsed.data);
  return NextResponse.json({ ok: true, text });
}
