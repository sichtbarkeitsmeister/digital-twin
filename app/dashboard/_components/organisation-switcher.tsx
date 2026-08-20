"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, ChevronsUpDown } from "lucide-react";

import { writeSelectedOrganisationId } from "@/lib/shared/selected-organisation-storage";
import {
  filterOrganisationOptions,
  organisationOptionLabel,
  type OrganisationOption,
} from "@/lib/shared/organisation-option";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type { OrganisationOption };

export function OrganisationSwitcher({
  organisations,
  selectedOrganisationId,
  orgPath = "/dashboard/organisations",
}: {
  organisations: OrganisationOption[];
  selectedOrganisationId: string | null;
  orgPath?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected =
    organisations.find((org) => org.id === selectedOrganisationId) ?? null;
  const filtered = useMemo(
    () => filterOrganisationOptions(organisations, query),
    [organisations, query],
  );

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="min-w-[220px] justify-between gap-2"
          aria-label="Organisation wechseln"
        >
          <span className="truncate">
            {selected ? organisationOptionLabel(selected) : "Organisation wählen"}
          </span>
          <ChevronsUpDown className="h-4 w-4 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[min(22rem,calc(100vw-2rem))] p-0"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {organisations.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">Keine Organisationen</p>
        ) : (
          <>
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
              {filtered.length === 0 ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">
                  Keine Organisation gefunden.
                </p>
              ) : (
                filtered.map((org) => {
                  const label = organisationOptionLabel(org);
                  const showSlug = Boolean(org.slug && org.slug !== label);
                  const isSelected = org.id === selectedOrganisationId;
                  return (
                    <Link
                      key={org.id}
                      href={`${orgPath}?org=${org.id}`}
                      onClick={() => {
                        writeSelectedOrganisationId(org.id);
                        setOpen(false);
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{label}</span>
                        {showSlug ? (
                          <span className="block truncate text-xs text-muted-foreground">
                            {org.slug}
                          </span>
                        ) : null}
                      </span>
                      <Check
                        className={cn("h-4 w-4 shrink-0", isSelected ? "opacity-100" : "opacity-0")}
                      />
                    </Link>
                  );
                })
              )}
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
