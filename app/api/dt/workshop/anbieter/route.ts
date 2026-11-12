import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { recordLlmUsageEvent } from "@/lib/dt/record-llm-usage";
import { requireTranscriptAccess } from "@/lib/dt/transcripts/access";
import {
  evaluateAnbieterCorpus,
  extractAnbieterStatements,
  prepareAnbieterGuardrails,
  workshopFailureMessage,
} from "@/lib/dt/transcripts/workshop-llm";
import { forgetRemovedSources } from "@/lib/dt/transcripts/anbieter-eval";
import { anbieterForClient } from "@/lib/dt/transcripts/workshop-model";
import { loadWorkshopState, saveAnbieterState, syncAnbieterToSeoAdvisor } from "@/lib/dt/transcripts/workshop-store";

export const maxDuration = 300;

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  action: z.enum(["extract", "evaluate", "approve", "keep-removed"]),
  /** „merge“: only new sources are worked in. „remove“: the content of deleted sources leaves the stand. */
  mode: z.enum(["full", "merge", "remove"]).optional(),
  instruction: z.string().trim().max(4_000).optional(),
});

async function organisationName(
  supabase: Awaited<ReturnType<typeof requireAuthUser>>["supabase"],
  organisationId: string,
): Promise<string> {
  const { data: org } = await supabase.from("organisations").select("name").eq("id", organisationId).maybeSingle();
  const { data: config } = await supabase
    .from("dt_org_config")
    .select("display_name")
    .eq("organisation_id", organisationId)
    .maybeSingle();
  return config?.display_name?.trim() || org?.name?.trim() || "Organisation";
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
  const gate = await requireTranscriptAccess(auth.supabase, auth.userId, parsed.data.organisationId);
  if (!gate.ok) return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });

  const deadline = Date.now() + 270_000;
  try {
    const state = await loadWorkshopState(auth.supabase, parsed.data.organisationId);
    // A source was deleted and its content shall stay: the texts stay, the stand stays valid.
    if (parsed.data.action === "keep-removed") {
      if (!state.anbieter.review || state.anbieter.sync.removed === 0) {
        return NextResponse.json({ ok: true, anbieter: anbieterForClient(state.anbieter) });
      }
      const review = forgetRemovedSources(state.anbieter.review, state.sources);
      // Only the deletion stood between the stand and the Bestand: then it is up to date again.
      const onlyDeletion = state.anbieter.sync.added.length === 0 && state.anbieter.sync.changed.length === 0;
      const wasApproved =
        state.anbieter.approvedFingerprint != null &&
        state.anbieter.approvedFingerprint === state.anbieter.sourceFingerprint;
      await saveAnbieterState(auth.supabase, parsed.data.organisationId, {
        ...state.anbieter,
        review,
        ...(onlyDeletion
          ? {
              sourceFingerprint: state.fingerprint,
              approvedFingerprint: wasApproved ? state.fingerprint : state.anbieter.approvedFingerprint,
            }
          : {}),
      });
      const fresh = await loadWorkshopState(auth.supabase, parsed.data.organisationId);
      return NextResponse.json({ ok: true, anbieter: anbieterForClient(fresh.anbieter) });
    }

    if (state.sources.length === 0) {
      return NextResponse.json({ ok: false, message: "Noch keine Transkripte." }, { status: 400 });
    }
    const name = await organisationName(auth.supabase, parsed.data.organisationId);

    const instruction = parsed.data.instruction?.trim() ?? "";
    const mode = parsed.data.mode ?? "full";
    const incremental = mode === "merge" || mode === "remove";
    // A changed Bestand is read anew as a whole unless only new sources are worked in or deleted
    // ones taken out; only an up-to-date, checked stand is revised point by point.
    const current =
      incremental || (instruction && state.anbieter.status !== "stale")
        ? { items: state.anbieter.items, review: state.anbieter.review }
        : undefined;
    const runInstruction = incremental ? "" : instruction;
    const record = (result: { model: string | null; usage: { inputTokens: number; outputTokens: number } }) =>
      recordLlmUsageEvent(auth.supabase, {
        organisationId: parsed.data.organisationId,
        userId: auth.userId!,
        via: "direct",
        mode: "transcript",
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });

    // Stage 1: statements out of every source, then the guard rails out of the internal notes.
    // The browser repeats this until nothing is pending.
    if (parsed.data.action === "extract") {
      const result = await extractAnbieterStatements({
        sources: state.sources,
        store: state.anbieter.extraction,
        deadline,
      });
      if (result.calls > 0) await record(result);
      // A round that read sources leaves the guard rails to the next request: each stays short.
      let guard = state.anbieter.guard;
      let guardReady = false;
      if (result.pending === 0 && result.calls === 0) {
        const prepared = await prepareAnbieterGuardrails({
          sources: state.sources,
          store: result.store,
          mode,
          instruction: runInstruction,
          current,
          cached: guard,
          deadline,
        });
        if (prepared.calls > 0) await record(prepared);
        guard = prepared.guard;
        guardReady = true;
      }
      // Re-read before saving: only the statements and guard rails change, never a stand saved meanwhile.
      const latest = await loadWorkshopState(auth.supabase, parsed.data.organisationId);
      await saveAnbieterState(auth.supabase, parsed.data.organisationId, {
        ...latest.anbieter,
        extraction: result.store,
        guard,
      });
      if (result.error && result.calls === 0 && result.pending > 0) {
        return NextResponse.json({ ok: false, message: result.error }, { status: 500 });
      }
      return NextResponse.json({
        ok: true,
        pending: result.pending,
        total: result.total,
        read: result.total - result.pending,
        done: result.pending === 0 && guardReady,
      });
    }

    if (parsed.data.action === "evaluate") {
      const result = await evaluateAnbieterCorpus({
        organisationName: name,
        sources: state.sources,
        store: state.anbieter.extraction,
        instruction: runInstruction,
        mode,
        current,
        guard: state.anbieter.guard,
        deadline,
      });
      await record(result);
      const anbieter = {
        status: "proposed" as const,
        sourceFingerprint: state.fingerprint,
        approvedFingerprint: null,
        revisionNote: runInstruction || state.anbieter.revisionNote,
        items: result.items,
        savedAt: new Date().toISOString(),
        openWithSource: [],
        extraction: state.anbieter.extraction,
        review: result.review,
        sync: { added: [], changed: [], removed: 0 },
        guard: state.anbieter.guard,
      };
      await saveAnbieterState(auth.supabase, parsed.data.organisationId, anbieter);
      const fresh = await loadWorkshopState(auth.supabase, parsed.data.organisationId);
      return NextResponse.json({ ok: true, anbieter: anbieterForClient(fresh.anbieter) });
    }

    if (state.anbieter.status !== "proposed") {
      return NextResponse.json(
        {
          ok: false,
          message:
            state.anbieter.status === "stale"
              ? "Der Bestand hat sich geändert. Bitte neu auswerten."
              : "Es liegt kein freizugebender Anbieterstand vor.",
        },
        { status: 400 },
      );
    }
    const approved = {
      ...state.anbieter,
      status: "approved" as const,
      approvedFingerprint: state.fingerprint,
      sourceFingerprint: state.fingerprint,
    };
    const synced = await syncAnbieterToSeoAdvisor({
      supabase: auth.supabase,
      organisationId: parsed.data.organisationId,
      organisationName: name,
      anbieter: approved,
    });
    if (!synced.agentId) {
      return NextResponse.json(
        { ok: false, message: synced.error ?? "SEO-Berater konnte nicht aktualisiert werden." },
        { status: 500 },
      );
    }
    await saveAnbieterState(auth.supabase, parsed.data.organisationId, approved);
    const fresh = await loadWorkshopState(auth.supabase, parsed.data.organisationId);
    return NextResponse.json({ ok: true, anbieter: anbieterForClient(fresh.anbieter) });
  } catch (err) {
    const message = workshopFailureMessage(err, "Anbieter-Auswertung fehlgeschlagen.");
    return NextResponse.json(
      { ok: false, message: message || "Anbieter-Auswertung fehlgeschlagen." },
      { status: 500 },
    );
  }
}
