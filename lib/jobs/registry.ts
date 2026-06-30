import { leadinfoNormalizeHandler } from "./handlers/leadinfo-normalize";
import { seoCrawlHandler } from "./handlers/seo-crawl";
import type { JobHandler } from "./types";

/**
 * Map of job kind → handler. Add new kinds here as phases land.
 */
export const JOB_HANDLERS: Record<string, JobHandler> = {
  "leadinfo.normalize": leadinfoNormalizeHandler,
  "seo.crawl": seoCrawlHandler,
};

export function findHandler(kind: string): JobHandler | null {
  return JOB_HANDLERS[kind] ?? null;
}
