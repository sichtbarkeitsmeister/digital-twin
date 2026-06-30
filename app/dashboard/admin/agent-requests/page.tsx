import { redirect } from "next/navigation";

import { DtAgentEditRequestsAdmin } from "@/components/dt/agents/dt-agent-edit-requests-admin";
import { createClient } from "@/lib/supabase/server";

export default async function AdminAgentRequestsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "admin") {
    redirect("/dashboard");
  }

  return <DtAgentEditRequestsAdmin />;
}
