"use client";

import Link from "next/link";
import { ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type OrganisationOption = {
  id: string;
  name: string;
};

export function OrganisationSwitcher({
  organisations,
  selectedOrganisationId,
}: {
  organisations: OrganisationOption[];
  selectedOrganisationId: string | null;
}) {
  const selected =
    organisations.find((o) => o.id === selectedOrganisationId) ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="justify-between gap-2">
          <span className="truncate">
            {selected ? selected.name : "Select organisation"}
          </span>
          <ChevronsUpDown className="h-4 w-4 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[260px]">
        {organisations.length === 0 ? (
          <DropdownMenuItem disabled>No organisations</DropdownMenuItem>
        ) : (
          organisations.map((org) => (
            <DropdownMenuItem key={org.id} asChild>
              <Link href={`/dashboard/members?org=${org.id}`}>{org.name}</Link>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

