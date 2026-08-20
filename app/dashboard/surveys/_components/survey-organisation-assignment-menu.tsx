"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Building2, Check } from "lucide-react";
import { useRouter } from "next/navigation";

import { assignSurveyOrganisationAction } from "@/app/dashboard/surveys/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  filterOrganisationOptions,
  organisationAssignmentLabel,
  organisationOptionLabel,
  type OrganisationOption,
} from "@/lib/shared/organisation-option";
import { cn } from "@/lib/utils";

export function SurveyOrganisationAssignmentMenu(props: {
  surveyId: string;
  currentOrganisationId: string | null;
  organisations: OrganisationOption[];
  labelOrganisations?: OrganisationOption[];
  canEdit?: boolean;
  allowUnassign?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [isPending, startTransition] = useTransition();
  const canEdit = props.canEdit !== false;
  const currentLabel = organisationAssignmentLabel(props.currentOrganisationId, [
    ...props.organisations,
    ...(props.labelOrganisations ?? []),
  ]);
  const filtered = useMemo(
    () => filterOrganisationOptions(props.organisations, query),
    [props.organisations, query],
  );

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const assign = (organisationId: string | null) => {
    if (organisationId === props.currentOrganisationId) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      const res = await assignSurveyOrganisationAction({
        surveyId: props.surveyId,
        organisationId,
      });
      if (!res.ok) {
        window.alert(res.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  if (!canEdit) {
    return (
      <span className="inline-flex max-w-[16rem] items-center gap-1 rounded-md border border-sbkm-navy/15 bg-white/70 px-2 py-1 text-xs text-secondary dark:border-white/15 dark:bg-white/5">
        <Building2 className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{currentLabel}</span>
      </span>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 max-w-[16rem] gap-1 text-xs"
          disabled={isPending}
          aria-label="Organisation zuordnen"
          onClick={(event) => event.stopPropagation()}
        >
          <Building2 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{isPending ? "Speichern…" : currentLabel}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[min(22rem,calc(100vw-2rem))] p-0"
        onCloseAutoFocus={(event) => event.preventDefault()}
        onClick={(event) => event.stopPropagation()}
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
          {props.allowUnassign ? (
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() => assign(null)}
            >
              <span>Ohne Organisation</span>
              <Check
                className={cn(
                  "h-4 w-4 shrink-0",
                  props.currentOrganisationId === null ? "opacity-100" : "opacity-0",
                )}
              />
            </button>
          ) : null}
          {filtered.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              Keine Organisation gefunden.
            </p>
          ) : (
            filtered.map((org) => {
              const label = organisationOptionLabel(org);
              const showSlug = Boolean(org.slug && org.slug !== label);
              const isSelected = org.id === props.currentOrganisationId;
              return (
                <button
                  key={org.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => assign(org.id)}
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
                    className={cn(
                      "h-4 w-4 shrink-0",
                      isSelected ? "opacity-100" : "opacity-0",
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
