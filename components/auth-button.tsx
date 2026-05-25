import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Suspense } from "react";

import { DtPillButton } from "@/components/dt/dt-pill-button";
import { DashboardButton } from "@/components/dashboard-button";
import { UserMenu } from "@/components/user-menu";

export async function AuthButton() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user ? (
    <div className="flex items-center gap-2">
      <DashboardButton />
      <UserMenu />
    </div>
  ) : (
    <DtPillButton asChild variant="outline" size="sm">
      <Link href="/auth/login">Anmelden</Link>
    </DtPillButton>
  );
}
