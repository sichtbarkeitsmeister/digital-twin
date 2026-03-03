import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function withTimeout<T>(promise: PromiseLike<T>, ms: number) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
  });

  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  }) as Promise<T>;
}

export async function GET() {
  const startedAt = Date.now();

  // IMPORTANT: This route intentionally avoids returning secrets.
  // Use it to check if the app can reach Supabase from production.
  const response: Record<string, unknown> = {
    ok: true,
    now: new Date().toISOString(),
    env: {
      nodeEnv: process.env.NODE_ENV ?? null,
      hasSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      hasSupabaseKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    },
    timings: {},
  };

  try {
    const t0 = Date.now();
    const supabase = await createClient();
    (response.timings as Record<string, number>).createClientMs = Date.now() - t0;

    const t1 = Date.now();
    const res = await withTimeout(
      supabase.from("profiles").select("id", { count: "exact", head: true }).limit(1) as PromiseLike<unknown>,
      5000,
    );
    const error = (res as { error?: { message: string } | null } | null)?.error ?? null;
    (response.timings as Record<string, number>).supabaseQueryMs = Date.now() - t1;
    response.supabaseOk = !error;
    response.supabaseError = error ? { message: error.message, code: (error as any).code ?? null } : null;
  } catch (e) {
    response.ok = false;
    response.error = { message: e instanceof Error ? e.message : String(e) };
  }

  response.ms = Date.now() - startedAt;
  return NextResponse.json(response, { status: response.ok ? 200 : 500 });
}

