import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";

import { ChatMockup } from "@/app/_components/chat-mockup";
import { LandingHero, LandingPipeline, LandingTrust } from "@/components/dt/landing-sections";

function MarketingHome() {
  return (
    <>
      <LandingHero />
      <hr className="border-0 border-t border-sbkm-navy/15 dark:border-white/10" />
      <LandingPipeline />
      <LandingTrust />
    </>
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
        ? (withOrg.organisations[0] ?? null)
        : (withOrg.organisations ?? null);
      return org;
    })
    .filter((o): o is { id: string; name: string; slug: string | null } => Boolean(o));

  if (organisations.length === 0) {
    return <MarketingHome />;
  }

  return (
    <div className="mx-auto w-full max-w-dt px-5 py-10 sm:px-14">
      <ChatMockup organisations={organisations} />
    </div>
  );
}

function HomeFallback() {
  return (
    <div className="mx-auto w-full max-w-dt px-5 py-10 sm:px-14">
      <div className="rounded-dt border border-sbkm-navy/10 bg-white/55 p-6 text-sm text-sbkm-ink-600 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06] dark:text-white/70">
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
