"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import type { ActionState } from "@/app/dashboard/actions";
import { updateOrganisationProfileAction } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: ActionState = { ok: true, message: "" };

export function OrganisationEditNameForm(props: {
  organisationId: string;
  name: string;
  displayName: string | null;
  slug: string | null;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    updateOrganisationProfileAction,
    initialState,
  );
  const lastMessage = useRef(state.message);

  useEffect(() => {
    if (state.message !== lastMessage.current) {
      lastMessage.current = state.message;
      if (state.ok && state.message && state.message !== "Keine Änderung.") {
        router.refresh();
      }
    }
  }, [state, router]);

  const defaultName = props.displayName?.trim() || props.name;

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="organisation_id" value={props.organisationId} />

      <div className="grid gap-2">
        <Label htmlFor="org_name">Organisationsname</Label>
        <Input
          id="org_name"
          name="org_name"
          defaultValue={defaultName}
          autoComplete="organization"
          required
          minLength={2}
          maxLength={120}
        />
        <p className="text-xs text-secondary">
          Sichtbarer Name in Fragebögen, Agenten und der Organisationsliste.
          z.&nbsp;B. „ArcticTub“ statt „arctictub“.
        </p>
      </div>

      {props.slug ? (
        <div className="grid gap-1">
          <p className="text-xs font-medium text-primary">
            Technischer Slug: <code className="text-xs">{props.slug}</code>
          </p>
          <p className="text-xs text-secondary">
            Bleibt unverändert — wird als Schlüssel für SEO/n8n genutzt.
          </p>
        </div>
      ) : null}

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
        <input
          type="checkbox"
          name="rename_survey_folder"
          value="on"
          defaultChecked
          className="mt-0.5 h-4 w-4 shrink-0 rounded border border-primary accent-primary"
        />
        <span className="grid gap-1">
          <span className="text-sm font-medium">Fragebogen-Ordner mit umbenennen</span>
          <span className="text-xs text-secondary">
            Wenn ein Ordner unter Umfragen zum bisherigen Namen passt, wird er
            an den neuen Namen angeglichen.
          </span>
        </span>
      </label>

      {state.message ? (
        <p
          className={state.ok ? "text-sm text-secondary" : "text-sm text-red-400"}
          role={state.ok ? "status" : "alert"}
        >
          {state.message}
        </p>
      ) : null}

      <Button
        type="submit"
        disabled={pending}
        className="w-fit transition-transform duration-150 active:scale-[0.98]"
      >
        {pending ? "Wird gespeichert …" : "Namen speichern"}
      </Button>
    </form>
  );
}
