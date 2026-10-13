import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { OrganisationPageShell } from "@/app/dashboard/_components/organisations/organisation-page-shell";
import { resolveTextToolsPage } from "@/lib/dt/text-tools/access";
import { TEXT_TOOLS, textToolHref } from "@/lib/dt/text-tools/tools";

/** Overview of the enabled Textwerkzeuge; a 404 while the flag hides all of them. */
export default async function VerwaltungTextwerkzeugePage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const sp = await searchParams;
  const access = await resolveTextToolsPage(sp);
  if (!access.ok) redirect(access.reason === "unauthenticated" ? "/auth/login" : "/dashboard");
  if (access.enabledTools.length === 0) notFound();

  const organisation = access.organisation;

  return (
    <OrganisationPageShell>
      <div className="grid gap-5">
        <div className="grid gap-1">
          <h1 className="text-xl font-bold tracking-tight text-primary sm:text-2xl">Textwerkzeuge</h1>
          <p className="text-xs text-secondary sm:text-sm">
            Einzelne Texte{organisation ? <> für <span className="font-semibold">{organisation.name}</span></> : null}{" "}
            hochladen, bearbeiten lassen und als HTML oder Text herunterladen.
          </p>
        </div>

        {organisation ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {access.enabledTools.map((id) => {
              const tool = TEXT_TOOLS[id];
              return (
                <Link
                  key={id}
                  href={textToolHref(id, organisation.id)}
                  className="grid gap-1 rounded-xl border border-sbkm-navy/10 bg-white/60 p-4 transition-colors hover:bg-sbkm-navy/[0.04] dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
                >
                  <span className="font-semibold text-sbkm-navy dark:text-white">{tool.label}</span>
                  <span className="text-xs text-sbkm-ink-600 dark:text-white/70">{tool.description}</span>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-sbkm-ink-600 dark:text-white/70">
            Textwerkzeuge sind für Administratoren verfügbar. Es gibt noch keine Organisation mit
            DigitalTwin-Konfiguration.
          </p>
        )}
      </div>
    </OrganisationPageShell>
  );
}
