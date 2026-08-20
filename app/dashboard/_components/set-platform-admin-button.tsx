"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/dashboard/actions";
import { setPlatformAdminAction } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";

const initialState: ActionState = { ok: true, message: "" };

export function SetPlatformAdminButton({
  targetUserId,
  makeAdmin,
  label,
}: {
  targetUserId: string;
  makeAdmin: boolean;
  label?: string;
}) {
  const [state, formAction, pending] = useActionState(
    setPlatformAdminAction,
    initialState,
  );

  const confirmMessage = makeAdmin
    ? "Verwaltungszugang geben? Die Person kann danach Organisationen, Fragebögen und Umfragen anlegen."
    : "Verwaltungszugang wirklich entziehen?";

  return (
    <form
      action={formAction}
      className="flex items-center gap-2"
      onSubmit={(event) => {
        if (!window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="target_user_id" value={targetUserId} />
      {makeAdmin ? <input type="hidden" name="make_admin" value="on" /> : null}
      <Button
        type="submit"
        size="sm"
        variant={makeAdmin ? "outline" : "destructive"}
        disabled={pending}
        className="transition-transform duration-150 active:scale-[0.98]"
      >
        {pending
          ? "…"
          : (label ?? (makeAdmin ? "Verwaltungszugang" : "Zugang entziehen"))}
      </Button>
      {state.message && !state.ok ? (
        <span className="text-xs text-red-400">{state.message}</span>
      ) : null}
    </form>
  );
}
