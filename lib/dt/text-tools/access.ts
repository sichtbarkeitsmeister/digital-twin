/**
 * Who may use the Textwerkzeuge: the same people and the same organisation checks as every
 * `/api/dt/content/*` route (platform administrators; the organisation must exist and not be
 * disabled). Everything delegates to the Texte helpers so the two can never drift apart; the
 * only addition is the feature flag per tool. Server only.
 */

import type { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  contentError,
  contentOk,
  gateContentAgencyRoute,
  gateContentRoute,
  readJsonBody,
  type ContentAgencyGate,
  type ContentGate,
} from "@/lib/dt/content/route-helpers";
import { loadDtSeoOrganisations, type DtSeoOrganisation } from "@/lib/dt/load-seo-organisations";
import { isPlatformAdmin } from "@/lib/dt/org-access";
import { enabledTextTools, isTextToolEnabled, TEXT_TOOLS, type TextToolId } from "@/lib/dt/text-tools/tools";
import { createClient } from "@/lib/supabase/server";

export type TextToolsGate = ContentGate;
export type TextToolsAgencyGate = ContentAgencyGate;

export const textToolsError = contentError;
export const textToolsOk = contentOk;
export const readTextToolsJsonBody = readJsonBody;

function disabledToolResponse(tool: TextToolId): NextResponse {
  return contentError(`Das Werkzeug „${TEXT_TOOLS[tool].label}“ ist nicht freigeschaltet.`, 404);
}

/**
 * Route gate with an organisation (`org` query parameter or `organisationId` in the body):
 * signed in, platform administrator, organisation present and enabled. With `tool` the feature
 * flag is checked first, so a hidden tool answers 404 like a route that does not exist.
 */
export async function gateTextToolsRoute(
  organisationId: unknown,
  tool?: TextToolId,
): Promise<{ ok: true; gate: TextToolsGate } | { ok: false; response: NextResponse }> {
  if (tool && !isTextToolEnabled(tool)) return { ok: false, response: disabledToolResponse(tool) };
  return gateContentRoute(organisationId);
}

/** Route gate without an organisation (agency-wide data such as shared settings). */
export async function gateTextToolsAgencyRoute(
  tool?: TextToolId,
): Promise<{ ok: true; gate: TextToolsAgencyGate } | { ok: false; response: NextResponse }> {
  if (tool && !isTextToolEnabled(tool)) return { ok: false, response: disabledToolResponse(tool) };
  return gateContentAgencyRoute();
}

/** The organisation a request names: `?org=` on GET, `organisationId` in a JSON or form body. */
export function textToolsOrganisationIdFromRequest(req: Request, body?: unknown): string | null {
  const fromQuery = new URL(req.url).searchParams.get("org");
  if (fromQuery) return fromQuery;
  if (body && typeof body === "object") {
    const value = (body as Record<string, unknown>).organisationId ?? (body as Record<string, unknown>).org;
    if (typeof value === "string" && value) return value;
  }
  if (body instanceof FormData) {
    const value = body.get("organisationId") ?? body.get("org");
    if (typeof value === "string" && value) return value;
  }
  return null;
}

/** Same rule as Texte: platform administrators only. */
export async function canAccessTextTools(supabase: SupabaseClient, userId: string): Promise<boolean> {
  return isPlatformAdmin(supabase, userId);
}

export async function userCanAccessTextTools(userId: string): Promise<boolean> {
  const supabase = await createClient();
  return canAccessTextTools(supabase, userId);
}

export type TextToolsPageAccess =
  | {
      ok: true;
      userId: string;
      organisations: DtSeoOrganisation[];
      /** The organisation from `?org=`, else the first one; null when the agency has none yet. */
      organisation: DtSeoOrganisation | null;
      enabledTools: TextToolId[];
    }
  | { ok: false; reason: "unauthenticated" | "forbidden" | "tool_disabled" };

/**
 * For the pages under Verwaltung → Textwerkzeuge: the same organisation list as Texte and SEO
 * (`loadDtSeoOrganisations`) and the chosen organisation. The caller redirects on `ok: false`.
 */
export async function resolveTextToolsPage(
  searchParams: { org?: string } | undefined,
  tool?: TextToolId,
): Promise<TextToolsPageAccess> {
  if (tool && !isTextToolEnabled(tool)) return { ok: false, reason: "tool_disabled" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "unauthenticated" };

  const { organisations, canAccessSeo } = await loadDtSeoOrganisations(user.id);
  if (!canAccessSeo) return { ok: false, reason: "forbidden" };

  const wanted = searchParams?.org;
  const organisation =
    (wanted ? organisations.find((o) => o.id === wanted) : undefined) ?? organisations[0] ?? null;
  return { ok: true, userId: user.id, organisations, organisation, enabledTools: enabledTextTools() };
}
