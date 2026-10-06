import { notFound, redirect } from "next/navigation";

import { OrganisationPageShell } from "@/app/dashboard/_components/organisations/organisation-page-shell";
import { DtContentWorkspace } from "@/components/dt/content/dt-content-workspace";
import { OrgDetailTabs } from "@/components/dt/content/org-detail-tabs";
import {
  loadContentAvatarOptions,
  loadContentWorkshopAnbieter,
} from "@/lib/dt/content/load-sources";
import { suggestTextSettings } from "@/lib/dt/content/mapping";
import { loadContentSettings, settingsFromRow } from "@/lib/dt/content/store";
import { canAccessDtSeo } from "@/lib/dt/seo/access";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

const headerCardClass =
  "relative overflow-hidden rounded-2xl border border-sbkm-navy/10 bg-white/55 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)] backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.05]";

export default async function OrganisationTextePage({
  params,
}: {
  params: Promise<{ organisationId: string }>;
}) {
  const { organisationId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user?.id) redirect("/auth/login");

  if (!(await canAccessDtSeo(supabase, user.id, organisationId))) {
    redirect(`/dashboard/organisations?org=${encodeURIComponent(organisationId)}`);
  }

  const [{ data: organisation }, { data: config }, avatars, sections, settingsRow] = await Promise.all([
    supabase
      .from("organisations")
      .select("id, name, archived_at")
      .eq("id", organisationId)
      .maybeSingle(),
    supabase
      .from("dt_org_config")
      .select("display_name")
      .eq("organisation_id", organisationId)
      .maybeSingle(),
    loadContentAvatarOptions(supabase, organisationId),
    loadContentWorkshopAnbieter(supabase, organisationId).catch(() => []),
    loadContentSettings(supabase, organisationId).catch(() => null),
  ]);

  if (!organisation || organisation.archived_at) notFound();

  const title = (config?.display_name as string | undefined)?.trim() || organisation.name;

  return (
    <OrganisationPageShell>
      <div className="grid gap-5">
        <div className={cn(headerCardClass, "grid gap-4 p-4 sm:p-5")}>
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent dark:via-white/10" />
          <div className="grid gap-1">
            <h1 className="text-xl font-bold tracking-tight text-primary sm:text-2xl">{title}</h1>
            <p className="text-xs text-secondary sm:text-sm">
              Seitentexte in acht Schritten schreiben lassen, prüfen und freigeben.
            </p>
          </div>
          <OrgDetailTabs organisationId={organisationId} active="texte" />
        </div>

        <DtContentWorkspace
          key={organisationId}
          organisationId={organisationId}
          avatars={avatars}
          suggestion={suggestTextSettings(sections)}
          initialSettings={settingsRow ? settingsFromRow(settingsRow) : null}
          initialAvatarId={settingsRow?.avatar_agent_id ?? null}
        />
      </div>
    </OrganisationPageShell>
  );
}
