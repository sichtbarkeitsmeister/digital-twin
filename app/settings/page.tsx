import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { SurveyAiSettingsCard } from "@/app/settings/survey-ai-settings-card";
import { DtField, DtGlassCard, DtHeading, DtInput, DtInputWrap } from "@/components/dt";
import { Label } from "@/components/ui/label";

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
    <DtGlassCard padding="sm">
      <DtHeading as="h2" variant="h4">
        Account
      </DtHeading>
      <div className="mt-5 grid gap-4">
        <DtField label="E-Mail" htmlFor="email">
          <DtInputWrap>
            <DtInput id="email" value={email} disabled readOnly />
          </DtInputWrap>
        </DtField>
        <DtField label="User-ID" htmlFor="userId">
          <DtInputWrap>
            <DtInput id="userId" value={userId} disabled readOnly />
          </DtInputWrap>
        </DtField>
      </div>
    </DtGlassCard>
  );
}

export default function SettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 py-10 sm:px-8">
      <DtHeading as="h1" variant="h2">
        Einstellungen
      </DtHeading>

      <Suspense
        fallback={
          <DtGlassCard padding="sm">
            <Label>Account</Label>
            <p className="mt-4 text-sm text-sbkm-ink-600">Lade…</p>
          </DtGlassCard>
        }
      >
        <SettingsContent />
      </Suspense>
      <SurveyAiSettingsCard />
    </div>
  );
}
