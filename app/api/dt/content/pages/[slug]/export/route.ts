import { contentExportFile, contentExportResponse, isContentExportFormat } from "@/lib/dt/content/export";
import { contentError, gateContentRoute, isValidContentSlug } from "@/lib/dt/content/route-helpers";
import { loadContentPage } from "@/lib/dt/content/store";

export async function GET(req: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!isValidContentSlug(slug)) return contentError("Ungültige Seite.", 400);

  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "html";
  if (!isContentExportFormat(format)) return contentError("Unbekanntes Format.", 400);

  const gated = await gateContentRoute(url.searchParams.get("org"));
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  let page;
  try {
    page = await loadContentPage(gate.service, gate.organisationId, slug);
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Seite konnte nicht geladen werden.", 500);
  }
  if (!page) return contentError("Seite nicht gefunden.", 404);
  if (!page.html) return contentError("Für diese Seite gibt es noch keinen Text.", 404);

  return contentExportResponse(
    contentExportFile(format, { slug, title: page.title || page.name, html: page.html, markdown: page.markdown }),
  );
}
