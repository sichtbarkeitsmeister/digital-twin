import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import { SYSTEM_STACK_KEYS, type SystemStackKey } from "@/lib/dt/seo/grounding-design/fonts";
import type { GroundingDesignPayload } from "@/lib/dt/seo/grounding-design/api-types";
import {
  type ManualDesignEdit,
  applyManualEdit,
  designProfileView,
  resetDesign,
} from "@/lib/dt/seo/grounding-design/profile";
import {
  detectAndStoreGroundingDesign,
  loadGroundingDesign,
  saveGroundingDesign,
} from "@/lib/dt/seo/grounding-design/store";
import { createServiceClient } from "@/lib/supabase/service";

export const maxDuration = 60;

const color = z.string().trim().max(40).nullable();
const font = z.object({ name: z.string().max(80), stack: z.enum(SYSTEM_STACK_KEYS as [SystemStackKey, ...SystemStackKey[]]) }).nullable();

const editSchema = z.object({
  colors: z.object({ text: color, background: color, heading: color, link: color, accent: color, muted: color }).partial().optional(),
  fonts: z.object({ body: font, heading: font }).partial().optional(),
  typography: z
    .object({
      headingWeight: z.number().int().min(100).max(900).nullable(),
      headingLetterSpacing: z.string().trim().max(20).nullable(),
      headingUppercase: z.boolean().nullable(),
      baseFontSize: z.number().min(12).max(24).nullable(),
    })
    .partial()
    .optional(),
});

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  action: z.enum(["save", "reset", "detect"]),
  edit: editSchema.optional(),
});

async function websiteUrlOf(organisationId: string): Promise<string | null> {
  const { data } = await createServiceClient().from("dt_org_config").select("website_url").eq("organisation_id", organisationId).maybeSingle();
  const url = ((data?.website_url as string | null | undefined) ?? "").trim();
  return url || null;
}

async function payload(organisationId: string, message: string | null = null): Promise<GroundingDesignPayload> {
  const [loaded, websiteUrl] = await Promise.all([loadGroundingDesign(createServiceClient(), organisationId), websiteUrlOf(organisationId)]);
  return {
    ok: true,
    migrationMissing: loaded.migrationMissing,
    message: message ?? loaded.error,
    websiteUrl,
    record: loaded.record,
    profile: designProfileView(loaded.record),
    report: loaded.report,
  };
}

async function gate(organisationId: string) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) return { ok: false as const, status: 401, message: "Nicht angemeldet." };
  const access = await requireDtSeoAccess(auth.supabase, auth.userId, organisationId);
  if (!access.ok) return { ok: false as const, status: access.status, message: access.message };
  return { ok: true as const, userId: auth.userId };
}

/** The design profile of an organisation's Grounding Pages (`?org=`). */
export async function GET(req: Request) {
  const organisationId = new URL(req.url).searchParams.get("org") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(organisationId)) {
    return NextResponse.json({ ok: false, message: "Ungültige Anfrage." }, { status: 400 });
  }
  const access = await gate(organisationId);
  if (!access.ok) return NextResponse.json({ ok: false, message: access.message }, { status: access.status });
  return NextResponse.json(await payload(organisationId));
}

/**
 * `save`: manual values (a value sets „manuell“, null returns the field to „von der Website“);
 * `reset`: neutral template („Auf Standard zurücksetzen“); `detect`: read the website again
 * („Design neu erkennen“) — never overwrites manual values.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." }, { status: 400 });
  }
  const { organisationId, action, edit } = parsed.data;
  const access = await gate(organisationId);
  if (!access.ok) return NextResponse.json({ ok: false, message: access.message }, { status: access.status });
  const service = createServiceClient();

  if (action === "detect") {
    const websiteUrl = await websiteUrlOf(organisationId);
    if (!websiteUrl) {
      return NextResponse.json({ ok: false, message: "Keine Website-URL in den SEO-Einstellungen." }, { status: 400 });
    }
    const result = await detectAndStoreGroundingDesign(service, { organisationId, websiteUrl, userId: access.userId, enable: true, deadline: Date.now() + 25_000 });
    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.message, migrationMissing: result.migrationMissing }, { status: result.migrationMissing ? 503 : 502 });
    }
    return NextResponse.json(await payload(organisationId));
  }

  const loaded = await loadGroundingDesign(service, organisationId);
  if (loaded.error) {
    return NextResponse.json({ ok: false, message: loaded.error, migrationMissing: loaded.migrationMissing }, { status: loaded.migrationMissing ? 503 : 500 });
  }
  const next = action === "reset" ? resetDesign(loaded.record) : applyManualEdit(loaded.record, (edit ?? {}) as ManualDesignEdit);
  const saved = await saveGroundingDesign(service, organisationId, next, { userId: access.userId });
  if (!saved.ok) {
    return NextResponse.json({ ok: false, message: saved.message, migrationMissing: saved.migrationMissing }, { status: saved.migrationMissing ? 503 : 500 });
  }
  return NextResponse.json(await payload(organisationId));
}
