"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/dashboard/actions";
import { revokeOrganisationInviteAction } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";

const initialState: ActionState = { ok: true, message: "" };

export function RevokeInviteButton({
  inviteId,
  organisationId,
}: {
  inviteId: string;
  organisationId: string;
}) {
  const [state, formAction, pending] = useActionState(
    revokeOrganisationInviteAction,
    initialState,
  );

  return (
    <form
      action={formAction}
      className="flex items-center gap-2"
      onSubmit={(e) => {
        if (!window.confirm("Einladung wirklich löschen? Danach kannst du die Person erneut einladen.")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="invite_id" value={inviteId} />
      <input type="hidden" name="organisation_id" value={organisationId} />
      <Button
        type="submit"
        size="sm"
        variant="destructive"
        disabled={pending}
        className="transition-transform duration-150 active:scale-[0.98]"
      >
        {pending ? "Löschen…" : "Löschen"}
      </Button>
      {state.message && !state.ok ? (
        <span className="text-xs text-red-400">{state.message}</span>
      ) : null}
    </form>
  );
}
