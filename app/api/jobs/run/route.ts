import { NextResponse } from "next/server";

import { runDueJobs } from "@/lib/jobs/runner";

export const dynamic = "force-dynamic";

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

  try {
    const summary = await runDueJobs();
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[jobs/run] unexpected error", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
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
