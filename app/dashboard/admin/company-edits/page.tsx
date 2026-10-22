import { redirect } from "next/navigation";

import { DtCompanyProfileEditsAdmin } from "@/components/dt/company-profile/dt-company-profile-edits-admin";
import { createClient } from "@/lib/supabase/server";

export default async function AdminCompanyEditsPage() {
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

  return <DtCompanyProfileEditsAdmin />;
}
