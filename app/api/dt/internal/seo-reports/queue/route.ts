import { NextResponse } from "next/server";
import { z } from "zod";

import { verifyDtInternalWebhookSecret } from "@/lib/dt/internal-webhook";
import {
  listOrgsReadyForMonthlySeoReport,
  queueAndTriggerSeoReportSystem,
} from "@/lib/dt/seo/queue-seo-report-system";

const bodySchema = z.object({
  /** Queue one org; omit to fan out all ready SEO orgs (monthly run). */
  organisationId: z.string().uuid().optional(),
  recipientType: z.enum(["intern", "kunde"]).optional().default("kunde"),
  sendToOwner: z.boolean().optional().default(true),
  triggerSource: z.string().trim().min(1).max(64).optional().default("monthly_scheduler"),
  dedupeMonthly: z.boolean().optional().default(true),
  /** List candidates only — do not queue. */
  dryRun: z.boolean().optional().default(false),
});

/**
 * Internal: queue SEO report(s) for the monthly scheduler (or a single org).
 * Auth: X-DT-Webhook-Secret
 */
export async function POST(req: Request) {
  if (!verifyDtInternalWebhookSecret(req)) {
    return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  if (parsed.data.organisationId) {
    if (parsed.data.dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        organisationId: parsed.data.organisationId,
      });
    }
    const result = await queueAndTriggerSeoReportSystem({
      organisationId: parsed.data.organisationId,
      recipientType: parsed.data.recipientType,
      sendToOwner: parsed.data.sendToOwner,
      triggerSource: parsed.data.triggerSource,
      dedupeMonthly: parsed.data.dedupeMonthly,
    });
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json(result);
  }

  const orgs = await listOrgsReadyForMonthlySeoReport();
  if (parsed.data.dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      count: orgs.length,
      orgs,
    });
  }

  const results: Array<{
    organisationId: string;
    slug: string;
    ok: boolean;
    skipped?: boolean;
    reportId?: string;
    message?: string;
  }> = [];

  for (const org of orgs) {
    const result = await queueAndTriggerSeoReportSystem({
      organisationId: org.organisationId,
      recipientType: parsed.data.recipientType,
      sendToOwner: parsed.data.sendToOwner,
      triggerSource: parsed.data.triggerSource,
      dedupeMonthly: parsed.data.dedupeMonthly,
    });
    if (result.ok && result.skipped) {
      results.push({
        organisationId: org.organisationId,
        slug: org.slug,
        ok: true,
        skipped: true,
        reportId: result.existingReportId,
        message: result.reason,
      });
      continue;
    }
    if (!result.ok) {
      results.push({
        organisationId: org.organisationId,
        slug: org.slug,
        ok: false,
        message: result.message,
      });
      continue;
    }
    results.push({
      organisationId: org.organisationId,
      slug: org.slug,
      ok: true,
      reportId: result.reportId,
    });
    // Light stagger to avoid n8n stampede
    await new Promise((r) => setTimeout(r, 750));
  }

  const queued = results.filter((r) => r.ok && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.ok).length;

  return NextResponse.json({
    ok: true,
    summary: { total: orgs.length, queued, skipped, failed },
    results,
  });
}
