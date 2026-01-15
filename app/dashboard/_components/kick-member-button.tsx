"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/dashboard/actions";
import { kickFromOrganisationAction } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";

const initialState: ActionState = { ok: true, message: "" };

export function KickMemberButton({
  organisationId,
  targetUserId,
}: {
  organisationId: string;
  targetUserId: string;
}) {
  const [state, formAction, pending] = useActionState(
    kickFromOrganisationAction,
    initialState,
  );

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="organisation_id" value={organisationId} />
      <input type="hidden" name="target_user_id" value={targetUserId} />
      <Button type="submit" size="sm" variant="destructive" disabled={pending}>
        {pending ? "Removing…" : "Kick"}
      </Button>
      {state.message && !state.ok ? (
        <span className="text-xs text-red-400">{state.message}</span>
      ) : null}
    </form>
  );
}

