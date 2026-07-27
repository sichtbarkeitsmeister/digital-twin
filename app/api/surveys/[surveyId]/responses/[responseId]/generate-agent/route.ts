import { NextResponse } from "next/server";
import { z } from "zod";

import {
  pollAgentGenerationBatchFromSurvey,
  startAgentGenerationBatchFromSurvey,
} from "@/lib/dt/survey-to-agent-service";
import { requireSurveyPlatformAdmin } from "@/lib/surveys/platform-admin";

/**
 * Batch start/poll only — Anthropic does the long work outside Vercel.
 * Keep this low so deploys work on Hobby (300s max) and Pro alike.
 */
export const maxDuration = 60;

const clarificationResolutionSchema = z.object({
  clarificationId: z.string().min(1).max(120),
  approved: z.boolean(),
  sourceResponseId: z.string().uuid().nullable().optional(),
});

const bodySchema = z
  .object({
    organisationId: z.string().uuid(),
    extraRules: z.string().max(4000).optional(),
    mode: z.enum(["create", "refine", "coverage"]).default("create"),
    agentId: z.string().uuid().optional(),
    /** When set, poll an existing Anthropic Message Batch instead of starting a new one. */
    batchId: z.string().min(8).max(200).optional(),
    /** Admin Freigaben for ambiguous remarks / cross-refs (only on batch start). */
    clarifications: z.array(clarificationResolutionSchema).max(40).optional(),
    /** Current preview required when mode=coverage (patch missing facts). */
    preview: z.unknown().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.mode === "refine" && !data.agentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "agentId ist für den Verfeinerungsmodus erforderlich.",
        path: ["agentId"],
      });
    }
    if (data.mode === "coverage" && !data.batchId && data.preview == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "preview ist für Coverage-Repair erforderlich.",
        path: ["preview"],
      });
    }
  });

export async function POST(
  _req: Request,
  context: { params: Promise<{ surveyId: string; responseId: string }> },
) {
  const auth = await requireSurveyPlatformAdmin();
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, message: auth.message },
      { status: auth.message.includes("angemeldet") ? 401 : 403 },
    );
  }

  const { surveyId, responseId } = await context.params;
  const parsed = bodySchema.safeParse(await _req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  try {
    if (parsed.data.batchId) {
      const result = await pollAgentGenerationBatchFromSurvey({
        surveyId,
        responseId,
        organisationId: parsed.data.organisationId,
        mode: parsed.data.mode,
        batchId: parsed.data.batchId,
        agentId: parsed.data.agentId,
      });

      if (!result.ok) {
        return NextResponse.json(
          {
            ok: false,
            message: result.message,
            existingAgentId: "existingAgentId" in result ? result.existingAgentId : undefined,
          },
          { status: result.status },
        );
      }

      if (result.status === "pending") {
        return NextResponse.json({
          ok: true,
          status: "pending" as const,
          batchId: result.batchId,
          processingStatus: result.processingStatus,
          mode: result.mode,
          organisationId: result.organisationId,
          organisationName: result.organisationName,
        });
      }

      if (result.mode === "refine") {
        return NextResponse.json({
          ok: true,
          status: "ready" as const,
          mode: "refine" as const,
          refinement: result.refinement,
          currentPrompt: result.currentPrompt,
          usesGlobalPrompt: result.usesGlobalPrompt,
          agent: result.agent,
          organisationId: result.organisationId,
          organisationName: result.organisationName,
        });
      }

      return NextResponse.json({
        ok: true,
        status: "ready" as const,
        mode: result.mode === "coverage" ? ("coverage" as const) : ("create" as const),
        preview: result.preview,
        factCoverage: "factCoverage" in result ? result.factCoverage : undefined,
        organisationId: result.organisationId,
        organisationName: result.organisationName,
      });
    }

    const started = await startAgentGenerationBatchFromSurvey({
      surveyId,
      responseId,
      organisationId: parsed.data.organisationId,
      mode: parsed.data.mode,
      agentId: parsed.data.agentId,
      extraRules: parsed.data.extraRules,
      clarifications: parsed.data.clarifications,
      preview:
        parsed.data.mode === "coverage" && parsed.data.preview != null
          ? (parsed.data.preview as never)
          : undefined,
    });

    if (!started.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: started.message,
          existingAgentId: "existingAgentId" in started ? started.existingAgentId : undefined,
        },
        { status: started.status },
      );
    }

    if (started.mode === "refine") {
      return NextResponse.json({
        ok: true,
        status: "pending" as const,
        batchId: started.batchId,
        model: started.model,
        mode: "refine" as const,
        currentPrompt: started.currentPrompt,
        usesGlobalPrompt: started.usesGlobalPrompt,
        agent: started.agent,
        organisationId: started.organisationId,
        organisationName: started.organisationName,
      });
    }

    return NextResponse.json({
      ok: true,
      status: "pending" as const,
      batchId: started.batchId,
      model: started.model,
      mode: started.mode === "coverage" ? ("coverage" as const) : ("create" as const),
      organisationId: started.organisationId,
      organisationName: started.organisationName,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generierung fehlgeschlagen.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
