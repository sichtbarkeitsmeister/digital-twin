import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { loadContentLocalSources } from "@/lib/dt/content/load-sources";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import type { ContentLocalSources, ContentReadiness } from "@/lib/dt/content/types";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const orgIdSchema = z.string().uuid();

/** Path segments used as DB keys — never let `/`, `..` or `?` through. */
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,159}$/i;

export function isValidContentSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

export function isValidContentJobId(id: string): boolean {
  return z.string().uuid().safeParse(id).success;
}

export function parseContentStep(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 8 ? n : null;
}

export type ContentGate = {
  /** Signed-in user's client (RLS) — for reads of shared tables. */
  supabase: SupabaseClient;
  /** Service client — for the content tables; access was already checked. */
  service: SupabaseClient;
  userId: string;
  userEmail: string | null;
  organisationId: string;
};

export function contentError(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status });
}

export function contentOk<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

/** Same access rule as the SEO workspace (platform admin; org must exist and be enabled). */
export async function gateContentRoute(
  organisationId: unknown,
): Promise<{ ok: true; gate: ContentGate } | { ok: false; response: NextResponse }> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user?.id) {
    return { ok: false, response: contentError("Nicht angemeldet.", 401) };
  }

  const parsed = orgIdSchema.safeParse(organisationId);
  if (!parsed.success) {
    return { ok: false, response: contentError("Ungültige Organisation.", 400) };
  }

  const access = await requireDtSeoAccess(supabase, user.id, parsed.data);
  if (!access.ok) {
    return { ok: false, response: contentError(access.message, access.status) };
  }

  return {
    ok: true,
    gate: {
      supabase,
      service: createServiceClient(),
      userId: user.id,
      userEmail: user.email ?? null,
      organisationId: parsed.data,
    },
  };
}

export async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** The three readiness checks from DigitalTwin's own tables. */
export function readinessFromLocal(local: ContentLocalSources): ContentReadiness {
  const checks: ContentReadiness["checks"] = [
    {
      id: "anbieter",
      ok: Boolean(local.anbieter),
      label: "Anbieterfakten",
      hint: local.anbieter
        ? `${local.anbieter.filled} von ${local.anbieter.total} Abschnitten aus den Gesprächen gefüllt.`
        : "Aus den Gesprächen gibt es noch keine Anbieterfakten.",
    },
    {
      id: "avatar",
      ok: local.avatarCount > 0,
      label: "Avatar",
      hint:
        local.avatarCount > 0
          ? `${local.avatarCount} Avatar${local.avatarCount === 1 ? "" : "e"} verfügbar.`
          : "Noch kein Avatar für diese Organisation angelegt.",
    },
    {
      id: "structure",
      ok: Boolean(local.structure),
      label: "Webseitenstruktur",
      hint: local.structure
        ? `Struktur „${local.structure.filename ?? "ohne Dateiname"}“ hinterlegt.`
        : "Die Seitenliste fehlt noch (SEO → Struktur).",
    },
  ];
  return { ready: checks.every((c) => c.ok), checks };
}

export async function loadContentReadiness(
  service: SupabaseClient,
  organisationId: string,
): Promise<{ readiness: ContentReadiness; local: ContentLocalSources }> {
  const local = await loadContentLocalSources(service, organisationId);
  return { readiness: readinessFromLocal(local), local };
}
