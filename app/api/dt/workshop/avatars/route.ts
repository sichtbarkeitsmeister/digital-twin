import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { ensureAvatarGlobalPromptAnchor } from "@/lib/dt/prompts/avatar-global-prompt-anchor";
import { recordLlmUsageEvent } from "@/lib/dt/record-llm-usage";
import { createConfirmedTranscriptPersonas } from "@/lib/dt/transcripts/apply-knowledge";
import { requireTranscriptAccess } from "@/lib/dt/transcripts/access";
import {
  buildAvatarDossier,
  previewAvatarFromDossier,
  proposeAvatarPlan,
} from "@/lib/dt/transcripts/workshop-llm";
import { loadWorkshopState, replaceAvatar, saveAvatarPlan } from "@/lib/dt/transcripts/workshop-store";

export const maxDuration = 300;

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  action: z.enum(["plan", "approve", "dossier", "preview", "create"]),
  avatarKey: z.string().min(1).max(48).optional(),
  notWanted: z.string().max(2000).optional(),
  titles: z
    .array(z.object({ key: z.string().min(1).max(48), title: z.string().trim().min(2).max(120) }))
    .max(6)
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

    if (action === "plan") {
      const result = await proposeAvatarPlan({
        organisationName,
        sources: state.sources,
        previous: state.avatarPlan.avatars,
      });
      await recordUsage(auth.supabase, organisationId, auth.userId, result);
      await saveAvatarPlan(auth.supabase, organisationId, {
        status: "proposed",
        sourceFingerprint: state.fingerprint,
        approvedFingerprint: state.avatarPlan.approvedFingerprint,
        notWanted: result.notWanted,
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

    if (state.avatarPlan.status !== "approved") {
      return NextResponse.json(
        { ok: false, message: "Bitte zuerst den Avatar-Plan freigeben." },
        { status: 400 },
      );
    }
    const avatar = state.avatarPlan.avatars.find((item) => item.key === parsed.data.avatarKey);
    if (!avatar) {
      return NextResponse.json({ ok: false, message: "Avatar nicht gefunden." }, { status: 404 });
    }

    if (action === "dossier") {
      const result = await buildAvatarDossier({
        organisationName,
        sources: state.sources,
        avatar,
      });
      await recordUsage(auth.supabase, organisationId, auth.userId, result);
      await saveAvatarPlan(
        auth.supabase,
        organisationId,
        replaceAvatar(state.avatarPlan, avatar.key, { ...avatar, dossier: result.dossier }),
      );
      const fresh = await loadWorkshopState(auth.supabase, organisationId);
      return NextResponse.json({ ok: true, avatarPlan: fresh.avatarPlan });
    }

    if (action === "preview") {
      const result = await previewAvatarFromDossier({ organisationName, avatar });
      await recordUsage(auth.supabase, organisationId, auth.userId, result);
      await saveAvatarPlan(
        auth.supabase,
        organisationId,
        replaceAvatar(state.avatarPlan, avatar.key, { ...avatar, preview: result.preview }),
      );
      const fresh = await loadWorkshopState(auth.supabase, organisationId);
      return NextResponse.json({ ok: true, avatarPlan: fresh.avatarPlan });
    }

    if (!avatar.preview) {
      return NextResponse.json({ ok: false, message: "Zuerst die Vorschau erzeugen." }, { status: 400 });
    }
    const promptAppend = ensureAvatarGlobalPromptAnchor(avatar.preview.promptAppend);
    if (avatar.agentId) {
      const { error } = await auth.supabase.rpc("dt_update_agent", {
        p_agent_id: avatar.agentId,
        p_patch: {
          name: avatar.preview.name,
          role: avatar.preview.role,
          prompt_append: promptAppend,
          uses_global_prompt: true,
        },
      });
      if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 400 });
      const fresh = await loadWorkshopState(auth.supabase, organisationId);
      return NextResponse.json({ ok: true, avatarPlan: fresh.avatarPlan, updated: true });
    }

    const created = await createConfirmedTranscriptPersonas({
      supabase: auth.supabase,
      organisationId,
      names: [avatar.preview.name],
      personas: [
        {
          name: avatar.preview.name,
          role: avatar.preview.role || null,
          priority: "A",
          isPrimary: true,
          description: avatar.preview.summary || avatar.title,
          goals: null,
          pains: null,
          objections: null,
          language: null,
          buyingTriggers: null,
          promptAppend: avatar.preview.promptAppend,
        },
      ],
    });
    if (!created.createdPersonaIds[0]) {
      return NextResponse.json(
        { ok: false, message: created.warnings[0] ?? "Avatar konnte nicht angelegt werden." },
        { status: 400 },
      );
    }
    await saveAvatarPlan(
      auth.supabase,
      organisationId,
      replaceAvatar(state.avatarPlan, avatar.key, {
        ...avatar,
        agentId: created.createdPersonaIds[0],
      }),
    );
    const fresh = await loadWorkshopState(auth.supabase, organisationId);
    return NextResponse.json({ ok: true, avatarPlan: fresh.avatarPlan, created: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Avatar-Schritt fehlgeschlagen.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
