import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { DtSettingsCard } from "@/app/settings/dt-settings-card";
import { SurveyAiSettingsCard } from "@/app/settings/survey-ai-settings-card";
import { DtField, DtGlassCard, DtHeading, DtInput, DtInputWrap } from "@/components/dt";
import { Label } from "@/components/ui/label";
import { isPlatformAdmin } from "@/lib/dt/org-access";

async function SettingsContent(props: { isPlatformAdmin: boolean }) {
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
        {props.isPlatformAdmin ? (
          <DtField label="User-ID" htmlFor="userId">
            <DtInputWrap>
              <DtInput id="userId" value={userId} disabled readOnly />
            </DtInputWrap>
          </DtField>
        ) : null}
      </div>
    </DtGlassCard>
  );
}

async function SettingsPageBody() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const platformAdmin = await isPlatformAdmin(supabase, user.id);

  return (
    <>
      <Suspense
        fallback={
          <DtGlassCard padding="sm">
            <Label>Account</Label>
            <p className="mt-4 text-sm text-sbkm-ink-600">Lade…</p>
          </DtGlassCard>
        }
      >
        <SettingsContent isPlatformAdmin={platformAdmin} />
      </Suspense>
      <DtSettingsCard showInternalSettings={platformAdmin} />
      {platformAdmin ? <SurveyAiSettingsCard /> : null}
    </>
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
        <SettingsPageBody />
      </Suspense>
    </div>
  );
}
