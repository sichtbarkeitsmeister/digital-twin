import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { SurveyBuilder } from "@/app/dashboard/_components/surveys/survey-builder";

export default async function NewSurveyPage() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  const userId = user?.id;
  if (authError || !userId) {
    redirect("/auth/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  const isPlatformAdmin = profile?.role === "admin";
  if (!isPlatformAdmin) {
    redirect("/dashboard/inbox");
  }

  return (
    <div className="flex flex-col gap-6">
      <SurveyBuilder />
    </div>
  );
}

