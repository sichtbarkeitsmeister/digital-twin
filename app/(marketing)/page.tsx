import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";

import { DtChatShell } from "@/components/dt/chat/dt-chat-shell";
import { LandingHero, LandingPipeline, LandingTrust } from "@/components/dt/landing-sections";
import type { DtChatListScope } from "@/lib/dt/db";
import { loadDtUserOrganisations } from "@/lib/dt/load-user-organisations";

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

async function HomeContent({
  searchParams,
}: {
  searchParams: { org?: string; scope?: string; chat?: string };
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <MarketingHome />;
  }

  const { organisations, error: orgError } = await loadDtUserOrganisations(user.id);

  if (orgError) {
    console.error("[home] organisations:", orgError);
  }

  if (organisations.length === 0) {
    return <MarketingHome />;
  }

  const initialOrgId =
    searchParams.org && organisations.some((o) => o.id === searchParams.org)
      ? searchParams.org
      : organisations[0]!.id;
  const initialScope: DtChatListScope =
    searchParams.scope === "team"
      ? "team"
      : searchParams.scope === "mine"
        ? "mine"
        : searchParams.scope === "all"
          ? "all"
          : "team";

  return (
    <div className="dt-home-chat flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <DtChatShell
        organisations={organisations}
        currentUserId={user.id}
        embedded
        fillHeight
        initialOrgId={initialOrgId}
        initialChatId={searchParams.chat ?? null}
        initialScope={initialScope}
      />
    </div>
  );
}

function HomeFallback() {
  return (
    <div className="dt-home-chat flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="hidden w-[264px] shrink-0 border-r border-sbkm-navy/10 bg-sbkm-canvas/80 p-4 dark:border-white/10 dark:bg-sbkm-ink-900/60 lg:block">
          <div className="h-5 w-24 animate-dt-shimmer rounded bg-sbkm-navy/10 dark:bg-white/10" />
          <div className="mt-4 h-10 w-full animate-dt-shimmer rounded-pill bg-sbkm-navy/10 dark:bg-white/10" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-3 p-6">
            <div className="mx-auto h-12 w-full max-w-3xl animate-dt-shimmer rounded-2xl bg-sbkm-navy/10 dark:bg-white/10" />
            <div className="mx-auto h-16 w-full max-w-3xl animate-dt-shimmer rounded-2xl bg-sbkm-navy/10 dark:bg-white/10" />
          </div>
          <div className="shrink-0 p-4">
            <div className="mx-auto h-24 max-w-3xl animate-dt-shimmer rounded-2xl bg-sbkm-navy/10 dark:bg-white/10" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; scope?: string; chat?: string }>;
}) {
  return (
    <Suspense fallback={<HomeFallback />}>
      <HomeContentWrapper searchParams={searchParams} />
    </Suspense>
  );
}

async function HomeContentWrapper({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; scope?: string; chat?: string }>;
}) {
  const sp = await searchParams;
  return <HomeContent searchParams={sp} />;
}
