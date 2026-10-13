import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import { detectGroundingPageUploadedAt } from "@/lib/dt/seo/detect-grounding-page-date";
import {
  checkLlmsTxt,
  discoverGroundingPageUrl,
} from "@/lib/dt/seo/discover-grounding-page-url";
import {
  DT_GROUNDING_PAGE_SELECT,
  buildGroundingPageUpdate,
  patchFromLiveFacts,
  summarizeGroundingPages,
} from "@/lib/dt/seo/grounding-pages";
import { loadGroundingPageViews } from "@/lib/dt/seo/grounding-pages-server";

const CONFIG_SELECT = "organisation_id,website_url,grounding_llms_txt_url";

const optionalUrl = z
  .union([z.string().trim().url().max(2000), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === "" ? null : v));

const patchSchema = z.object({
  organisationId: z.string().uuid(),
  llmsTxtUrl: optionalUrl,
});

function llmsTxtPayload(llmsTxt: Awaited<ReturnType<typeof checkLlmsTxt>>) {
  return llmsTxt.ok
    ? {
        found: true as const,
        url: llmsTxt.url,
        lastModified: llmsTxt.lastModified,
        bytes: llmsTxt.bytes,
      }
    : {
        found: false as const,
        message: llmsTxt.message,
        tried: llmsTxt.tried,
      };
}

export async function GET(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const reqUrl = new URL(req.url);
  const orgId = reqUrl.searchParams.get("org");
  const auto = reqUrl.searchParams.get("auto") === "1";
  if (!orgId) {
    return NextResponse.json({ ok: false, message: "Organisation fehlt." }, { status: 400 });
  }

  const gate = await requireDtSeoAccess(auth.supabase, auth.userId, orgId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const { data: config, error } = await auth.supabase
    .from("dt_org_config")
    .select(CONFIG_SELECT)
    .eq("organisation_id", orgId)
    .maybeSingle();

  if (error || !config) {
    return NextResponse.json(
      { ok: false, message: error?.message ?? "Konfiguration nicht gefunden." },
      { status: 404 },
    );
  }

  let pages;
  try {
    pages = await loadGroundingPageViews(auth.supabase, orgId);
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : "Grounding Pages konnten nicht geladen werden." },
      { status: 500 },
    );
  }
  let llmsTxt = await checkLlmsTxt(config.website_url, config.grounding_llms_txt_url);
  let llmsTxtUrl = config.grounding_llms_txt_url ?? null;

  let discoveredUrl: string | null = null;
  let discoveryMessage: string | null = null;
  let discoverySource: "footer" | "path_probe" | null = null;
  let autoApplied = false;

  const hasHub = pages.some((p) => p.kind === "hub");
  if (!hasHub) {
    const discovered = await discoverGroundingPageUrl(config.website_url);
    if (discovered.ok) {
      discoveredUrl = discovered.url;
      discoverySource = discovered.source;
    } else {
      discoveryMessage = discovered.message;
    }
  }

  // First visit: persist discovered hub (+ live facts) and llms.txt URL.
  if (auto) {
    if (!hasHub && discoveredUrl) {
      const detected = await detectGroundingPageUploadedAt(discoveredUrl);
      const sourceHint = discoverySource === "footer" ? "Footer" : "Pfad";
      const today = new Date().toISOString().slice(0, 10);
      const patch = detected.ok
        ? patchFromLiveFacts(null, detected, today)
        : { notes: `Auto (${sourceHint}): URL erkannt (${today})` };
      if (detected.ok && patch.notes) {
        patch.notes = patch.notes.replace(/^Auto:/m, `Auto (${sourceHint}):`);
      }
      const built = buildGroundingPageUpdate(
        { ...patch, kind: "hub", url: detected.ok ? detected.finalUrl || discoveredUrl : discoveredUrl },
        null,
      );
      if (built.ok) {
        const { error: insertError } = await auth.supabase
          .from("dt_grounding_pages")
          .insert({
            organisation_id: orgId,
            created_by_user_id: auth.userId,
            position: 0,
            ...built.update,
          })
          .select(DT_GROUNDING_PAGE_SELECT)
          .maybeSingle();
        if (!insertError) {
          autoApplied = true;
          pages = await loadGroundingPageViews(auth.supabase, orgId);
        }
      }
    }

    if (!llmsTxtUrl && llmsTxt.ok) {
      const { error: updateError } = await auth.supabase
        .from("dt_org_config")
        .update({ grounding_llms_txt_url: llmsTxt.url })
        .eq("organisation_id", orgId);
      if (!updateError) {
        llmsTxtUrl = llmsTxt.url;
        llmsTxt = await checkLlmsTxt(config.website_url, llmsTxtUrl);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    websiteUrl: config.website_url ?? null,
    llmsTxtUrl,
    llmsTxt: llmsTxtPayload(llmsTxt),
    pages,
    summary: summarizeGroundingPages(pages),
    discoveredUrl: pages.find((p) => p.kind === "hub")?.url ?? discoveredUrl,
    discoveryMessage,
    discoverySource,
    autoApplied,
  });
}

/** Domain-level settings (llms.txt URL). Pages are edited via /grounding/pages. */
export async function PATCH(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  const orgId = parsed.data.organisationId;
  const gate = await requireDtSeoAccess(auth.supabase, auth.userId, orgId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  if (parsed.data.llmsTxtUrl === undefined) {
    return NextResponse.json({ ok: false, message: "Keine Änderungen." }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from("dt_org_config")
    .update({ grounding_llms_txt_url: parsed.data.llmsTxtUrl })
    .eq("organisation_id", orgId)
    .select(CONFIG_SELECT)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json(
      { ok: false, message: error?.message ?? "Speichern fehlgeschlagen." },
      { status: 500 },
    );
  }

  const llmsTxt = await checkLlmsTxt(data.website_url, data.grounding_llms_txt_url);
  return NextResponse.json({
    ok: true,
    llmsTxtUrl: data.grounding_llms_txt_url ?? null,
    llmsTxt: llmsTxtPayload(llmsTxt),
  });
}
