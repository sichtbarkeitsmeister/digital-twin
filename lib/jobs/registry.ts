import { leadinfoNormalizeHandler } from "./handlers/leadinfo-normalize";
import type { JobHandler } from "./types";

/**
 * Map of job kind → handler. Add new kinds here as phases land.
 */
export const JOB_HANDLERS: Record<string, JobHandler> = {
  "leadinfo.normalize": leadinfoNormalizeHandler,
};

export function findHandler(kind: string): JobHandler | null {
  return JOB_HANDLERS[kind] ?? null;
}
