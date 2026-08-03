import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  getAuthenticatedUserId,
  loadUserOrganisations,
  resolveSelectedOrganisationId,
} from "@/lib/dashboard/org-context";
import { isPlatformAdmin } from "@/lib/dt/org-access";
import { LEADINFO_PROVIDER } from "@/lib/integrations/leadinfo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function prettyJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default async function LeadinfoEventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ org?: string }>;
}) {
  const { eventId } = await params;
  const { org: orgParam } = await searchParams;

  const { supabase, userId } = await getAuthenticatedUserId();
  const { organisations } = await loadUserOrganisations(userId);
  const selectedOrganisationId = resolveSelectedOrganisationId(organisations, orgParam);

  if (!selectedOrganisationId) {
    redirect("/dashboard/integrations");
  }

  const canManage = await isPlatformAdmin(supabase, userId);

  if (!canManage) {
    redirect("/dashboard");
  }

  const { data: event, error } = await supabase
    .from("integration_raw_events")
    .select("*")
    .eq("id", eventId)
    .eq("organisation_id", selectedOrganisationId)
    .eq("provider", LEADINFO_PROVIDER)
    .maybeSingle();

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Error</CardTitle>
          <CardDescription>Could not load event.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-red-400">{error.message}</CardContent>
      </Card>
    );
  }

  if (!event) {
    notFound();
  }

  const orgQuery = `org=${selectedOrganisationId}`;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-primary">Event detail</h1>
          <p className="text-secondary">
            Received {new Date(event.received_at).toLocaleString()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{event.match_status}</Badge>
          <Badge variant="secondary">{event.http_method ?? "POST"}</Badge>
        </div>
      </div>

      <Button asChild variant="outline" size="sm" className="w-fit">
        <Link href={`/dashboard/integrations/leadinfo/events?${orgQuery}`}>
          Back to events
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Metadata</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <p>
            <span className="text-secondary">Source IP:</span>{" "}
            <span className="text-primary">{event.source_ip ?? "—"}</span>
          </p>
          <p>
            <span className="text-secondary">Signature header:</span>{" "}
            <span className="font-mono text-xs text-primary">
              {event.signature_header ?? "—"}
            </span>
          </p>
          <p>
            <span className="text-secondary">Path:</span>{" "}
            <span className="font-mono text-xs text-primary">{event.path ?? "—"}</span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Query</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-lg border bg-muted/20 p-4 text-xs">
            {prettyJson(event.query)}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Headers</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-lg border bg-muted/20 p-4 text-xs">
            {prettyJson(event.headers)}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Parsed body</CardTitle>
          <CardDescription>
            {event.body_json ? "JSON parsed successfully." : "Body was not valid JSON."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-lg border bg-muted/20 p-4 text-xs">
            {event.body_json ? prettyJson(event.body_json) : "—"}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Raw body</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-lg border bg-muted/20 p-4 text-xs whitespace-pre-wrap break-all">
            {event.body_raw ?? "—"}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
