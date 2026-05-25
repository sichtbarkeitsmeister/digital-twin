import Link from "next/link";
import { redirect } from "next/navigation";

import { OrganisationSwitcher } from "@/app/dashboard/_components/organisation-switcher";
import {
  getAuthenticatedUserId,
  isMemberOfOrganisation,
  loadUserOrganisations,
  resolveSelectedOrganisationId,
} from "@/lib/dashboard/org-context";
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

const STATUS_LABEL: Record<string, string> = {
  active: "Aktiv",
  paused: "Pausiert",
  handed_off: "Übergeben",
  blocked: "Blockiert",
};

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  active: "default",
  paused: "secondary",
  handed_off: "outline",
  blocked: "destructive",
};

function formatTimestamp(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; page?: string; status?: string }>;
}) {
  const { org: orgParam, page: pageParam, status: statusParam } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { supabase, userId } = await getAuthenticatedUserId();
  const { organisations } = await loadUserOrganisations(userId);
  const selectedOrganisationId = resolveSelectedOrganisationId(
    organisations,
    orgParam,
  );

  if (!selectedOrganisationId) {
    return (
      <div className="grid gap-6">
        <h1 className="text-2xl font-bold tracking-tight text-primary">Leads</h1>
        <Card>
          <CardHeader>
            <CardTitle>Keine Organisation</CardTitle>
            <CardDescription>
              Du musst Mitglied einer Organisation sein, um Leads zu sehen.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const isMember = await isMemberOfOrganisation(
    supabase,
    userId,
    selectedOrganisationId,
  );
  if (!isMember) {
    redirect("/dashboard");
  }

  const selectedOrgName =
    organisations.find((org) => org.id === selectedOrganisationId)?.name ??
    "Organisation";

  let query = supabase
    .from("companies")
    .select(
      "id, domain, name, industry, country, agent_status, channel_preference, last_seen_at, visit_count",
      { count: "exact" },
    )
    .eq("organisation_id", selectedOrganisationId)
    .order("last_seen_at", { ascending: false })
    .range(from, to);

  if (statusParam && Object.keys(STATUS_LABEL).includes(statusParam)) {
    query = query.eq("agent_status", statusParam);
  }

  const { data: companies, count, error } = await query;

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const orgQuery = `org=${selectedOrganisationId}`;

  const [activeRes, pausedRes, handedOffRes] = await Promise.all([
    supabase
      .from("companies")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", selectedOrganisationId)
      .eq("agent_status", "active"),
    supabase
      .from("companies")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", selectedOrganisationId)
      .eq("agent_status", "paused"),
    supabase
      .from("companies")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", selectedOrganisationId)
      .eq("agent_status", "handed_off"),
  ]);

  const kpis = {
    active: activeRes.count ?? 0,
    paused: pausedRes.count ?? 0,
    handedOff: handedOffRes.count ?? 0,
    total: count ?? 0,
  };

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-primary">
            Leads
          </h1>
          <p className="text-secondary">
            Erkannte Firmen für{" "}
            <span className="text-primary">{selectedOrgName}</span>.
          </p>
        </div>
        <OrganisationSwitcher
          organisations={organisations.map(({ id, name }) => ({ id, name }))}
          selectedOrganisationId={selectedOrganisationId}
          orgPath="/dashboard/leads"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile label="Gesamt" value={kpis.total} />
        <KpiTile label="Aktiv" value={kpis.active} />
        <KpiTile label="Pausiert" value={kpis.paused} />
        <KpiTile label="Übergeben" value={kpis.handedOff} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          asChild
          variant={statusParam ? "outline" : "default"}
          size="sm"
        >
          <Link href={`/dashboard/leads?${orgQuery}`}>Alle</Link>
        </Button>
        {Object.entries(STATUS_LABEL).map(([key, label]) => (
          <Button
            key={key}
            asChild
            variant={statusParam === key ? "default" : "outline"}
            size="sm"
          >
            <Link href={`/dashboard/leads?${orgQuery}&status=${key}`}>
              {label}
            </Link>
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <CardTitle>Firmen</CardTitle>
              <CardDescription>
                {count ?? 0} {(count ?? 0) === 1 ? "Firma" : "Firmen"}
              </CardDescription>
            </div>
            <Badge variant="secondary">
              Seite {page} / {totalPages}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          {error ? (
            <p className="text-sm text-red-400">{error.message}</p>
          ) : (companies ?? []).length === 0 ? (
            <div className="grid gap-2 rounded-lg border border-dashed p-6 text-sm text-secondary">
              <p className="text-primary">Noch keine Firmen erkannt.</p>
              <p>
                Sobald Leadinfo einen Besuch erkennt, erscheint die Firma hier
                automatisch. Du kannst die Verbindung unter{" "}
                <Link
                  className="underline hover:text-primary"
                  href={`/dashboard/integrations/leadinfo?${orgQuery}`}
                >
                  Integrationen → Leadinfo
                </Link>{" "}
                prüfen.
              </p>
            </div>
          ) : (
            (companies ?? []).map((c) => (
              <Link
                key={c.id}
                href={`/dashboard/leads/${c.id}?${orgQuery}`}
                className="block rounded-lg border px-3 py-3 transition-colors hover:bg-accent/40"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-primary">
                      {c.name ?? c.domain}
                    </p>
                    <p className="truncate text-xs text-secondary">
                      {c.domain}
                      {c.industry ? ` · ${c.industry}` : ""}
                      {c.country ? ` · ${c.country}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={STATUS_VARIANT[c.agent_status] ?? "secondary"}>
                      {STATUS_LABEL[c.agent_status] ?? c.agent_status}
                    </Badge>
                    <Badge variant="outline">
                      {c.visit_count} Besuch{c.visit_count === 1 ? "" : "e"}
                    </Badge>
                    <span className="text-xs text-secondary">
                      {formatTimestamp(c.last_seen_at)}
                    </span>
                  </div>
                </div>
              </Link>
            ))
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            {page > 1 ? (
              <Button asChild variant="outline" size="sm">
                <Link
                  href={`/dashboard/leads?${orgQuery}${
                    statusParam ? `&status=${statusParam}` : ""
                  }&page=${page - 1}`}
                >
                  Zurück
                </Link>
              </Button>
            ) : (
              <span />
            )}
            {page < totalPages ? (
              <Button asChild variant="outline" size="sm">
                <Link
                  href={`/dashboard/leads?${orgQuery}${
                    statusParam ? `&status=${statusParam}` : ""
                  }&page=${page + 1}`}
                >
                  Weiter
                </Link>
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiTile({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="grid gap-1 p-4">
        <p className="text-xs uppercase tracking-wide text-secondary">{label}</p>
        <p className="text-2xl font-semibold text-primary">{value}</p>
      </CardContent>
    </Card>
  );
}
