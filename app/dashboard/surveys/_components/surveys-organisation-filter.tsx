"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Building2, Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  filterOrganisationOptions,
  organisationOptionLabel,
  type OrganisationOption,
} from "@/lib/shared/organisation-option";
import { cn } from "@/lib/utils";

export function SurveysOrganisationFilter(props: {
  organisations: OrganisationOption[];
  initialOrganisation: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [isPending, startTransition] = useTransition();
  const selectedId = props.initialOrganisation;
  const selectedOrg =
    selectedId && selectedId !== "none"
      ? (props.organisations.find((org) => org.id === selectedId) ?? null)
      : null;
  const filtered = useMemo(
    () => filterOrganisationOptions(props.organisations, query),
    [props.organisations, query],
  );
  const label =
    selectedId === "none"
      ? "Ohne Organisation"
      : selectedOrg
        ? organisationOptionLabel(selectedOrg)
        : "Alle Organisationen";

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const apply = (nextOrg: string) => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("page", "1");
    if (!nextOrg) sp.delete("org");
    else sp.set("org", nextOrg);
    const qs = sp.toString();
    setOpen(false);
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 min-w-[12rem] justify-between gap-2"
          disabled={isPending}
          aria-label="Nach Organisation filtern"
        >
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5 shrink-0 opacity-70" />
            <span className="truncate">{label}</span>
          </span>
          <ChevronsUpDown className="h-4 w-4 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[min(22rem,calc(100vw-2rem))] p-0"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div className="border-b border-border p-2">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder="Organisation suchen…"
            className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Organisation suchen"
            autoFocus
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => apply("")}
          >
            <span>Alle Organisationen</span>
            <Check
              className={cn(
                "h-4 w-4 shrink-0",
                !selectedId ? "opacity-100" : "opacity-0",
              )}
            />
          </button>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => apply("none")}
          >
            <span>Ohne Organisation</span>
            <Check
              className={cn(
                "h-4 w-4 shrink-0",
                selectedId === "none" ? "opacity-100" : "opacity-0",
              )}
            />
          </button>
          {filtered.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              Keine Organisation gefunden.
            </p>
          ) : (
            filtered.map((org) => {
              const orgLabel = organisationOptionLabel(org);
              return (
                <button
                  key={org.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => apply(org.id)}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{orgLabel}</span>
                    {org.slug && org.slug !== orgLabel ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {org.slug}
                      </span>
                    ) : null}
                  </span>
                  <Check
                    className={cn(
                      "h-4 w-4 shrink-0",
                      org.id === selectedId ? "opacity-100" : "opacity-0",
                    )}
                  />
                </button>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
