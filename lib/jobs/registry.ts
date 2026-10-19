import { contentPageHandler } from "./handlers/content-page";
import { groundingPageHandler } from "./handlers/grounding-page";
import { leadinfoNormalizeHandler } from "./handlers/leadinfo-normalize";
import { seoCrawlHandler } from "./handlers/seo-crawl";
import { textToolGeoHandler } from "./handlers/text-tool-geo";
import { textToolSeoHandler } from "./handlers/text-tool-seo";
import type { JobHandler } from "./types";

/**
 * Map of job kind → handler. Add new kinds here as phases land.
 */
export const JOB_HANDLERS: Record<string, JobHandler> = {
  "leadinfo.normalize": leadinfoNormalizeHandler,
  "seo.crawl": seoCrawlHandler,
  "content.page": contentPageHandler,
  "grounding.page": groundingPageHandler,
  "text-tool.geo": textToolGeoHandler,
  "text-tool.seo": textToolSeoHandler,
};

export function findHandler(kind: string): JobHandler | null {
  return JOB_HANDLERS[kind] ?? null;
}
