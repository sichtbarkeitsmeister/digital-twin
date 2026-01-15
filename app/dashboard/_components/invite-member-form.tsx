"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/dashboard/actions";
import { inviteToOrganisationAction } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: ActionState = { ok: true, message: "" };

export function InviteMemberForm({ organisationId }: { organisationId: string }) {
  const [state, formAction, pending] = useActionState(
    inviteToOrganisationAction,
    initialState,
  );

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="organisation_id" value={organisationId} />

      <div className="grid gap-2">
        <Label htmlFor="invited_email">E-Mail</Label>
        <Input
          id="invited_email"
          name="invited_email"
          type="email"
          placeholder="colleague@company.com"
          autoComplete="email"
          required
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="role">Role</Label>
        <select
          id="role"
          name="role"
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          defaultValue="employee"
          required
        >
          <option value="employee">Employee</option>
          <option value="admin">Admin</option>
        </select>
      </div>

      {state.message ? (
        <p className={state.ok ? "text-sm text-secondary" : "text-sm text-red-400"}>
          {state.message}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Invite"}
      </Button>
    </form>
  );
}

