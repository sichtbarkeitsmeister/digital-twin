import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  getAuthenticatedUserId,
  isMemberOfOrganisation,
  loadUserOrganisations,
  resolveSelectedOrganisationId,
} from "@/lib/dashboard/org-context";
import { isPlatformAdmin } from "@/lib/dt/org-access";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const STATUS_LABEL: Record<string, string> = {
  active: "Aktiv",
  paused: "Pausiert",
  handed_off: "Übergeben",
  blocked: "Blockiert",
};

const CHANNEL_LABEL: Record<string, string> = {
  email: "Bevorzugt E-Mail",
  linkedin: "Bevorzugt LinkedIn",
  any: "Kanal egal",
};

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function prettyJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Readable page list for customers instead of the raw visit payload. */
function visitedPagePaths(pages: unknown): string[] {
  if (!Array.isArray(pages)) return [];
  return pages
    .map((page) => {
      if (typeof page === "string") return page;
      if (page && typeof page === "object") {
        const record = page as Record<string, unknown>;
        const candidate = record.url ?? record.path ?? record.page ?? record.title;
        if (typeof candidate === "string") return candidate;
      }
      return null;
    })
    .filter((value): value is string => Boolean(value?.trim()));
}

export default async function CompanyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ org?: string }>;
}) {
  const { companyId } = await params;
  const { org: orgParam } = await searchParams;

  const { supabase, userId } = await getAuthenticatedUserId();
  const platformAdmin = await isPlatformAdmin(supabase, userId);
  if (!platformAdmin) {
    redirect("/dashboard");
  }

  const { organisations } = await loadUserOrganisations(userId);
  const selectedOrganisationId = resolveSelectedOrganisationId(
    organisations,
    orgParam,
  );

  if (!selectedOrganisationId) {
    redirect("/dashboard/leads");
  }

  const isMember = await isMemberOfOrganisation(
    supabase,
    userId,
    selectedOrganisationId,
  );
  if (!isMember) {
    redirect("/dashboard");
  }

  const showTechnicalDetails = platformAdmin;
  const orgQuery = `org=${selectedOrganisationId}`;

  const { data: company, error } = await supabase
    .from("companies")
    .select("*")
    .eq("id", companyId)
    .eq("organisation_id", selectedOrganisationId)
    .maybeSingle();

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Fehler</CardTitle>
          <CardDescription>Firma konnte nicht geladen werden.</CardDescription>
        </CardHeader>
        {showTechnicalDetails ? (
          <CardContent className="text-sm text-red-400">{error.message}</CardContent>
        ) : null}
      </Card>
    );
  }

  if (!company) {
    notFound();
  }

  const [{ data: visits }, { data: contacts }] = await Promise.all([
    supabase
      .from("visits")
      .select(
        "id, visited_at, duration_s, referrer, raw_event_id, pages",
      )
      .eq("organisation_id", selectedOrganisationId)
      .eq("company_id", companyId)
      .order("visited_at", { ascending: false })
      .limit(50),
    supabase
      .from("contacts")
      .select(
        "id, full_name, title, email, linkedin_url, phone, source, score, is_primary, do_not_contact",
      )
      .eq("organisation_id", selectedOrganisationId)
      .eq("company_id", companyId)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-primary">
            {company.name ?? company.domain}
          </h1>
          <p className="text-secondary">
            <a
              className="underline hover:text-primary"
              href={`https://${company.domain}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              {company.domain}
            </a>
            {company.industry ? ` · ${company.industry}` : ""}
            {company.country ? ` · ${company.country}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {STATUS_LABEL[company.agent_status] ?? company.agent_status}
          </Badge>
          {CHANNEL_LABEL[company.channel_preference] ? (
            <Badge variant="outline">{CHANNEL_LABEL[company.channel_preference]}</Badge>
          ) : null}
        </div>
      </div>

      <Button asChild variant="outline" size="sm" className="w-fit">
        <Link href={`/dashboard/leads?${orgQuery}`}>Zurück zu Leads</Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Übersicht</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <Row label="Erste Erkennung" value={formatTimestamp(company.first_seen_at)} />
          <Row label="Letzter Besuch" value={formatTimestamp(company.last_seen_at)} />
          <Row label="Besuche gesamt" value={String(company.visit_count ?? 0)} />
          <Row label="Branche" value={company.industry ?? "—"} />
          <Row label="Größe" value={company.size_range ?? "—"} />
          <Row label="Region" value={company.region ?? "—"} />
          <Row label="Stadt" value={company.city ?? "—"} />
          <Row label="Quelle" value={company.source} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <CardTitle>Kontakte</CardTitle>
              <CardDescription>
                {(contacts ?? []).length} Kontakt
                {(contacts ?? []).length === 1 ? "" : "e"} bekannt
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-2">
          {(contacts ?? []).length === 0 ? (
            <p className="text-sm text-secondary">Noch keine Kontakte hinterlegt.</p>
          ) : (
            (contacts ?? []).map((c) => (
              <div key={c.id} className="rounded-lg border px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-primary">
                      {c.full_name ?? c.email ?? "—"}
                      {c.is_primary ? (
                        <Badge variant="default" className="ml-2">Primär</Badge>
                      ) : null}
                      {c.do_not_contact ? (
                        <Badge variant="destructive" className="ml-2">DNC</Badge>
                      ) : null}
                    </p>
                    <p className="text-xs text-secondary">
                      {c.title ?? "—"}
                      {c.email ? ` · ${c.email}` : ""}
                    </p>
                    {c.linkedin_url ? (
                      <p className="text-xs">
                        <a
                          className="underline text-secondary hover:text-primary"
                          href={c.linkedin_url}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          LinkedIn
                        </a>
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{c.source}</Badge>
                    {typeof c.score === "number" ? (
                      <Badge variant="secondary">Score {c.score}</Badge>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Besuche</CardTitle>
          <CardDescription>Letzte 50 Besuche</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {(visits ?? []).length === 0 ? (
            <p className="text-sm text-secondary">Noch keine Besuche.</p>
          ) : (
            (visits ?? []).map((v) => (
              <div key={v.id} className="rounded-lg border px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-primary">{formatTimestamp(v.visited_at)}</p>
                    <p className="text-xs text-secondary">
                      {v.duration_s ? `${v.duration_s}s` : "—"}
                      {v.referrer ? ` · ${v.referrer}` : ""}
                    </p>
                  </div>
                  {showTechnicalDetails && v.raw_event_id ? (
                    <Button asChild variant="ghost" size="sm">
                      <Link
                        href={`/dashboard/integrations/leadinfo/events/${v.raw_event_id}?${orgQuery}`}
                      >
                        Rohdaten
                      </Link>
                    </Button>
                  ) : null}
                </div>
                {Array.isArray(v.pages) && v.pages.length > 0 ? (
                  showTechnicalDetails ? (
                    <pre className="mt-2 overflow-x-auto rounded-md bg-muted/30 p-2 text-xs">
                      {prettyJson(v.pages)}
                    </pre>
                  ) : (
                    <ul className="mt-2 grid gap-1 text-xs text-secondary">
                      {visitedPagePaths(v.pages).map((path, i) => (
                        <li key={`${v.id}-${i}`} className="truncate">
                          {path}
                        </li>
                      ))}
                    </ul>
                  )
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {showTechnicalDetails ? (
        <Card>
          <CardHeader>
            <CardTitle>Metadaten</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-lg border bg-muted/20 p-4 text-xs">
              {prettyJson(company.metadata)}
            </pre>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-secondary">{label}</span>
      <span className="text-primary">{value}</span>
    </div>
  );
}
