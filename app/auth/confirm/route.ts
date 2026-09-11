import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

import { asEmailOtpType, sanitizeNextPath } from "@/lib/auth/login-link";
import { createClient } from "@/lib/supabase/server";

function errorRedirect(message: string) {
  redirect(`/auth/error?error=${encodeURIComponent(message)}`);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const typeParam = searchParams.get("type");
  const code = searchParams.get("code");
  const next = sanitizeNextPath(searchParams.get("next"), "/dashboard");

  const supabase = await createClient();

  if (token_hash && typeParam) {
    const type = asEmailOtpType(typeParam);
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    });
    if (!error) {
      redirect(next);
    }
    errorRedirect(error.message);
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      redirect(next);
    }
    errorRedirect(error.message);
  }

  errorRedirect("No token hash or type");
}
