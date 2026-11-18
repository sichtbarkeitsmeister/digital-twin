"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { Crown, UserMinus } from "lucide-react";

import type { ActionState } from "@/app/dashboard/actions";
import { clearOrganisationOwnerAction } from "@/app/dashboard/actions";
import { TransferOwnershipForm } from "@/app/dashboard/_components/transfer-ownership-form";
import { Button } from "@/components/ui/button";
import { CenteredModal } from "@/components/ui/centered-modal";

const initialState: ActionState = { ok: true, message: "" };

export function ChangeOwnerControls(props: {
  organisationId: string;
  currentOwnerEmail: string | null;
  canRemove: boolean;
}) {
  const [transfer, setTransfer] = useState(false);
  const [remove, setRemove] = useState(false);
  const [removeState, removeAction, removePending] = useActionState(
    clearOrganisationOwnerAction,
    initialState,
  );
  const lastRemoveMessage = useRef(removeState.message);
  const hasOwner = Boolean(props.currentOwnerEmail);

  useEffect(() => {
    if (removeState.message === lastRemoveMessage.current) return;
    lastRemoveMessage.current = removeState.message;
    if (removeState.ok && removeState.message) setRemove(false);
  }, [removeState]);

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setTransfer(true)}
        className="h-8 transition-transform duration-150 active:scale-[0.98]"
      >
        <Crown className="size-3.5" aria-hidden />
        {hasOwner ? "Inhaber ändern" : "Inhaber festlegen"}
      </Button>
      {props.canRemove && hasOwner ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setRemove(true)}
          className="h-8 transition-transform duration-150 active:scale-[0.98]"
        >
          <UserMinus className="size-3.5" aria-hidden />
          Inhaber entfernen
        </Button>
      ) : null}

      <CenteredModal
        open={transfer}
        title={hasOwner ? "Inhaber ändern" : "Inhaber festlegen"}
        description="Nur der bisherige Inhaber oder ein Plattform-Admin. Die neue Adresse bekommt volle Rechte."
        onClose={() => setTransfer(false)}
      >
        <TransferOwnershipForm
          organisationId={props.organisationId}
          currentOwnerEmail={props.currentOwnerEmail}
          onSuccess={() => setTransfer(false)}
        />
      </CenteredModal>

      <CenteredModal
        open={remove}
        title="Inhaber entfernen"
        description="Die Adresse verliert den Zugang als Inhaber. Danach hat die Organisation keinen Inhaber, bis ein neuer festgelegt wird."
        onClose={() => setRemove(false)}
      >
        <form action={removeAction} className="grid gap-4">
          <input type="hidden" name="organisation_id" value={props.organisationId} />
          <p className="text-sm text-secondary">
            {props.currentOwnerEmail ? (
              <>
                <span className="font-medium text-primary">{props.currentOwnerEmail}</span> wird
                aus dieser Organisation entfernt, ebenso eine offene Inhaber-Einladung an diese
                Adresse.
              </>
            ) : (
              "Der aktuelle Inhaber und offene Inhaber-Einladungen werden entfernt."
            )}
          </p>
          {removeState.message ? (
            <p
              className={removeState.ok ? "text-sm text-secondary" : "text-sm text-red-400"}
              role={removeState.ok ? "status" : "alert"}
            >
              {removeState.message}
            </p>
          ) : null}
          <Button
            type="submit"
            variant="destructive"
            disabled={removePending}
            className="transition-transform duration-150 active:scale-[0.98]"
          >
            {removePending ? "Wird entfernt…" : "Inhaber endgültig entfernen"}
          </Button>
        </form>
      </CenteredModal>
    </>
  );
}
