import { NextResponse } from "next/server";

import {
  extractSignatureHeader,
  extractSourceIp,
  headersToRecord,
  LEADINFO_PROVIDER,
  queryParamsToRecord,
  truncateBody,
} from "@/lib/integrations/leadinfo";
import { enqueueJob } from "@/lib/jobs/queue";
import { createServiceClient } from "@/lib/supabase/service";

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function POST(req: Request, context: RouteContext) {
  try {
    const { token: rawToken } = await context.params;
    const token = rawToken?.trim() ?? "";
    const url = new URL(req.url);
    const headerRecord = headersToRecord(req.headers);
    const bodyRaw = truncateBody(await req.text());

    let bodyJson: unknown = null;
    if (bodyRaw.trim()) {
      try {
        bodyJson = JSON.parse(bodyRaw);
      } catch {
        bodyJson = null;
      }
    }

    const matchStatus = token ? "unknown_token" : "missing_token";
    let organisationId: string | null = null;
    let integrationId: string | null = null;
    let resolvedMatchStatus = matchStatus;

    if (token) {
      const supabase = createServiceClient();
      const { data: integration } = await supabase
        .from("org_integrations")
        .select("id, organisation_id")
        .eq("provider", LEADINFO_PROVIDER)
        .eq("webhook_token", token)
        .eq("status", "enabled")
        .maybeSingle();

      if (integration?.id) {
        organisationId = integration.organisation_id;
        integrationId = integration.id;
        resolvedMatchStatus = "matched";
      }

      const { data: insertedEvent, error: insertError } = await supabase
        .from("integration_raw_events")
        .insert({
          organisation_id: organisationId,
          integration_id: integrationId,
          provider: LEADINFO_PROVIDER,
          match_status: resolvedMatchStatus,
          http_method: req.method,
          path: url.pathname,
          query: queryParamsToRecord(url),
          headers: headerRecord,
          body_raw: bodyRaw || null,
          body_json: bodyJson as Record<string, unknown> | null,
          signature_header: extractSignatureHeader(headerRecord),
          source_ip: extractSourceIp(headerRecord),
        })
        .select("id")
        .single();

      if (insertError) {
        console.error("[leadinfo webhook] insert failed", insertError);
        return NextResponse.json({ ok: false }, { status: 500 });
      }

      if (
        resolvedMatchStatus === "matched" &&
        organisationId &&
        insertedEvent?.id
      ) {
        const enqueue = await enqueueJob({
          kind: "leadinfo.normalize",
          organisationId,
          payload: { rawEventId: insertedEvent.id },
          dedupeKey: `raw:${insertedEvent.id}`,
        });
        if (!enqueue.ok) {
          console.error("[leadinfo webhook] enqueue normalize failed", enqueue.error);
        }
      }
    } else {
      const supabase = createServiceClient();
      const { error: insertError } = await supabase.from("integration_raw_events").insert({
        organisation_id: null,
        integration_id: null,
        provider: LEADINFO_PROVIDER,
        match_status: "missing_token",
        http_method: req.method,
        path: url.pathname,
        query: queryParamsToRecord(url),
        headers: headerRecord,
        body_raw: bodyRaw || null,
        body_json: bodyJson as Record<string, unknown> | null,
        signature_header: extractSignatureHeader(headerRecord),
        source_ip: extractSourceIp(headerRecord),
      });

      if (insertError) {
        console.error("[leadinfo webhook] insert failed", insertError);
        return NextResponse.json({ ok: false }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[leadinfo webhook] unexpected error", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
