/**
 * Grounding Pages (Hub + Entitätsseiten): serialize, summary, prompt context, write rules.
 * Run: npx tsx scripts/test-grounding-pages.ts
 */
import assert from "node:assert/strict";

import {
  buildGroundingPageUpdate,
  formatGroundingPagesForPrompt,
  isModifiedAfterReview,
  normalizeGroundingDate,
  patchFromLiveFacts,
  serializeGroundingPage,
  sortGroundingPages,
  summarizeGroundingPages,
} from "../lib/dt/seo/grounding-pages";
import { buildDtSystemPrompt } from "../lib/dt/prompts/build-system-prompt";
import type { DtGroundingPageRow } from "../lib/dt/types";

const NOW = "2026-10-12T12:00:00.000Z";

function row(partial: Partial<DtGroundingPageRow> & { url: string }): DtGroundingPageRow {
  return {
    id: partial.id ?? `id-${partial.url}`,
    organisation_id: "org",
    kind: partial.kind ?? "entity",
    url: partial.url,
    entity_name: partial.entity_name ?? null,
    slug: partial.slug ?? null,
    standard_version: partial.standard_version ?? null,
    review_status: partial.review_status ?? "draft",
    uploaded_at: partial.uploaded_at ?? null,
    date_modified: partial.date_modified ?? null,
    last_reviewed: partial.last_reviewed ?? null,
    reviewed_by: partial.reviewed_by ?? null,
    notes: partial.notes ?? null,
    position: partial.position ?? 0,
    run_state: partial.run_state ?? "nicht_begonnen",
    run_step: partial.run_step ?? null,
    run_error: partial.run_error ?? null,
    job_id: partial.job_id ?? null,
    facts: partial.facts ?? null,
    questions: partial.questions ?? [],
    findings: partial.findings ?? [],
    run_notes: partial.run_notes ?? [],
    html: partial.html ?? null,
    title: partial.title ?? null,
    meta_description: partial.meta_description ?? null,
    entity_type: partial.entity_type ?? null,
    cost_eur: partial.cost_eur ?? 0,
    started_by: partial.started_by ?? null,
    created_at: NOW,
    updated_at: NOW,
  };
}

// --- serialize + schedule basis -------------------------------------------
const hub = row({
  kind: "hub",
  url: "https://www.example.de/unternehmensprofil/",
  uploaded_at: "2026-04-15T12:00:00.000Z",
  date_modified: "2026-10-01T12:00:00.000Z",
  last_reviewed: "2026-09-20T12:00:00.000Z",
  reviewed_by: "Erika Mustermann",
  review_status: "approved",
  standard_version: "1.7",
});
const hubView = serializeGroundingPage(hub, NOW);
assert.equal(hubView.schedule.basis, "last_reviewed");
assert.equal(hubView.schedule.nextDueAt?.slice(0, 10), "2026-12-20");
assert.equal(hubView.schedule.status, "ok");
assert.equal(hubView.modifiedAfterReview, true);
assert.equal(isModifiedAfterReview({ date_modified: "2026-09-20", last_reviewed: "2026-09-20" }), false);

const draft = row({
  url: "https://www.example.de/grounding/veneers/",
  entity_name: "Veneers",
  uploaded_at: "2026-04-15T12:00:00.000Z",
});
const draftView = serializeGroundingPage(draft, NOW);
assert.equal(draftView.schedule.basis, "uploaded_at");
assert.equal(draftView.schedule.status, "overdue");

// --- sort + summary ---------------------------------------------------------
const sorted = sortGroundingPages([draftView, hubView]);
assert.equal(sorted[0]!.kind, "hub");

const summary = summarizeGroundingPages([hubView, draftView]);
assert.equal(summary.status, "overdue");
assert.equal(summary.total, 2);
assert.equal(summary.hubs, 1);
assert.equal(summary.entities, 1);
assert.equal(summary.drafts, 1);
assert.equal(summary.modifiedAfterReview, 1);
assert.equal(summarizeGroundingPages([]).status, "missing");

// --- prompt context ---------------------------------------------------------
const text = formatGroundingPagesForPrompt({
  pages: [hubView, draftView],
  llmsTxtUrl: "https://www.example.de/llms.txt",
});
assert.ok(text.startsWith("## Grounding Pages (Tool-Kontext)"));
assert.ok(text.includes("Grounding-URL des Hubs: https://www.example.de/unternehmensprofil/"));
assert.ok(text.includes("Entitätsseiten: https://www.example.de/grounding/veneers/"));
assert.ok(text.includes("llms.txt-URL: https://www.example.de/llms.txt"));
assert.ok(text.includes("lastReviewed 2026-09-20"));
assert.ok(text.includes("Prüfer Erika Mustermann"));
assert.ok(text.includes("Befund: Seite nach der letzten Prüfung geändert"));
assert.ok(text.includes("Entitätsseite „Veneers“"));
assert.ok(text.includes("Status überfällig"));
assert.ok(text.includes("schlage „aktualisiere“ vor"));
assert.ok(text.includes("update_grounding_page"));

const empty = formatGroundingPagesForPrompt({ pages: [] });
assert.ok(empty.includes("noch keine Grounding Page"));

// Prompt builder: SEO mode + geo_advisor get the block, prospects never.
const baseAgent = { name: "SEO", role: null, prompt_template: "Du bist SEO." };
const seoPrompt = buildDtSystemPrompt({
  agent: { ...baseAgent, kind: "seo_advisor" },
  org: { display_name: "Example" },
  mode: "seo",
  groundingPagesText: text,
});
assert.ok(seoPrompt.includes("## Grounding Pages (Tool-Kontext)"));
const geoPrompt = buildDtSystemPrompt({
  agent: { ...baseAgent, kind: "geo_advisor" },
  org: { display_name: "Example" },
  mode: "default",
  groundingPagesText: text,
});
assert.ok(geoPrompt.includes("## Grounding Pages (Tool-Kontext)"));
const defaultPrompt = buildDtSystemPrompt({
  agent: { ...baseAgent, kind: "staff" },
  org: { display_name: "Example" },
  mode: "default",
  groundingPagesText: text,
});
assert.ok(!defaultPrompt.includes("## Grounding Pages (Tool-Kontext)"));

// --- write rules (Standard v1.7) -------------------------------------------
assert.equal(normalizeGroundingDate("2026-10-12")?.slice(0, 10), "2026-10-12");
assert.equal(normalizeGroundingDate(""), null);
assert.equal(normalizeGroundingDate("gestern"), undefined);

const approve = buildGroundingPageUpdate(
  { reviewedBy: "Erika Mustermann", lastReviewed: "2026-10-10" },
  draft,
  new Date(NOW),
);
assert.ok(approve.ok);
assert.equal(approve.ok && approve.update.review_status, "approved");
assert.equal(approve.ok && approve.update.standard_version, "1.7");

const future = buildGroundingPageUpdate(
  { reviewedBy: "Erika Mustermann", lastReviewed: "2026-10-20" },
  draft,
  new Date(NOW),
);
assert.equal(future.ok, false);

const noReviewer = buildGroundingPageUpdate({ lastReviewed: "2026-10-10" }, draft, new Date(NOW));
assert.ok(noReviewer.ok);
assert.equal(noReviewer.ok && noReviewer.update.review_status, undefined);

const forceApprove = buildGroundingPageUpdate(
  { reviewStatus: "approved" },
  draft,
  new Date(NOW),
);
assert.equal(forceApprove.ok, false);

const reset = buildGroundingPageUpdate({ lastReviewed: null }, hub, new Date(NOW));
assert.ok(reset.ok);
assert.equal(reset.ok && reset.update.review_status, "draft");

const keepsVersion = buildGroundingPageUpdate(
  { reviewedBy: "Redaktion", lastReviewed: "2026-10-01", standardVersion: "v1.8" },
  draft,
  new Date(NOW),
);
assert.ok(keepsVersion.ok);
assert.equal(keepsVersion.ok && keepsVersion.update.standard_version, "1.8");

const badUrl = buildGroundingPageUpdate({ url: "ftp://nope" }, null, new Date(NOW));
assert.equal(badUrl.ok, false);

// The homepage is never a grounding page (soft-404 redirects used to land here).
const rootUrl = buildGroundingPageUpdate({ url: "https://existenzstand.de/" }, null, new Date(NOW));
assert.equal(rootUrl.ok, false);
assert.ok(!rootUrl.ok && rootUrl.message.includes("Startseite"));
const pathUrl = buildGroundingPageUpdate(
  { url: "https://existenzstand.de/grounding/" },
  null,
  new Date(NOW),
);
assert.ok(pathUrl.ok);

// --- Grounding-Modus (chat switch) ------------------------------------------
const groundingPrompt = buildDtSystemPrompt({
  agent: { ...baseAgent, kind: "seo_advisor" },
  org: { display_name: "Example" },
  mode: "seo",
  groundingPagesText: text,
  groundingMode: true,
});
assert.ok(groundingPrompt.includes("## Grounding-Modus (hat Vorrang)"));
assert.ok(groundingPrompt.includes("update_grounding_page"));
assert.ok(groundingPrompt.includes("Fakten geprüft von [Prüfer]"));
assert.ok(!seoPrompt.includes("## Grounding-Modus"));

// --- live facts → patch -----------------------------------------------------
const livePatch = patchFromLiveFacts(
  draft,
  {
    finalUrl: draft.url,
    detectedAt: "2026-10-02T12:00:00.000Z",
    sourceLabel: "JSON-LD lastReviewed",
    facts: {
      lastReviewed: "2026-10-02T12:00:00.000Z",
      reviewedBy: "Erika Mustermann",
      dateModified: "2026-10-01T12:00:00.000Z",
      standardVersion: "1.7",
      reviewMismatch: false,
    },
  },
  "2026-10-12",
);
assert.equal(livePatch.uploadedAt, undefined); // existing upload date is never moved
assert.equal(livePatch.lastReviewed, "2026-10-02T12:00:00.000Z");
assert.equal(livePatch.reviewedBy, "Erika Mustermann");
assert.equal(livePatch.notes, "Auto: JSON-LD lastReviewed (2026-10-12)");

const firstPatch = patchFromLiveFacts(null, {
  detectedAt: "2026-10-02T12:00:00.000Z",
  sourceLabel: "HTTP Last-Modified",
  facts: { lastReviewed: null, reviewedBy: null, dateModified: null, standardVersion: null, reviewMismatch: true },
});
assert.equal(firstPatch.uploadedAt, "2026-10-02T12:00:00.000Z");
assert.ok(firstPatch.notes?.includes("Befund"));

console.log("grounding-pages tests: ok");
