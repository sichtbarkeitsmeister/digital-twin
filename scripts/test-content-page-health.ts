/**
 * Texte: „Der Durchlauf wurde unterbrochen“ only when a run really was. The overview and the page
 * window read the page rows first and the jobs afterwards. A run that ends in between (the page
 * is saved as „fertig“, its job marked „succeeded“ a moment later) looked like a running page
 * whose job is gone: the table showed „In Arbeit – Fehler in Schritt 10: Der Durchlauf wurde
 * unterbrochen“ with the cost before the last step, while the page was finished (11.11.).
 * In-memory database; no network.
 * Run: npm run test:content-page-health
 */
import assert from "node:assert/strict";

import { EMPTY_CONTENT_FRESHNESS } from "../lib/dt/content/freshness";
import { CONTENT_JOB_GONE_MESSAGE, reconcileContentPages } from "../lib/dt/content/pipeline/health";
import type { ContentPageRow } from "../lib/dt/content/store";

import { FakeDb } from "./fake-supabase";

const ORG = "11111111-1111-4111-8111-111111111111";
const PAGE_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";

const pageRow = (patch: Partial<ContentPageRow> = {}): ContentPageRow => ({
  id: PAGE_ID, organisation_id: ORG, slug: "luxus-uhren", name: "Luxus-Uhren Ankauf", path: "/uhren", level: 2, position: 0, source: "structure",
  source_url: null, crawled_at: null, main_keyword: null, page_role: "supporting", page_type: "unterseite", pillar_name: null,
  estimated_traffic: null, keywords: null, h1_options: [], user_questions: [], ki_prompt: null, internal_link_targets: [],
  state: "laeuft", step: 10, released: false, released_at: null, title: null, meta_description: null, html: "", markdown: "",
  findings: [], final_findings: [], unresolved: [], questions: [], notes: [], freshness: EMPTY_CONTENT_FRESHNESS, skip_steps: [], client_wishes: "", question_stop: { handled: [] },
  error: null, job_id: JOB_ID, cost_eur: 0.42, started_by: null, created_at: "2026-11-11T15:42:10Z", updated_at: "2026-11-11T15:45:46Z",
  ...patch,
});

async function main() {
  // The run ended between the two reads: the row read still says „laeuft“ (cost 0,42 €), in the
  // database the page is finished (0,58 €) and its job succeeded.
  {
    const stale = pageRow();
    const db = new FakeDb({
      dt_content_pages: [pageRow({ state: "fertig", job_id: null, cost_eur: 0.5772, updated_at: "2026-11-11T15:46:49Z" })],
      dt_content_steps: [{ page_id: PAGE_ID, organisation_id: ORG, step: 10, name: "Endabnahme", status: "waiting", error: null }],
      jobs: [{ id: JOB_ID, status: "succeeded", run_after: "2026-11-11T15:45:22Z", locked_at: null, last_error: null, attempts: 0, max_attempts: 3 }],
    });
    const { pages, verdicts } = await reconcileContentPages(db.service, [stale]);
    assert.deepEqual([pages[0]!.state, pages[0]!.error, Number(pages[0]!.cost_eur)], ["fertig", null, 0.5772], "the page as it is now, without the message");
    assert.equal(verdicts.has(PAGE_ID), false);
    const stored = db.rows("dt_content_pages")[0]!;
    assert.deepEqual([stored.state, stored.error], ["fertig", null], "nothing written");
    assert.equal((db.rows("dt_content_steps")[0] as { status: string }).status, "waiting", "the Endabnahme row is not marked as an error");
    console.log("run ended between the reads: ok");
  }

  // The same at a stop for questions („braucht Sie“).
  {
    const db = new FakeDb({
      dt_content_pages: [pageRow({ state: "braucht_sie", job_id: null, step: 8 })],
      jobs: [{ id: JOB_ID, status: "succeeded", run_after: "2026-11-11T15:45:22Z", locked_at: null, last_error: null, attempts: 0, max_attempts: 3 }],
    });
    const { pages } = await reconcileContentPages(db.service, [pageRow({ step: 8 })]);
    assert.deepEqual([pages[0]!.state, pages[0]!.error], ["braucht_sie", null]);
    console.log("stop for questions between the reads: ok");
  }

  // A run that really ended without finishing the page is still repaired, as before.
  {
    const db = new FakeDb({
      dt_content_pages: [pageRow()],
      dt_content_steps: [{ page_id: PAGE_ID, organisation_id: ORG, step: 10, name: "Endabnahme", status: "running", error: null }],
      jobs: [],
    });
    const { pages } = await reconcileContentPages(db.service, [pageRow()]);
    assert.deepEqual([pages[0]!.state, pages[0]!.error], ["in_arbeit", CONTENT_JOB_GONE_MESSAGE]);
    const stored = db.rows("dt_content_pages")[0]!;
    assert.deepEqual([stored.state, stored.error, stored.job_id], ["in_arbeit", CONTENT_JOB_GONE_MESSAGE, null]);
    assert.deepEqual(
      [(db.rows("dt_content_steps")[0] as { status: string }).status, (db.rows("dt_content_steps")[0] as { error: string }).error],
      ["error", CONTENT_JOB_GONE_MESSAGE],
    );
    console.log("job really gone: ok");
  }

  // A job that died with an error: „Abgebrochen: …“ as before.
  {
    const db = new FakeDb({
      dt_content_pages: [pageRow()],
      jobs: [{ id: JOB_ID, status: "dead", run_after: "2026-11-11T15:45:22Z", locked_at: null, last_error: "Ausgabe abgeschnitten (Token-Limit)", attempts: 1, max_attempts: 3 }],
    });
    const { pages } = await reconcileContentPages(db.service, [pageRow()]);
    assert.equal(pages[0]!.error, "Abgebrochen: Ausgabe abgeschnitten (Token-Limit)");
    console.log("job dead: ok");
  }

  // A running page with a live job is left alone.
  {
    const db = new FakeDb({
      dt_content_pages: [pageRow()],
      jobs: [{ id: JOB_ID, status: "running", run_after: "2026-11-11T15:45:22Z", locked_at: new Date().toISOString(), last_error: null, attempts: 0, max_attempts: 3 }],
    });
    const { pages, verdicts } = await reconcileContentPages(db.service, [pageRow()]);
    assert.deepEqual([pages[0]!.state, verdicts.get(PAGE_ID)?.kind], ["laeuft", "running"]);
    assert.equal(db.log.filter((l) => l.op === "update").length, 0);
    console.log("live job: ok");
  }
  console.log("OK: page health tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
