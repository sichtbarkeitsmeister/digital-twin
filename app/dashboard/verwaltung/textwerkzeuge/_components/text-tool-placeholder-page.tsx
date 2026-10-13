import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { OrganisationPageShell } from "@/app/dashboard/_components/organisations/organisation-page-shell";
import { resolveTextToolsPage } from "@/lib/dt/text-tools/access";
import { TEXT_TOOLS_UPLOAD_HINT } from "@/lib/dt/text-tools/ingest";
import { TEXT_TOOLS, TEXT_TOOLS_BASE_PATH, textToolHref, type TextToolId } from "@/lib/dt/text-tools/tools";

/**
 * Shared body of the three tool routes until each tool brings its own workspace: same access
 * and organisation handling as Texte, a title, and a note on what the tool will do. A tool
 * the feature flag hides is a 404, like a route that does not exist.
 */
export async function TextToolPlaceholderPage({
  tool,
  searchParams,
}: {
  tool: TextToolId;
  searchParams: Promise<{ org?: string }>;
}) {
  const sp = await searchParams;
  const access = await resolveTextToolsPage(sp, tool);
  if (!access.ok) {
    if (access.reason === "tool_disabled") notFound();
    redirect(access.reason === "unauthenticated" ? "/auth/login" : "/dashboard");
  }

  const definition = TEXT_TOOLS[tool];
  const organisation = access.organisation;

  return (
    <OrganisationPageShell>
      <div className="grid gap-5">
        <div className="grid gap-1">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sbkm-ink-500">
            <Link href={TEXT_TOOLS_BASE_PATH} className="hover:underline">
              Textwerkzeuge
            </Link>
          </p>
          <h1 className="text-xl font-bold tracking-tight text-primary sm:text-2xl">{definition.label}</h1>
          <p className="text-xs text-secondary sm:text-sm">
            {organisation ? (
              <>
                Für <span className="font-semibold">{organisation.name}</span>. {definition.description}
              </>
            ) : (
              definition.description
            )}
          </p>
        </div>

        {organisation ? (
          <div className="rounded-xl border border-sbkm-navy/10 bg-white/60 p-5 text-sm text-sbkm-ink-700 dark:border-white/10 dark:bg-white/5 dark:text-white/75">
            <p className="font-semibold text-sbkm-navy dark:text-white">In Vorbereitung</p>
            <p className="mt-1">
              Dieses Werkzeug nimmt bald einen Text als {TEXT_TOOLS_UPLOAD_HINT} entgegen, bearbeitet ihn
              abschnittsweise und gibt ihn als HTML oder Text zurück.
            </p>
            <p className="mt-3 text-xs text-sbkm-ink-500 dark:text-white/55">
              Weitere Werkzeuge:{" "}
              {access.enabledTools
                .filter((id) => id !== tool)
                .map((id, index) => (
                  <span key={id}>
                    {index > 0 ? " · " : ""}
                    <Link href={textToolHref(id, organisation.id)} className="underline">
                      {TEXT_TOOLS[id].label}
                    </Link>
                  </span>
                ))}
            </p>
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
