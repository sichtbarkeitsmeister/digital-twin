import { NextResponse } from "next/server";
import { z } from "zod";

import { verifyDtInternalWebhookSecret } from "@/lib/dt/internal-webhook";
import {
  deleteSeoTaskForTool,
  updateSeoTaskForTool,
} from "@/lib/dt/seo/task-tools";

export const maxDuration = 30;

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  action: z.enum(["update", "delete"]),
  taskId: z.string().uuid(),
  title: z.string().trim().max(500).optional(),
  url: z.string().trim().max(2000).nullable().optional(),
  keyword: z.string().trim().max(200).nullable().optional(),
  actionText: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(["open", "in_progress", "done", "wont_fix"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).nullable().optional(),
  currentStatus: z.string().trim().max(500).nullable().optional(),
  notes: z.string().trim().max(8000).nullable().optional(),
});

/**
 * Webhook-authenticated task mutations for the n8n SEO chat agent.
 */
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

  const d = parsed.data;
  try {
    if (d.action === "delete") {
      const text = await deleteSeoTaskForTool(d.organisationId, d.taskId);
      return NextResponse.json({ ok: true, text });
    }

    const text = await updateSeoTaskForTool(d.organisationId, d.taskId, {
      title: d.title,
      url: d.url,
      keyword: d.keyword,
      action: d.actionText,
      status: d.status,
      priority: d.priority,
      currentStatus: d.currentStatus,
      notes: d.notes,
    });
    return NextResponse.json({ ok: true, text });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Task-Tool fehlgeschlagen.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
