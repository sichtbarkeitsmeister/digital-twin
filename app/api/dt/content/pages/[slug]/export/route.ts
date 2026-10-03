import { contentAgentFile } from "@/lib/dt/content/client";
import { demoExport } from "@/lib/dt/content/fixtures";
import {
  contentError,
  gateContentRoute,
  isValidContentSlug,
} from "@/lib/dt/content/route-helpers";
import type { ContentExportFormat } from "@/lib/dt/content/types";

const FORMATS: ContentExportFormat[] = ["html", "fragment", "md"];

function attachment(filename: string): string {
  return `attachment; filename="${filename.replace(/[^a-z0-9._-]/gi, "_")}"`;
}

export async function GET(req: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!isValidContentSlug(slug)) return contentError("Ungültige Seite.", 400);

  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "html") as ContentExportFormat;
  if (!FORMATS.includes(format)) return contentError("Unbekanntes Format.", 400);

  const gated = await gateContentRoute(url.searchParams.get("org"));
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  if (!gate.config) {
    const file = demoExport(slug, format);
    if (!file) return contentError("Für diese Seite gibt es noch keinen Text.", 404);
    return new Response(file.body, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": attachment(file.filename),
        "Cache-Control": "no-store",
      },
    });
  }

  const result = await contentAgentFile(
    gate.config,
    `/clients/${encodeURIComponent(gate.clientKey)}/pages/${encodeURIComponent(slug)}/export`,
    { format },
  );
  if (!result.ok) return contentError(result.message, result.status >= 400 ? result.status : 502);

  const ext = format === "md" ? "md" : format === "fragment" ? "fragment.html" : "html";
  return new Response(result.response.body, {
    headers: {
      "Content-Type":
        result.response.headers.get("content-type") ??
        (format === "md" ? "text/markdown; charset=utf-8" : "text/html; charset=utf-8"),
      "Content-Disposition":
        result.response.headers.get("content-disposition") ?? attachment(`${slug}.${ext}`),
      "Cache-Control": "no-store",
    },
  });
}
