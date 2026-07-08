import { NextResponse } from "next/server";
import { z } from "zod";

import {
  loadDtAgentContextBundle,
  type DtAgentContextMode,
} from "@/lib/dt/agent-context-inspector";
import { isSeoAdvisorAgent } from "@/lib/dt/agents/seo-advisor";
import { canViewDtAgentContext, isPlatformAdmin } from "@/lib/dt/org-access";
import { createClient } from "@/lib/supabase/server";

const querySchema = z.object({
  org: z.string().uuid(),
  agent: z.string().uuid(),
  mode: z.enum(["default", "seo", "team"]).default("default"),
});

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user?.id) {
    return NextResponse.json(
      { ok: false, message: "Nicht angemeldet." },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    org: url.searchParams.get("org"),
    agent: url.searchParams.get("agent"),
    mode: url.searchParams.get("mode") ?? "default",
  });

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Ungültige Parameter." },
      { status: 400 },
    );
  }

  const allowed = await canViewDtAgentContext(
    supabase,
    user.id,
    parsed.data.org,
  );
  if (!allowed) {
    return NextResponse.json(
      { ok: false, message: "Keine Berechtigung." },
      { status: 403 },
    );
  }

  if (parsed.data.mode === "seo" && !(await isPlatformAdmin(supabase, user.id))) {
    return NextResponse.json(
      { ok: false, message: "SEO-Kontext ist nur für Plattform-Administratoren verfügbar." },
      { status: 403 },
    );
  }

  const platformAdmin = await isPlatformAdmin(supabase, user.id);
  if (!platformAdmin) {
    const { data: agent } = await supabase
      .from("dt_agents")
      .select("slug,kind")
      .eq("id", parsed.data.agent)
      .eq("organisation_id", parsed.data.org)
      .maybeSingle();
    if (!agent) {
      return NextResponse.json({ ok: false, message: "Agent nicht gefunden." }, { status: 404 });
    }
    if (isSeoAdvisorAgent(agent)) {
      return NextResponse.json(
        { ok: false, message: "Der SEO-Berater ist nur für Administratoren sichtbar." },
        { status: 403 },
      );
    }
  }

  try {
    const bundle = await loadDtAgentContextBundle({
      userId: user.id,
      organisationId: parsed.data.org,
      agentId: parsed.data.agent,
      mode: parsed.data.mode as DtAgentContextMode,
    });

    return NextResponse.json({ ok: true, bundle });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Kontext konnte nicht geladen werden.";
    return NextResponse.json({ ok: false, message }, { status: 404 });
  }
}
