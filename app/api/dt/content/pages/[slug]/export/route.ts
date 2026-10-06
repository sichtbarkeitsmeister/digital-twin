import { fullHtmlDocument } from "@/lib/dt/content/render";
import { contentError, gateContentRoute, isValidContentSlug } from "@/lib/dt/content/route-helpers";
import { loadContentPage } from "@/lib/dt/content/store";
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

  const page = await loadContentPage(gate.service, gate.organisationId, slug);
  if (!page) return contentError("Seite nicht gefunden.", 404);
  if (!page.html) return contentError("Für diese Seite gibt es noch keinen Text.", 404);

  const file =
    format === "md"
      ? { body: page.markdown, filename: `${slug}.md`, contentType: "text/markdown; charset=utf-8" }
      : format === "fragment"
        ? { body: page.html, filename: `${slug}.fragment.html`, contentType: "text/html; charset=utf-8" }
        : {
            body: fullHtmlDocument(page.title || page.name, page.html),
            filename: `${slug}.html`,
            contentType: "text/html; charset=utf-8",
          };

  return new Response(file.body, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": attachment(file.filename),
      "Cache-Control": "no-store",
    },
  });
}
