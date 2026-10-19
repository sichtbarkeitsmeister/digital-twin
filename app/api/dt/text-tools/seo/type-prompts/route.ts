import { getContentTypePromptsResponse, putContentTypePromptsResponse } from "@/lib/dt/content/type-prompts-api";

/** The SEO tool's own Textvorlagen; saving them never changes the ones of Texte. */
export async function GET() {
  return getContentTypePromptsResponse("seo_tool");
}

export async function PUT(req: Request) {
  return putContentTypePromptsResponse(req, "seo_tool");
}
