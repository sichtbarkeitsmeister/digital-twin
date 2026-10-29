/**
 * Texte: a page belongs to one job. „Stoppen“ ends the job in the database, but its worker stays
 * inside the call in flight; when the page is started again meanwhile, a new job owns it. The old
 * worker must neither save its answer, nor go on, nor point the page back at itself (29.10.: it
 * did all three, and the overview then paused the new run as „Abgebrochen: Vom Benutzer
 * gestoppt.“). In-memory database and fetch; no network, no model.
 * Run: npm run test:content-job-ownership
 */
import assert from "node:assert/strict";

import { EMPTY_CONTENT_FRESHNESS } from "../lib/dt/content/freshness";
import {
  markContentStepError,
  markContentStepRetry,
  pageStillOurs,
  skipContentStep,
  type StepOutcome,
} from "../lib/dt/content/pipeline/run-step";
import { CONTENT_STEP_SEO, contentStepDefinition } from "../lib/dt/content/pipeline/steps";
import type { ContentPageRow, ContentStepRow } from "../lib/dt/content/store";
import { contentPageOwnership, runContentPageSteps } from "../lib/jobs/handlers/content-page";

import { FakeDb, type FakeRow } from "./fake-supabase";

const ORG = "11111111-1111-4111-8111-111111111111";
const PAGE_ID = "22222222-2222-4222-8222-222222222222";
const JOB_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const JOB_OLD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LIVE_URL = "https://allround-hecktraeger.de/blog-aktuelles";

const pageRow = (patch: Partial<ContentPageRow> = {}): ContentPageRow => ({
  id: PAGE_ID, organisation_id: ORG, slug: "blog-aktuelles", name: "Blog Aktuelles", path: "/blog-aktuelles", level: 1, position: 0,
  source: "crawl", source_url: LIVE_URL, crawled_at: "2026-10-20T10:00:00Z", main_keyword: null, page_role: null, page_type: "ratgeber",
  pillar_name: null, estimated_traffic: null, keywords: null, h1_options: [], user_questions: [], ki_prompt: null, internal_link_targets: [],
  state: "laeuft", step: null, released: false, released_at: null, title: null, meta_description: null, html: "", markdown: "",
  findings: [], final_findings: [], unresolved: [], questions: [], notes: [], freshness: EMPTY_CONTENT_FRESHNESS, skip_steps: [],
  error: null, job_id: JOB_A, cost_eur: 0, started_by: null, created_at: "2026-10-29T08:16:55Z", updated_at: "2026-10-29T08:16:55Z",
  ...patch,
});

const job = (id: string, status: string): FakeRow => ({ id, kind: "content.page", status, last_error: status === "dead" ? "Vom Benutzer gestoppt." : null });
const analyseDone: FakeRow = { page_id: PAGE_ID, organisation_id: ORG, step: 1, name: "Analyse", status: "done", output: { main_keyword: "x" }, cost_eur: 0.1 };

class ContentDb extends FakeDb {
  page(): FakeRow {
    return this.rows("dt_content_pages").find((p) => p.id === PAGE_ID)!;
  }
  /** Writes to the page and its steps, the things the old worker must not touch. */
  pageWrites(): string[] {
    return this.log
      .filter((l) => (l.table === "dt_content_pages" || l.table === "dt_content_steps") && l.op !== "select")
      .map((l) => `${l.table} ${l.op} ${JSON.stringify(l.payload)}`);
  }
}

/** Records every step a worker would hand to the model. */
function recordingRunner(calls: number[]) {
  return async (_service: unknown, _page: ContentPageRow, _steps: readonly ContentStepRow[], step: number): Promise<StepOutcome> => {
    calls.push(step);
    return { step, halted: true, model: "claude-stub", costEur: 0 };
  };
}

async function ownershipRule() {
  const db = (jobs: FakeRow[]) => new ContentDb({ jobs }).service;
  assert.equal(await contentPageOwnership(db([job(JOB_A, "running")]), JOB_A, null), "adopt", "a page without a job is adopted");
  assert.equal(await contentPageOwnership(db([job(JOB_A, "running"), job(JOB_OLD, "succeeded")]), JOB_A, JOB_OLD), "adopt", "a page whose job finished is adopted");
  assert.equal(await contentPageOwnership(db([job(JOB_A, "running"), job(JOB_OLD, "dead")]), JOB_A, JOB_OLD), "adopt", "so is one whose job was stopped");
  assert.equal(await contentPageOwnership(db([job(JOB_A, "running")]), JOB_A, JOB_OLD), "adopt", "or whose job is gone");
  assert.equal(await contentPageOwnership(db([job(JOB_A, "dead"), job(JOB_B, "running")]), JOB_A, JOB_B), "job_ended", "a stopped job keeps its hands off");
  assert.equal(await contentPageOwnership(db([job(JOB_A, "dead")]), JOB_A, null), "job_ended");
  assert.equal(await contentPageOwnership(db([job(JOB_A, "running"), job(JOB_B, "pending")]), JOB_A, JOB_B), "other_job", "a queued new job owns the page");
  assert.equal(await contentPageOwnership(db([job(JOB_A, "running"), job(JOB_B, "running")]), JOB_A, JOB_B), "other_job");
  assert.equal(await contentPageOwnership(db([]), JOB_A, null), "job_ended", "a job that does not exist runs nothing");

  const live = (page: Partial<ContentPageRow>) => new ContentDb({ dt_content_pages: [pageRow(page)] }).service;
  assert.equal(await pageStillOurs(live({ job_id: JOB_A }), { id: PAGE_ID, job_id: JOB_A }), true);
  assert.equal(await pageStillOurs(live({ job_id: JOB_B }), { id: PAGE_ID, job_id: JOB_A }), false, "started again: the new job's page");
  assert.equal(await pageStillOurs(live({ job_id: null, state: "in_arbeit" }), { id: PAGE_ID, job_id: JOB_A }), false, "stopped");
  assert.equal(await pageStillOurs(live({ job_id: JOB_B }), { id: PAGE_ID, job_id: null }), true, "no job known to the caller: the state decides, as before");
  assert.equal(await pageStillOurs(new ContentDb().service, { id: PAGE_ID, job_id: JOB_A }), false, "deleted");
  console.log("ownership rule: ok");
}

async function stepLoop() {
  {
    // 29.10., 08:26:57: job A was stopped, job B runs the page. A's worker comes back for its next step.
    const db = new ContentDb({
      jobs: [job(JOB_A, "dead"), job(JOB_B, "running")],
      dt_content_pages: [pageRow({ job_id: JOB_B, step: 1 })],
      dt_content_steps: [analyseDone],
    });
    const calls: number[] = [];
    const result = await runContentPageSteps({ service: db.service, job: { id: JOB_A, attempts: 0, max_attempts: 3 }, pageId: PAGE_ID, runners: { runStep: recordingRunner(calls) } });
    assert.deepEqual(result, { ok: true, result: { skipped: "job_ended" } });
    assert.deepEqual(calls, [], "no SEO call for a stopped job");
    assert.deepEqual(db.pageWrites(), [], "the page and its steps are not touched");
    assert.deepEqual([db.page().job_id, db.page().state, db.page().error], [JOB_B, "laeuft", null], "job B keeps the page; nothing for the overview to repair");
  }
  {
    // Two live jobs for one page (should not happen, the dedupe index prevents it): the page's own job runs it.
    const db = new ContentDb({ jobs: [job(JOB_A, "running"), job(JOB_B, "pending")], dt_content_pages: [pageRow({ job_id: JOB_B })] });
    const calls: number[] = [];
    const result = await runContentPageSteps({ service: db.service, job: { id: JOB_A, attempts: 0, max_attempts: 3 }, pageId: PAGE_ID, runners: { runStep: recordingRunner(calls) } });
    assert.deepEqual([result, calls, db.pageWrites()], [{ ok: true, result: { skipped: "other_job" } }, [], []]);
  }
  {
    // Job B, the page's own job, runs as before.
    const db = new ContentDb({ jobs: [job(JOB_A, "dead"), job(JOB_B, "running")], dt_content_pages: [pageRow({ job_id: JOB_B, step: 1 })], dt_content_steps: [analyseDone] });
    const calls: number[] = [];
    await runContentPageSteps({ service: db.service, job: { id: JOB_B, attempts: 0, max_attempts: 3 }, pageId: PAGE_ID, runners: { runStep: recordingRunner(calls) } });
    assert.deepEqual(calls, [CONTENT_STEP_SEO], "the new job goes on with SEO");
  }
  {
    // A page that points at a finished job is still adopted (the case the adoption is for).
    const db = new ContentDb({ jobs: [job(JOB_A, "running"), job(JOB_OLD, "succeeded")], dt_content_pages: [pageRow({ job_id: JOB_OLD })] });
    const calls: number[] = [];
    await runContentPageSteps({ service: db.service, job: { id: JOB_A, attempts: 0, max_attempts: 3 }, pageId: PAGE_ID, runners: { runStep: recordingRunner(calls) } });
    assert.equal(db.page().job_id, JOB_A, "adopted");
    assert.deepEqual(calls, [1], "and run");
  }
  {
    // Every step done: only the page's own job marks it „fertig“.
    const done = Array.from({ length: 10 }, (_, i) => ({ page_id: PAGE_ID, step: i + 1, name: contentStepDefinition(i + 1)!.name, status: "done" }));
    const db = new ContentDb({ jobs: [job(JOB_A, "running")], dt_content_pages: [pageRow({ job_id: JOB_A })], dt_content_steps: done });
    const result = await runContentPageSteps({ service: db.service, job: { id: JOB_A, attempts: 0, max_attempts: 3 }, pageId: PAGE_ID });
    assert.deepEqual([result, db.page().state, db.page().job_id], [{ ok: true, result: { finished: true } }, "fertig", null]);
  }
  console.log("step loop: ok");
}

async function callInFlight() {
  {
    // The incident with a real call in flight: SEO switched off, so job A fetches the live page.
    // While the fetch runs, „Stoppen“ ends job A and „Weiterlaufen lassen“ starts job B.
    const db = new ContentDb({
      jobs: [job(JOB_A, "running")],
      dt_content_pages: [pageRow({ job_id: JOB_A, step: 1, skip_steps: ["seo"] })],
      dt_content_steps: [analyseDone],
      dt_site_pages: [{ organisation_id: ORG, url: LIVE_URL, title: "Blog", h1: "Blog Aktuelles", text_content: "Blog Aktuelles\nNeuigkeiten.", is_excluded: false }],
    });
    const stopAndRestartDuringFetch = async () => {
      Object.assign(db.rows("jobs")[0]!, { status: "dead", last_error: "Vom Benutzer gestoppt." });
      Object.assign(db.page(), { state: "in_arbeit", job_id: null });
      db.rows("jobs").push(job(JOB_B, "pending"));
      Object.assign(db.page(), { state: "laeuft", job_id: JOB_B });
      db.log = [];
      return new Response("<html><body><main><h1>Blog Aktuelles</h1><p>Neuigkeiten.</p></main></body></html>", { status: 200, headers: { "content-type": "text/html" } });
    };
    const result = await runContentPageSteps({
      service: db.service,
      job: { id: JOB_A, attempts: 0, max_attempts: 3 },
      pageId: PAGE_ID,
      runners: { skipStep: (service, page, steps, step) => skipContentStep(service, page, steps, step, { fetchImpl: stopAndRestartDuringFetch as never }) },
    });
    assert.ok(result.ok && result.result?.discarded === true, "job A drops what it fetched");
    assert.deepEqual(db.pageWrites(), [], "no step row, no text, no job id written by job A");
    assert.deepEqual([db.page().job_id, db.page().state, db.page().html], [JOB_B, "laeuft", ""], "job B's run is intact");
  }
  {
    // A failure of job A's step after the restart must not pause job B's run.
    const db = new ContentDb({ dt_content_pages: [pageRow({ job_id: JOB_B, step: 2 })], dt_content_steps: [analyseDone] });
    await markContentStepError(db.service, pageRow({ job_id: JOB_A }), CONTENT_STEP_SEO, "Überlastet");
    await markContentStepRetry(db.service, pageRow({ job_id: JOB_A }), CONTENT_STEP_SEO, "Überlastet");
    assert.deepEqual(db.pageWrites(), [], "no error and no retry note on the new run");
    assert.deepEqual([db.page().state, db.page().error, db.page().job_id], ["laeuft", null, JOB_B]);
  }
  {
    // On its own page a failure pauses the page with the error, as before.
    const db = new ContentDb({ dt_content_pages: [pageRow({ job_id: JOB_A, step: 2 })], dt_content_steps: [analyseDone] });
    await markContentStepError(db.service, pageRow({ job_id: JOB_A }), CONTENT_STEP_SEO, "Überlastet");
    assert.deepEqual([db.page().state, db.page().error, db.page().job_id], ["in_arbeit", "Überlastet", null]);
    assert.equal(db.rows("dt_content_steps").find((s) => s.step === CONTENT_STEP_SEO)?.status, "error");
  }
  console.log("call in flight: ok");
}

ownershipRule()
  .then(stepLoop)
  .then(callInFlight)
  .then(() => console.log("OK: job ownership tests passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
