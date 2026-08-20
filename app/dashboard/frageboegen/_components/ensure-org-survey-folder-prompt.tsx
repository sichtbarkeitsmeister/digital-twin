"use client";

import { useState, useTransition } from "react";
import { FolderPlus } from "lucide-react";
import { useRouter } from "next/navigation";

import { ensureOrganisationSurveyFolderAction } from "@/app/dashboard/frageboegen/actions";
import { Button } from "@/components/ui/button";

export function EnsureOrgSurveyFolderPrompt(props: {
  organisationId: string;
  organisationName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="grid gap-3 rounded-xl border border-dashed border-sbkm-navy/20 bg-sbkm-mint/5 px-4 py-5 dark:border-white/15 dark:bg-white/5">
      <div className="grid gap-1 text-center sm:text-left">
        <p className="text-sm font-medium text-primary">
          Noch kein Fragebogen-Ordner für {props.organisationName}
        </p>
        <p className="text-sm text-secondary">
          Ohne Ordner unter Umfragen werden neue Fragebögen oft nicht zugeordnet.
          Soll der Ordner jetzt angelegt werden?
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
        <Button
          type="button"
          size="sm"
          className="gap-2"
          disabled={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const res = await ensureOrganisationSurveyFolderAction({
                organisationId: props.organisationId,
              });
              if (!res.ok) {
                setError(res.message);
                return;
              }
              setMessage(res.message);
              router.refresh();
            });
          }}
        >
          <FolderPlus className="size-4" aria-hidden />
          {isPending ? "Wird angelegt …" : "Ordner anlegen"}
        </Button>
        {message ? <p className="text-xs text-secondary">{message}</p> : null}
        {error ? (
          <p className="text-xs text-red-500" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
