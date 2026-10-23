import { contentPageHandler } from "./handlers/content-page";
import { groundingPageHandler } from "./handlers/grounding-page";
import { leadinfoNormalizeHandler } from "./handlers/leadinfo-normalize";
import { seoCrawlHandler } from "./handlers/seo-crawl";
import { seoGroundingCheckHandler } from "./handlers/seo-grounding-check";
import { seoGroundingScheduleHandler } from "./handlers/seo-grounding-schedule";
import type { JobHandler } from "./types";

/**
 * Map of job kind → handler. Add new kinds here as phases land.
 */
export const JOB_HANDLERS: Record<string, JobHandler> = {
  "leadinfo.normalize": leadinfoNormalizeHandler,
  "seo.crawl": seoCrawlHandler,
  "content.page": contentPageHandler,
  "grounding.page": groundingPageHandler,
  "seo.grounding_check": seoGroundingCheckHandler,
  "seo.grounding_schedule": seoGroundingScheduleHandler,
};

export function findHandler(kind: string): JobHandler | null {
  return JOB_HANDLERS[kind] ?? null;
}
