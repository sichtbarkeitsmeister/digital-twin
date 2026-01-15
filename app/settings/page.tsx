import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Suspense } from "react";

async function SettingsContent() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  const user = data?.claims;
  if (!user) {
    redirect("/auth/login");
  }

  const email = user.email ?? "";
  const userId = (user as { sub?: string }).sub ?? "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="email">E-Mail</Label>
          <Input id="email" value={email} disabled readOnly />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="userId">User-ID</Label>
          <Input id="userId" value={userId} disabled readOnly />
        </div>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 py-10">
      <div className="grid gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-secondary">Aktuell sind die Einstellungen nur lesbar.</p>
      </div>

      <Suspense
        fallback={
          <Card>
            <CardHeader>
              <CardTitle>Account</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-secondary">Lade…</CardContent>
          </Card>
        }
      >
        <SettingsContent />
      </Suspense>
    </div>
  );
}

