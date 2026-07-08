"use client";

import { useActionState, useEffect, useRef } from "react";
import type { ActionState } from "@/app/dashboard/actions";
import { inviteToOrganisationAction } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const initialState: ActionState = { ok: true, message: "" };

export function InviteMemberForm({
  organisationId,
  onSuccess,
}: {
  organisationId: string;
  onSuccess?: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    inviteToOrganisationAction,
    initialState,
  );
  const lastMessage = useRef(state.message);

  useEffect(() => {
    if (state.message !== lastMessage.current) {
      lastMessage.current = state.message;
      if (state.ok && state.message) onSuccess?.();
    }
  }, [state, onSuccess]);

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="organisation_id" value={organisationId} />

      <div className="grid gap-2">
        <Label htmlFor="invited_email">E-Mail</Label>
        <Input
          id="invited_email"
          name="invited_email"
          type="email"
          placeholder="kollege@firma.de"
          autoComplete="email"
          required
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="role">Rolle</Label>
        <Select id="role" name="role" defaultValue="employee" required>
          <option value="employee">Mitarbeiter</option>
          <option value="admin">Admin</option>
        </Select>
      </div>

      {state.message ? (
        <p className={state.ok ? "text-sm text-secondary" : "text-sm text-red-400"}>
          {state.message}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="active:scale-[0.98]">
        {pending ? "Wird gesendet …" : "Einladen"}
      </Button>
    </form>
  );
}

