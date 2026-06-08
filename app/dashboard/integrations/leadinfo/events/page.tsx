import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";

import { OrganisationSwitcher } from "@/app/dashboard/_components/organisation-switcher";
import { PersistedOrganisationUrlSync } from "@/components/shared/persisted-organisation-url-sync";
import {
  canManageOrganisation,
  getAuthenticatedUserId,
  loadUserOrganisations,
  resolveSelectedOrganisationId,
} from "@/lib/dashboard/org-context";
import {
  LEADINFO_PROVIDER,
  previewBody,
  topLevelBodyKeys,
} from "@/lib/integrations/leadinfo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const PAGE_SIZE = 25;

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString();
}

export default async function LeadinfoEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; page?: string }>;
}) {
  const { org: orgParam, page: pageParam } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { supabase, userId } = await getAuthenticatedUserId();
  const { organisations } = await loadUserOrganisations(userId);
  const selectedOrganisationId = resolveSelectedOrganisationId(organisations, orgParam);

  if (!selectedOrganisationId) {
    redirect("/dashboard/integrations");
  }

  const canManage = await canManageOrganisation(
    supabase,
    userId,
    selectedOrganisationId,
  );

  if (!canManage) {
    redirect("/dashboard");
  }

  const selectedOrgName =
    organisations.find((org) => org.id === selectedOrganisationId)?.name ?? "Organisation";

  const { data: events, count, error } = await supabase
    .from("integration_raw_events")
    .select("id, received_at, match_status, http_method, body_json, body_raw", {
      count: "exact",
    })
    .eq("organisation_id", selectedOrganisationId)
    .eq("provider", LEADINFO_PROVIDER)
    .order("received_at", { ascending: false })
    .range(from, to);

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const orgQuery = `org=${selectedOrganisationId}`;

  return (
    <div className="grid gap-6">
      <Suspense fallback={null}>
        <PersistedOrganisationUrlSync
          allowedOrganisationIds={organisations.map((organisation) => organisation.id)}
        />
      </Suspense>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-primary">
            Leadinfo events
          </h1>
          <p className="text-secondary">
            Raw payloads for <span className="text-primary">{selectedOrgName}</span>.
          </p>
        </div>
        <OrganisationSwitcher
          organisations={organisations.map(({ id, name }) => ({ id, name }))}
          selectedOrganisationId={selectedOrganisationId}
          orgPath="/dashboard/integrations/leadinfo/events"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`/dashboard/integrations/leadinfo?${orgQuery}`}>Back to settings</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <CardTitle>Received events</CardTitle>
              <CardDescription>
                {count ?? 0} event{(count ?? 0) === 1 ? "" : "s"} captured
              </CardDescription>
            </div>
            <Badge variant="secondary">Page {page} / {totalPages}</Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          {error ? (
            <p className="text-sm text-red-400">{error.message}</p>
          ) : (events ?? []).length === 0 ? (
            <p className="text-sm text-secondary">
              No events yet. Send a test webhook from Leadinfo to populate this list.
            </p>
          ) : (
            (events ?? []).map((event) => {
              const keys = topLevelBodyKeys(event.body_json);
              return (
                <Link
                  key={event.id}
                  href={`/dashboard/integrations/leadinfo/events/${event.id}?${orgQuery}`}
                  className="block rounded-lg border px-3 py-3 transition-colors hover:bg-accent/40"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-primary">
                      {formatTimestamp(event.received_at)}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{event.match_status}</Badge>
                      <Badge variant="secondary">{event.http_method ?? "POST"}</Badge>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-secondary">
                    Keys: {keys.length > 0 ? keys.join(", ") : "—"}
                  </p>
                  <p className="mt-1 font-mono text-xs text-secondary">
                    {previewBody(event.body_raw, event.body_json)}
                  </p>
                </Link>
              );
            })
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            {page > 1 ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/dashboard/integrations/leadinfo/events?${orgQuery}&page=${page - 1}`}>
                  Previous
                </Link>
              </Button>
            ) : (
              <span />
            )}
            {page < totalPages ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/dashboard/integrations/leadinfo/events?${orgQuery}&page=${page + 1}`}>
                  Next
                </Link>
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
