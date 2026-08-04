import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

import { DtPillButton } from "@/components/dt/dt-pill-button";
import { DashboardButton } from "@/components/dashboard-button";
import { UserMenu } from "@/components/user-menu";
import { hasEnvVars } from "@/lib/utils";

export async function AuthButton() {
  if (!hasEnvVars) {
    return (
      <DtPillButton asChild variant="outline" size="sm">
        <Link href="/auth/login">Anmelden</Link>
      </DtPillButton>
    );
  }

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
