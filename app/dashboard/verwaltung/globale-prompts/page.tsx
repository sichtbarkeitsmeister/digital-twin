import { redirect } from "next/navigation";

import { DtGlobalPromptsPage } from "@/components/dt/agents/dt-global-prompts-page";
import { isPlatformAdmin } from "@/lib/dt/org-access";
import { createClient } from "@/lib/supabase/server";

export default async function GlobalePromptsRoute() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");
  if (!(await isPlatformAdmin(supabase, user.id))) redirect("/dashboard");

  return <DtGlobalPromptsPage />;
}
