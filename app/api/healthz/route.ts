import { NextResponse } from "next/server";

export async function GET() {
  const startedAt = Date.now();

  const safeEnv = {
    nodeEnv: process.env.NODE_ENV ?? null,
    vercel: Boolean(process.env.VERCEL),
    hasSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    hasSupabaseKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
  };

  return NextResponse.json({
    ok: true,
    now: new Date().toISOString(),
    ms: Date.now() - startedAt,
    env: safeEnv,
  });
}

