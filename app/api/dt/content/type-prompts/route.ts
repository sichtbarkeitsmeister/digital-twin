import { getContentTypePromptsResponse, putContentTypePromptsResponse } from "@/lib/dt/content/type-prompts-api";

/** The Textvorlagen of Texte (the SEO step). The SEO tool has its own set under /api/dt/text-tools/seo/type-prompts. */
export async function GET() {
  return getContentTypePromptsResponse("texte");
}

export async function PUT(req: Request) {
  return putContentTypePromptsResponse(req, "texte");
}
