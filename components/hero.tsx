export function Hero() {
  return (
    <section className="relative overflow-hidden rounded-lg border bg-card p-8 sm:p-10">
      <div className="absolute inset-0 -z-10 opacity-70">
        <div className="absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-brand blur-3xl" />
        <div className="absolute -bottom-24 left-12 h-64 w-64 rounded-full bg-brand blur-3xl opacity-40" />
      </div>

      <div className="flex flex-col gap-6">
        <p className="text-sm font-medium text-secondary">
          KI-Assistenten für Marketing-, Content- und SEO-Teams
        </p>

        <div className="flex flex-col gap-4">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Bessere Texte. Bessere SEO. Mehr Wirkung bei Ihrer Zielgruppe.
          </h1>
          <p className="max-w-2xl text-base text-secondary sm:text-lg">
            Wir richten für Ihr Unternehmen eine{" "}
            <span className="font-semibold">Organisation</span> ein,
            konfigurieren passende KI-Agenten und setzen einen{" "}
            <span className="font-semibold">Owner per E-Mail</span>. Der Owner
            kann Teammitglieder einladen, damit alle gemeinsam mit den AIs
            arbeiten.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <a
            href="#zugang"
            className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
          >
            Zugang anfordern
          </a>
          <a
            href="#so-funktionierts"
            className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
          >
            So funktioniert’s
          </a>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border bg-background/50 p-4">
            <p className="text-sm font-semibold">Zielgruppen-Insights</p>
            <p className="mt-1 text-sm text-secondary">
              Schreibe präziser für Personas, Branchen und Kaufphasen – ohne
              mehr Aufwand.
            </p>
          </div>
          <div className="rounded-lg border bg-background/50 p-4">
            <p className="text-sm font-semibold">SEO-Optimierung</p>
            <p className="mt-1 text-sm text-secondary">
              Keywords, Struktur, Snippets und Lesbarkeit – konsistent und
              skalierbar.
            </p>
          </div>
          <div className="rounded-lg border bg-background/50 p-4">
            <p className="text-sm font-semibold">Brand Voice</p>
            <p className="mt-1 text-sm text-secondary">
              Tonalität, Stil und Terminologie bleiben über alle Texte hinweg
              einheitlich.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
