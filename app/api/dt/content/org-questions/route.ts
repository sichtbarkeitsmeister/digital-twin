import { z } from "zod";

import { answerOrgQuestion, loadOrgQuestions } from "@/lib/dt/content/org-questions";
import { contentError, contentOk, gateContentRoute, readJsonBody } from "@/lib/dt/content/route-helpers";
import type { ContentOrgQuestionsResult } from "@/lib/dt/content/types";

const putSchema = z.object({
  organisationId: z.string().uuid(),
  id: z.string().uuid(),
  action: z.enum(["answer", "no_answer", "reopen"]),
  answer: z.string().max(2_000).optional().nullable(),
});

async function result(service: Parameters<typeof loadOrgQuestions>[0], organisationId: string): Promise<ContentOrgQuestionsResult> {
  const rows = await loadOrgQuestions(service, organisationId);
  return {
    questions: rows.map((r) => ({
      id: r.id,
      question: r.question,
      placeholder: r.placeholder,
      status: r.status,
      answer: r.answer,
      pages: r.page_slugs.length,
      page_slugs: r.page_slugs,
      topic_key: r.topic_key,
      answered_at: r.answered_at,
    })),
  };
}

/** „Fragen zum Unternehmen“: the organisation's company questions, asked once for all pages. */
export async function GET(req: Request) {
  const gated = await gateContentRoute(new URL(req.url).searchParams.get("org"));
  if (!gated.ok) return gated.response;
  try {
    return contentOk(await result(gated.gate.service, gated.gate.organisationId));
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Fragen zum Unternehmen konnten nicht geladen werden.", 500);
  }
}

/**
 * One answer for all pages (or „Keine Angabe“, or reopen). A contact topic also fills the
 * Kontaktdaten (source „antwort“); every later step reads the answer as a confirmed fact.
 */
export async function PUT(req: Request) {
  const parsed = putSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError("Ungültige Antwort.", 400);
  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;
  try {
    await answerOrgQuestion(gate.service, {
      organisationId: gate.organisationId,
      id: parsed.data.id,
      action: parsed.data.action,
      answer: parsed.data.answer ?? null,
      userId: gate.userId,
    });
    return contentOk(await result(gate.service, gate.organisationId));
  } catch (error) {
    const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 500;
    return contentError(error instanceof Error ? error.message : "Antwort konnte nicht gespeichert werden.", status);
  }
}
