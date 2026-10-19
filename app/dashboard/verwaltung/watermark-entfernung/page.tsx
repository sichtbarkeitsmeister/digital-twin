import { redirect } from "next/navigation";

import { OrganisationPageShell } from "@/app/dashboard/_components/organisations/organisation-page-shell";
import { DtWatermarkTool } from "@/components/dt/text-tools/dt-watermark-tool";
import { XAI_MISSING_KEY_MESSAGE, resolveXaiApiKey } from "@/lib/dt/content/pipeline/xai";
import { isPlatformAdmin } from "@/lib/dt/org-access";
import { createClient } from "@/lib/supabase/server";

/**
 * Standalone tool: no organisation, no Texte settings. Platform admins only, like the rest
 * of Verwaltung, because every run costs Grok calls.
 */
export default async function VerwaltungWatermarkPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  if (!(await isPlatformAdmin(supabase, user.id))) redirect("/dashboard");

  return (
    <OrganisationPageShell>
      <div className="grid gap-5">
        <div className="grid gap-1">
          <h1 className="text-xl font-bold tracking-tight text-primary sm:text-2xl">Watermark Entfernung</h1>
          <p className="text-xs text-secondary sm:text-sm">
            Datei hochladen, jeder Satz wird neu formuliert, Ergebnis als HTML oder .txt herunterladen.
          </p>
        </div>
        <DtWatermarkTool xaiConfigured={Boolean(resolveXaiApiKey())} xaiMissingMessage={XAI_MISSING_KEY_MESSAGE} />
      </div>
    </OrganisationPageShell>
  );
}
