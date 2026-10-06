import { after, NextResponse } from "next/server";

import { runDueJobs } from "@/lib/jobs/runner";

export const maxDuration = 300;

function isAuthorised(req: Request) {
  const expected = process.env.JOBS_WORKER_TOKEN?.trim();
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length).trim();
  return token === expected;
}

export async function POST(req: Request) {
  if (!isAuthorised(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  // The cron client stops waiting after 120s and drops the connection. Awaiting the
  // step here killed the worker in the middle of a page, after Gliederung was saved
  // and before Rohtext was started. Answering first lets the step use maxDuration.
  const run = () =>
    runDueJobs().catch((error) => {
      console.error("[jobs/run] unexpected error", error);
    });

  try {
    after(run);
    return NextResponse.json({ ok: true, accepted: true });
  } catch (error) {
    console.error("[jobs/run] after() unavailable, running inline", error);
    try {
      const summary = await runDueJobs();
      return NextResponse.json({ ok: true, summary });
    } catch (inlineError) {
      const message = inlineError instanceof Error ? inlineError.message : String(inlineError);
      console.error("[jobs/run] unexpected error", inlineError);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }
}

// Allow GET for health checks (also requires token).
export async function GET(req: Request) {
  if (!isAuthorised(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  return NextResponse.json({ ok: true, status: "ready" });
}
