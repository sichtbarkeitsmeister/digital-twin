import { contentError, contentOk, gateContentRoute } from "@/lib/dt/content/route-helpers";
import { loadContentPages } from "@/lib/dt/content/store";
import type { ContentClientQuestion, ContentQuestionsResult } from "@/lib/dt/content/types";

/** All open customer questions across pages that are waiting ("Braucht Sie"). */
export async function GET(req: Request) {
  const gated = await gateContentRoute(new URL(req.url).searchParams.get("org"));
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  try {
    const pages = await loadContentPages(gate.service, gate.organisationId);
    const questions: ContentClientQuestion[] = [];
    for (const page of pages) {
      if (page.state !== "braucht_sie") continue;
      for (const q of page.questions) questions.push({ ...q, page: page.name, slug: page.slug });
    }
    const data: ContentQuestionsResult = { questions };
    return contentOk(data);
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Fragen konnten nicht geladen werden.", 500);
  }
}
