import { updateSession } from "@/lib/supabase/proxy";
import { type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next (Next.js internals: static files, image optimization, HMR, etc.)
     * - favicon.ico (favicon file)
     * Note: We do NOT exclude __nextjs* here. Next's dev overlay endpoints may rely on
     * the proxy layer being present; we allow them through in `lib/supabase/proxy.ts`.
     * - images - .svg, .png, .jpg, .jpeg, .gif, .webp
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
