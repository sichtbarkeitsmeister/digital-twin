import * as React from "react";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

import { DashboardShell } from "@/app/dashboard/_components/dashboard-shell";
import { userCanManageAnyIntegrations } from "@/lib/dashboard/org-context";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center p-6 text-sm text-sbkm-ink-600">
          Lade…
        </div>
      }
    >
      <DashboardLayoutContent>{children}</DashboardLayoutContent>
    </React.Suspense>
  );
}

async function DashboardLayoutContent({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/auth/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  const isPlatformAdmin = profile?.role === "admin";
  const canManageIntegrations = isPlatformAdmin
    ? true
    : await userCanManageAnyIntegrations(user.id);
  const pendingSurveyQuestionsCount = isPlatformAdmin
    ? (
        await supabase
          .from("survey_field_questions")
          .select("id", { count: "exact", head: true })
          .is("answer", null)
      ).count ?? 0
    : 0;

  return (
    <DashboardShell
      isPlatformAdmin={isPlatformAdmin}
      canManageIntegrations={canManageIntegrations}
      pendingSurveyQuestionsCount={pendingSurveyQuestionsCount}
    >
      {children}
    </DashboardShell>
  );
}
