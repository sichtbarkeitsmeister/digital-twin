import { createServerClient } from "@supabase/ssr";
import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { otpTypesToTry, sanitizeNextPath } from "@/lib/auth/login-link";

type CookieToSet = {
  name: string;
  value: string;
  options?: Parameters<NextResponse["cookies"]["set"]>[2];
};

function applyCookies(response: NextResponse, cookiesToSet: CookieToSet[]) {
  for (const { name, value, options } of cookiesToSet) {
    response.cookies.set(name, value, options);
  }
  return response;
}

export async function GET(request: NextRequest) {
  const token_hash = request.nextUrl.searchParams.get("token_hash");
  const typeParam = request.nextUrl.searchParams.get("type");
  const code = request.nextUrl.searchParams.get("code");
  const next = sanitizeNextPath(request.nextUrl.searchParams.get("next"), "/dashboard");

  const successUrl = request.nextUrl.clone();
  successUrl.pathname = next;
  successUrl.search = "";

  const errorUrl = request.nextUrl.clone();
  errorUrl.pathname = "/auth/error";
  errorUrl.search = "";

  const fail = (message: string, cookiesToSet: CookieToSet[] = []) => {
    errorUrl.searchParams.set("error", message);
    return applyCookies(NextResponse.redirect(errorUrl), cookiesToSet);
  };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return fail("No token hash or type");
  }

  let cookiesToSet: CookieToSet[] = [];
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(incoming) {
        cookiesToSet = incoming;
      },
    },
  });

  if (token_hash) {
    let lastError = "Token has expired or is invalid";
    for (const type of otpTypesToTry(typeParam) as EmailOtpType[]) {
      cookiesToSet = [];
      const { error } = await supabase.auth.verifyOtp({ type, token_hash });
      if (!error) {
        return applyCookies(NextResponse.redirect(successUrl), cookiesToSet);
      }
      lastError = error.message;
    }
    return fail(lastError, cookiesToSet);
  }

  if (code) {
    cookiesToSet = [];
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return applyCookies(NextResponse.redirect(successUrl), cookiesToSet);
    }
    return fail(error.message, cookiesToSet);
  }

  return fail("No token hash or type");
}
