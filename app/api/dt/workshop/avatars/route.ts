import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { recordLlmUsageEvent } from "@/lib/dt/record-llm-usage";
import { requireTranscriptAccess } from "@/lib/dt/transcripts/access";
import {
  applyAvatarGeneratorResult,
  buildAvatarGeneratorUserMessage,
  type OrgAgentRow,
} from "@/lib/dt/transcripts/avatar-generator";
import { loadAvatarGeneratorPrompt } from "@/lib/dt/transcripts/avatar-generator-prompt-db";
import {
  generateAvatar,
  proposeAvatarPlan,
  workshopFailureMessage,
} from "@/lib/dt/transcripts/workshop-llm";
import {
  AVATAR_PLAN_MAX,
  AVATAR_PLAN_MIN,
  mergeAntworten,
  missingSummaryMessage,
  normalizeAntworten,
  sourcesWithoutSummary,
} from "@/lib/dt/transcripts/workshop-model";
import {
  loadWorkshopState,
  reconcileAvatarAgents,
  replaceAvatar,
  saveAvatarPlan,
} from "@/lib/dt/transcripts/workshop-store";

export const maxDuration = 300;

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  action: z.enum(["plan", "approve", "generate"]),
  avatarKey: z.string().min(1).max(48).optional(),
  /** „Anzahl Avatare“ of the plan. */
  count: z.number().int().min(AVATAR_PLAN_MIN).max(AVATAR_PLAN_MAX).optional(),
  notWanted: z.string().max(2000).optional(),
  instruction: z.string().trim().max(4_000).optional(),
  titles: z
    .array(z.object({ key: z.string().min(1).max(48), title: z.string().trim().min(2).max(120) }))
    .max(AVATAR_PLAN_MAX)
    .optional(),
  /** Answers to the generator's Rückfragen. */
  answers: z
    .array(
      z.object({
        block: z.string().max(200),
        frage: z.string().min(1).max(2_000),
        antwort: z.string().max(4_000),
      }),
    )
    .max(40)
    .optional(),
});

async function recordUsage(
  supabase: Awaited<ReturnType<typeof requireAuthUser>>["supabase"],
  organisationId: string,
  userId: string,
  result: { model: string | null; usage: { inputTokens: number; outputTokens: number } },
) {
  await recordLlmUsageEvent(supabase, {
    organisationId,
    userId,
    via: "direct",
    mode: "transcript",
    model: result.model,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
  });
}

export async function POST(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Ungültige Eingabe." }, { status: 400 });
  }
  const { organisationId, action } = parsed.data;
  const gate = await requireTranscriptAccess(auth.supabase, auth.userId, organisationId);
  if (!gate.ok) return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });

  try {
    const state = await loadWorkshopState(auth.supabase, organisationId);
    if (state.sources.length === 0) {
      return NextResponse.json({ ok: false, message: "Noch keine Transkripte." }, { status: 400 });
    }
    const { data: org } = await auth.supabase
      .from("organisations")
      .select("name")
      .eq("id", organisationId)
      .maybeSingle();
    const organisationName = org?.name?.trim() || "Organisation";

    // Plan and avatars read only the saved summaries; a conversation without one blocks both.
    if (action !== "approve") {
      const missing = sourcesWithoutSummary(state.sources);
      if (missing.length > 0) {
        return NextResponse.json(
          { ok: false, message: missingSummaryMessage(missing), missingSummaries: missing },
          { status: 400 },
        );
      }
    }

    if (action === "plan") {
      const instruction = parsed.data.instruction?.trim() ?? "";
      const count = parsed.data.count ?? Math.max(AVATAR_PLAN_MIN, state.avatarPlan.avatars.length);
      const result = await proposeAvatarPlan({
        organisationName,
        sources: state.sources,
        anbieterItems: state.anbieter.items,
        previous: state.avatarPlan.avatars,
        count,
        instruction,
        notWanted: state.avatarPlan.notWanted,
      });
      await recordUsage(auth.supabase, organisationId, auth.userId, result);
      await saveAvatarPlan(auth.supabase, organisationId, {
        status: "proposed",
        sourceFingerprint: state.fingerprint,
        approvedFingerprint: null,
        revisionNote: instruction || state.avatarPlan.revisionNote,
        notWanted: result.notWanted,
        hinweis: result.hinweis,
        avatars: result.avatars,
      });
      const fresh = await loadWorkshopState(auth.supabase, organisationId);
      return NextResponse.json({ ok: true, avatarPlan: fresh.avatarPlan });
    }

    if (action === "approve") {
      if (state.avatarPlan.status !== "proposed") {
        return NextResponse.json(
          {
            ok: false,
            message:
              state.avatarPlan.status === "stale"
                ? "Der Bestand hat sich geändert. Bitte den Avatar-Plan neu erzeugen."
                : "Es liegt kein freizugebender Avatar-Plan vor.",
          },
          { status: 400 },
        );
      }
      const titles = new Map((parsed.data.titles ?? []).map((row) => [row.key, row.title]));
      await saveAvatarPlan(auth.supabase, organisationId, {
        ...state.avatarPlan,
        status: "approved",
        sourceFingerprint: state.fingerprint,
        approvedFingerprint: state.fingerprint,
        notWanted: parsed.data.notWanted ?? state.avatarPlan.notWanted,
        avatars: state.avatarPlan.avatars.map((avatar) => ({
          ...avatar,
          title: titles.get(avatar.key) ?? avatar.title,
        })),
      });
      const fresh = await loadWorkshopState(auth.supabase, organisationId);
      return NextResponse.json({ ok: true, avatarPlan: fresh.avatarPlan });
    }

    // generate: one avatar of the approved plan → Rückfragen, or a checked prompt in Agenten.
    if (state.avatarPlan.status !== "approved") {
      return NextResponse.json(
        { ok: false, message: "Bitte zuerst den Avatar-Plan freigeben." },
        { status: 400 },
      );
    }
    const plan = await reconcileAvatarAgents(auth.supabase, organisationId, state.avatarPlan);
    const avatar = plan.avatars.find((item) => item.key === parsed.data.avatarKey);
    if (!avatar) {
      return NextResponse.json({ ok: false, message: "Avatar nicht gefunden." }, { status: 404 });
    }
    const { data: agentRows, error: agentsError } = await auth.supabase
      .from("dt_agents")
      .select("id,name,avatar_data")
      .eq("organisation_id", organisationId);
    if (agentsError) throw new Error(agentsError.message);
    const agents = (agentRows ?? []) as OrgAgentRow[];
    const ownAgent = avatar.agentId ? agents.find((agent) => agent.id === avatar.agentId) : null;

    const antworten = mergeAntworten(
      avatar.generator?.antworten ?? [],
      normalizeAntworten(parsed.data.answers ?? []),
    );
    const previousErrors = avatar.generator?.status === "fehler" ? avatar.generator.errors : [];
    const system = await loadAvatarGeneratorPrompt(organisationName);
    const user = buildAvatarGeneratorUserMessage({
      organisationName,
      avatar,
      otherTitles: plan.avatars.filter((item) => item.key !== avatar.key).map((item) => item.title),
      notWanted: plan.notWanted,
      existingAgentNames: agents.map((agent) => agent.name),
      ownAgentName: ownAgent?.name ?? null,
      sources: state.sources,
      anbieterItems: state.anbieter.items,
      antworten,
      previousErrors,
    });
    const generated = await generateAvatar({ system, user });
    await recordUsage(auth.supabase, organisationId, auth.userId, generated);
    const applied = await applyAvatarGeneratorResult({
      supabase: auth.supabase,
      organisationId,
      avatar,
      result: generated.result,
      agents,
      antworten,
    });

    // Only this avatar changes; the rest of the plan is read again after the long call.
    const latest = await loadWorkshopState(auth.supabase, organisationId);
    const current = latest.avatarPlan.avatars.find((item) => item.key === avatar.key);
    if (current) {
      await saveAvatarPlan(
        auth.supabase,
        organisationId,
        replaceAvatar(latest.avatarPlan, avatar.key, {
          ...current,
          generator: applied.avatar.generator,
          agentId: applied.avatar.agentId,
        }),
      );
    }
    const fresh = await loadWorkshopState(auth.supabase, organisationId);
    return NextResponse.json({
      ok: true,
      avatarPlan: fresh.avatarPlan,
      outcome: applied.outcome.kind,
      errors: applied.outcome.kind === "invalid" ? applied.outcome.errors : [],
      agentId: applied.avatar.agentId,
    });
  } catch (err) {
    const message = workshopFailureMessage(err, "Avatar-Schritt fehlgeschlagen.");
    return NextResponse.json(
      { ok: false, message: message || "Avatar-Schritt fehlgeschlagen." },
      { status: 500 },
    );
  }
}
