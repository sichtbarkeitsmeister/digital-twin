import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ChatMockup } from "@/app/_components/chat-mockup";
import { Suspense } from "react";

function MarketingHome() {
  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-6xl items-center justify-center px-5 py-10 sm:min-h-[80vh] sm:py-14">
      <section className="relative w-full max-w-2xl overflow-hidden rounded-xl border bg-card p-8 text-center sm:p-12">
        <div className="absolute inset-0 -z-10 opacity-70">
          <div className="absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-brand blur-3xl" />
          <div className="absolute -bottom-24 left-12 h-64 w-64 rounded-full bg-brand blur-3xl opacity-40" />
        </div>

        <div className="mx-auto grid max-w-xl gap-6">
          <p className="text-sm font-medium text-secondary">
            KI-Assistent für Content-Teams
          </p>

          <div className="grid gap-3">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              Schreiben. Prüfen. Veröffentlichen.
            </h1>
            <p className="text-base text-secondary sm:text-lg">
              Minimal, schnell und fokussiert.
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-3">
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

function HomeFallback() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col px-5 py-10 sm:py-14">
      <div className="rounded-lg border bg-card p-6 text-sm text-secondary">
        Lädt …
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<HomeFallback />}>
      <HomeContent />
    </Suspense>
  );
}
