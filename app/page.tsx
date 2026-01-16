import { Hero } from "@/components/hero";
import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { ChatMockup } from "@/app/_components/chat-mockup";

function MarketingHome() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col px-5">
      <div className="flex flex-col gap-16 py-10 sm:py-14">
        <Hero />

        <section id="produkt" className="grid gap-6">
          <div className="grid gap-2">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Ein Assistent, der Ihre Inhalte messbar verbessert Test
            </h2>
            <p className="max-w-3xl text-secondary">
              Von Landingpages über Produkttexte bis Blogartikel: Unsere KI
              hilft Teams dabei, schneller zu schreiben, konsistenter zu bleiben
              und bessere Ergebnisse bei SEO und Conversion zu erzielen.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border bg-card p-6">
              <p className="text-sm font-semibold">SEO-Checks in Sekunden</p>
              <p className="mt-2 text-sm text-secondary">
                Struktur, Keywords, interne Links, Meta-Varianten und Snippets –
                direkt als Vorschläge.
              </p>
            </div>
            <div className="rounded-lg border bg-card p-6">
              <p className="text-sm font-semibold">Texte für jede Zielgruppe</p>
              <p className="mt-2 text-sm text-secondary">
                Tonalität und Argumente passend für Branche, Persona und
                Funnel-Phase.
              </p>
            </div>
            <div className="rounded-lg border bg-card p-6">
              <p className="text-sm font-semibold">Weniger Abstimmungschaos</p>
              <p className="mt-2 text-sm text-secondary">
                Ein Owner verwaltet die Organisation und lädt Kolleg:innen ein –
                alles zentral.
              </p>
            </div>
          </div>
        </section>

        <section id="so-funktionierts" className="grid gap-6">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            So funktioniert’s
          </h2>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-lg border bg-card p-6">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  1
                </div>
                <div>
                  <p className="text-sm font-semibold">
                    Organisation wird eingerichtet
                  </p>
                  <p className="mt-1 text-sm text-secondary">
                    Wir erstellen die Organisation für Ihr Unternehmen und
                    hinterlegen passende KI-Agenten.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border bg-card p-6">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  2
                </div>
                <div>
                  <p className="text-sm font-semibold">Owner per E-Mail</p>
                  <p className="mt-1 text-sm text-secondary">
                    Wir setzen eine E-Mail als Owner. Der Owner steuert Zugriff
                    und Einladungen.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border bg-card p-6">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  3
                </div>
                <div>
                  <p className="text-sm font-semibold">
                    Team einladen & loslegen
                  </p>
                  <p className="mt-1 text-sm text-secondary">
                    Kolleg:innen nutzen die AIs der Organisation für SEO, Texte,
                    Varianten und Optimierung.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="zugang" className="rounded-lg border bg-card p-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="grid gap-2">
              <h2 className="text-2xl font-bold tracking-tight">
                Bereit für bessere Inhalte?
              </h2>
              <p className="max-w-2xl text-secondary">
                Fordern Sie Zugang an – wir richten Ihre Organisation ein und
                starten mit den passenden KI-Agenten.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/auth/sign-up"
                className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
              >
                Zugang anfordern
              </Link>
              <Link
                href="/auth/login"
                className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-5 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
              >
                Anmelden
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

async function HomeContent() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <MarketingHome />;
  }

  const { data: membership } = await supabase
    .from("organisation_members")
    .select("organisation_id, organisations ( id, name, slug )")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  const hasOrganisation = (membership?.length ?? 0) > 0;
  if (!hasOrganisation) {
    return <MarketingHome />;
  }

  const organisations = (membership ?? [])
    .map((m) => {
      const withOrg = m as unknown as {
        organisations:
          | { id: string; name: string; slug: string | null }
          | Array<{ id: string; name: string; slug: string | null }>
          | null;
      };
      const org = Array.isArray(withOrg.organisations)
        ? withOrg.organisations[0] ?? null
        : withOrg.organisations ?? null;
      return org;
    })
    .filter((o): o is { id: string; name: string; slug: string | null } =>
      Boolean(o)
    );

  if (organisations.length === 0) {
    return <MarketingHome />;
  }

  return <ChatMockup organisations={organisations} />;
}

export default function Home() {
  return (
    <Suspense fallback={<MarketingHome />}>
      <HomeContent />
    </Suspense>
  );
}
