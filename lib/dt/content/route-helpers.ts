import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { contentAgentConfig, type ContentAgentConfig, type ContentAgentResult } from "@/lib/dt/content/client";
import { contentClientKey } from "@/lib/dt/content/mapping";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import { createClient } from "@/lib/supabase/server";

const orgIdSchema = z.string().uuid();

/** Path segments forwarded to the Content-Agent — never let `/`, `..` or `?` through. */
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,159}$/i;
const JOB_ID_RE = /^[a-z0-9][a-z0-9_.-]{0,159}$/i;

export function isValidContentSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

export function isValidContentJobId(id: string): boolean {
  return JOB_ID_RE.test(id) && !id.includes("..");
}

export function parseContentStep(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : null;
}

export type ContentGate = {
  supabase: SupabaseClient;
  userId: string;
  userEmail: string | null;
  organisationId: string;
  clientKey: string;
  /** Null = demo mode (fixtures). */
  config: ContentAgentConfig | null;
};

export function contentError(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status });
}

export function contentOk<T>(data: T, demo: boolean, status = 200) {
  return NextResponse.json({ ok: true, demo, data }, { status });
}

export function contentFromAgent<T>(result: ContentAgentResult<T>) {
  if (!result.ok) {
    const status = result.status >= 400 && result.status < 600 ? result.status : 502;
    return contentError(result.message, status);
  }
  return contentOk(result.data, false, result.status === 202 ? 202 : 200);
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
      userId: user.id,
      userEmail: user.email ?? null,
      organisationId: parsed.data,
      clientKey: contentClientKey(parsed.data),
      config: contentAgentConfig(),
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
