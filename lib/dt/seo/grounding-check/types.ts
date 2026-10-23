/**
 * Shapes of the JSON columns of dt_grounding_runs that are not the fact model or the diff.
 */

import type { KeyPageCategory } from "@/lib/dt/seo/grounding-check/crawl";
import type { AiCrawlerAccess } from "@/lib/dt/seo/grounding-check/robots";

/** One row of „Gelesene Seiten“ (crawled_urls). */
export type CrawledUrlEntry =
  | { url: string; category: KeyPageCategory; ok: true; source: "cache" | "live"; title: string | null }
  | { url: string; category: KeyPageCategory; ok: false; reason: string };

/** What the job keeps between its steps (crawl_snapshot). */
export type CrawlSnapshot = {
  organisationName: string;
  websiteUrl: string;
  /** URL of the grounding page: the live one, the planned hub URL, or <origin>/grounding/. */
  pageUrl: string;
  origin: string;
  homeUrl: string;
  pages: Array<{ url: string; category: KeyPageCategory; title: string | null; text: string; jsonLd: string[] }>;
  /** The live grounding page, when one was found. */
  existing: { url: string; html: string; source: "hub" | "footer" | "path_probe" } | null;
  existingLlms: { url: string; text: string } | null;
  /** lastReviewed / uploaded basis of the 3-month rhythm (hub row first, else the live page). */
  schedule: { lastReviewed: string | null; uploadedAt: string | null };
  internal: { anbieter: string; onboarding: string; wunschkunden: string };
};

/** Shown to the reviewer only, never on the page (hints). */
export type GroundingHints = {
  footerLink: { inFooter: boolean; nextToLegal: boolean; label: string | null } | null;
  robots: { found: boolean; crawlers: AiCrawlerAccess[] };
  llmsTxt: { found: boolean; url: string | null };
  crawl: { pages: number; cached: number; live: number; failed: number; sitemapUsed: boolean };
  decisionReasons: string[];
  /** refresh_only: which dates the draft changed. */
  refreshChanges: string[];
  /** Dates and llms.txt URL the draft was rendered with (re-render after fact switches). */
  render: { createdDay: string; modifiedDay: string; llmsUrl: string } | null;
};

export const EMPTY_HINTS: GroundingHints = {
  footerLink: null,
  robots: { found: false, crawlers: [] },
  llmsTxt: { found: false, url: null },
  crawl: { pages: 0, cached: 0, live: 0, failed: 0, sitemapUsed: false },
  decisionReasons: [],
  refreshChanges: [],
  render: null,
};

/** The reviewer's six ticks (review_checklist). */
export type ReviewChecklist = Record<string, boolean>;
