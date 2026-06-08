import { Building2 } from "lucide-react";

export function OrganisationEmptyState() {
  return (
    <div className="relative overflow-hidden rounded-xl border border-dashed border-border/80 bg-muted/20 px-6 py-12 text-center shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Building2 className="size-6" aria-hidden />
      </div>
      <h2 className="text-lg font-semibold tracking-tight text-primary">
        Noch keine Organisationen
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-secondary">
        Sobald du eingeladen wirst, erscheinen deine Organisationen hier. Bitte
        deinen Admin oder Inhaber um eine Einladung per E-Mail.
      </p>
    </div>
  );
}
