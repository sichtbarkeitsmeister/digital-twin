import { NextResponse } from "next/server";
import { z } from "zod";

import { loadOrgConfig, requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import {
  resolveAnbieterFocusKeywordsForOrg,
  type AnbieterFocusKeywordsResult,
} from "@/lib/dt/seo/focus-keywords-from-anbieter";
import { normalizeGoogleAccount } from "@/lib/dt/seo/google-accounts";

const ORG_CONFIG_SELECT =
  "organisation_id,display_name,twin_provisioned,seo_enabled,disabled,website_url,footer_url,ga4_property_id,ga4_account,gsc_site_url,gsc_account,sistrix_domain,sitemap_url,focus_keyword,report_recipient_email,report_timeframe,seo_checklist,seo_checklist_personalized,videos";

const patchSchema = z.object({
  displayName: z.string().trim().min(1).max(200).optional(),
  websiteUrl: z.string().url().nullable().optional(),
  footerUrl: z.string().url().nullable().optional(),
  seoEnabled: z.boolean().optional(),
  ga4PropertyId: z.string().max(120).nullable().optional(),
  ga4Account: z.string().max(200).nullable().optional(),
  gscSiteUrl: z.string().max(500).nullable().optional(),
  gscAccount: z.string().max(200).nullable().optional(),
  sistrixDomain: z.string().max(200).nullable().optional(),
  sitemapUrl: z.string().url().nullable().optional(),
  focusKeyword: z.string().max(2_000).nullable().optional(),
  reportRecipientEmail: z.string().email().nullable().optional(),
  reportTimeframe: z
    .enum(["last_7_days", "last_30_days", "last_90_days"])
    .optional(),
  organisationSlug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/, "Slug: nur a-z, 0-9 und Bindestriche")
    .min(2)
    .max(64)
    .nullable()
    .optional(),
  seoChecklist: z.array(z.union([z.string(), z.object({ label: z.string() })])).optional(),
  seoChecklistPersonalized: z.boolean().optional(),
});

async function loadOrganisationSlug(
  supabase: Awaited<ReturnType<typeof requireAuthUser>>["supabase"],
  orgId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("organisations")
    .select("slug")
    .eq("id", orgId)
    .maybeSingle();
  const slug = String(data?.slug ?? "").trim();
  return slug || null;
}

export async function GET(
  _: Request,
  context: { params: Promise<{ orgId: string }> },
) {
  const auth = await requireAuthUser();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const { orgId } = await context.params;
  const gate = await requireDtSeoAccess(auth.supabase, auth.userId!, orgId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const config = await loadOrgConfig(orgId);
  if (!config) {
    return NextResponse.json({ ok: false, message: "Konfiguration nicht gefunden." }, { status: 404 });
  }

  let anbieterFocus: AnbieterFocusKeywordsResult = {
    status: "no_survey",
    joined: null,
    keywords: [],
    surveyId: null,
    surveyTitle: null,
    responseId: null,
    matchedFieldTitles: [],
  };
  try {
    anbieterFocus = await resolveAnbieterFocusKeywordsForOrg({
      organisationId: orgId,
      supabase: auth.supabase,
    });
    // Keep org config in sync when the questionnaire has keywords.
    if (
      anbieterFocus.status === "found" &&
      anbieterFocus.joined &&
      anbieterFocus.joined !== (config.focus_keyword ?? "").trim()
    ) {
      await auth.supabase
        .from("dt_org_config")
        .update({ focus_keyword: anbieterFocus.joined })
        .eq("organisation_id", orgId);
      (config as { focus_keyword?: string | null }).focus_keyword = anbieterFocus.joined;
    }
  } catch (e) {
    console.error("resolveAnbieterFocusKeywordsForOrg failed", e);
  }

  const organisationSlug = await loadOrganisationSlug(auth.supabase, orgId);
  return NextResponse.json({
    ok: true,
    config: {
      ...config,
      organisation_slug: organisationSlug,
      focus_keyword:
        anbieterFocus.status === "found" && anbieterFocus.joined
          ? anbieterFocus.joined
          : config.focus_keyword,
    },
    anbieterFocusKeywords: {
      status: anbieterFocus.status,
      keywords: anbieterFocus.joined,
      surveyTitle: anbieterFocus.surveyTitle,
      matchedFieldTitles: anbieterFocus.matchedFieldTitles,
    },
  });
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ orgId: string }> },
) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const { orgId } = await context.params;
  const gate = await requireDtSeoAccess(auth.supabase, auth.userId, orgId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  const patch: Record<string, unknown> = {};
  const d = parsed.data;
  if (d.displayName !== undefined) patch.display_name = d.displayName;
  if (d.websiteUrl !== undefined) patch.website_url = d.websiteUrl;
  if (d.footerUrl !== undefined) patch.footer_url = d.footerUrl;
  if (d.seoEnabled !== undefined) patch.seo_enabled = d.seoEnabled;
  if (d.ga4PropertyId !== undefined) patch.ga4_property_id = d.ga4PropertyId;
  if (d.ga4Account !== undefined) patch.ga4_account = normalizeGoogleAccount(d.ga4Account);
  if (d.gscSiteUrl !== undefined) patch.gsc_site_url = d.gscSiteUrl;
  if (d.gscAccount !== undefined) patch.gsc_account = normalizeGoogleAccount(d.gscAccount);
  if (d.sistrixDomain !== undefined) patch.sistrix_domain = d.sistrixDomain;
  if (d.sitemapUrl !== undefined) patch.sitemap_url = d.sitemapUrl;
  if (d.focusKeyword !== undefined) patch.focus_keyword = d.focusKeyword;
  if (d.reportRecipientEmail !== undefined) patch.report_recipient_email = d.reportRecipientEmail;
  if (d.reportTimeframe !== undefined) patch.report_timeframe = d.reportTimeframe;
  if (d.seoChecklist !== undefined) patch.seo_checklist = d.seoChecklist;
  if (d.seoChecklistPersonalized !== undefined) {
    patch.seo_checklist_personalized = d.seoChecklistPersonalized;
  }

  let organisationSlug: string | null | undefined;
  if (d.organisationSlug !== undefined) {
    if (d.organisationSlug === null) {
      return NextResponse.json(
        { ok: false, message: "Slug darf nicht leer sein (wird für SEO/n8n benötigt)." },
        { status: 400 },
      );
    }
    const { error: slugError } = await auth.supabase
      .from("organisations")
      .update({ slug: d.organisationSlug })
      .eq("id", orgId);
    if (slugError) {
      const msg = slugError.message.toLowerCase().includes("unique")
        ? "Dieser Slug ist bereits vergeben."
        : (slugError.message || "Slug konnte nicht gespeichert werden.");
      return NextResponse.json({ ok: false, message: msg }, { status: 400 });
    }
    organisationSlug = d.organisationSlug;
  }

  if (Object.keys(patch).length === 0 && organisationSlug === undefined) {
    return NextResponse.json({ ok: false, message: "Keine Änderungen." }, { status: 400 });
  }

  let data;
  if (Object.keys(patch).length > 0) {
    const updated = await auth.supabase
      .from("dt_org_config")
      .update(patch)
      .eq("organisation_id", orgId)
      .select(ORG_CONFIG_SELECT)
      .single();
    if (updated.error || !updated.data) {
      return NextResponse.json(
        { ok: false, message: updated.error?.message ?? "Speichern fehlgeschlagen." },
        { status: 500 },
      );
    }
    data = updated.data;
  } else {
    data = await loadOrgConfig(orgId);
    if (!data) {
      return NextResponse.json({ ok: false, message: "Konfiguration nicht gefunden." }, { status: 404 });
    }
  }

  if (organisationSlug === undefined) {
    organisationSlug = await loadOrganisationSlug(auth.supabase, orgId);
  }

  return NextResponse.json({
    ok: true,
    config: { ...data, organisation_slug: organisationSlug },
  });
}
