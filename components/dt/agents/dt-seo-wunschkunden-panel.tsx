import Link from "next/link";
import { Users } from "lucide-react";

export type SeoWunschkundeListItem = {
  id: string;
  name: string;
  role: string | null;
  is_enabled: boolean;
};

export function DtSeoWunschkundenPanel(props: {
  organisationId: string;
  personas: SeoWunschkundeListItem[];
}) {
  const active = props.personas.filter((p) => p.is_enabled);
  const orgQuery = encodeURIComponent(props.organisationId);

  return (
    <div className="mt-3 grid gap-2 rounded-2xl border border-sbkm-navy/10 bg-white/70 p-3 dark:border-white/10 dark:bg-white/[0.04] sm:p-4">
      <div className="flex items-start gap-2">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sbkm-mint/15 text-sbkm-navy dark:text-sbkm-mint">
          <Users className="size-4" aria-hidden />
        </div>
        <div className="grid min-w-0 gap-1">
          <p className="text-sm font-semibold text-sbkm-navy dark:text-white">
            Wunschkunden-Wissen (automatisch)
          </p>
          <p className="text-xs text-sbkm-ink-600 dark:text-white/55">
            Der SEO-Berater liest die Wunschkunden dieser Organisation im Chat
            selbst — kein extra „In SEO-Berater übernehmen“. Anbieter-Wissen
            bleibt im Feld oben; Zielgruppen kommen aus den Avataren.
          </p>
        </div>
      </div>

      {active.length === 0 ? (
        <p className="text-xs text-sbkm-ink-500 dark:text-white/40">
          Noch keine Wunschkunden-Avatare. Sobald ein Persona-Fragebogen in
          einen Agenten umgewandelt ist, kennt der SEO-Berater diese Zielgruppe
          automatisch.
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {active.map((persona) => (
            <li key={persona.id}>
              <Link
                href={`/dashboard/verwaltung/agents?org=${orgQuery}&agent=${encodeURIComponent(persona.id)}`}
                className="block rounded-xl border border-sbkm-navy/8 bg-white/80 px-3 py-2 text-sm text-sbkm-navy transition-colors hover:border-sbkm-mint/40 dark:border-white/10 dark:bg-white/[0.03] dark:text-white"
              >
                <span className="font-medium">{persona.name}</span>
                {persona.role?.trim() ? (
                  <span className="text-sbkm-ink-500 dark:text-white/45">
                    {" "}
                    · {persona.role.trim()}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
