"use client";

import { useState } from "react";
import { Crown, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CenteredModal } from "@/components/ui/centered-modal";
import { InviteMemberForm } from "@/app/dashboard/_components/invite-member-form";
import { TransferOwnershipForm } from "@/app/dashboard/_components/transfer-ownership-form";

export function TeamActions(props: {
  organisationId: string;
  canTransferOwnership: boolean;
}) {
  const [invite, setInvite] = useState(false);
  const [transfer, setTransfer] = useState(false);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => setInvite(true)}
          className="transition-transform duration-150 active:scale-[0.98]"
        >
          <UserPlus className="size-3.5" aria-hidden />
          Mitglied einladen
        </Button>
        {props.canTransferOwnership ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setTransfer(true)}
            className="transition-transform duration-150 active:scale-[0.98]"
          >
            <Crown className="size-3.5" aria-hidden />
            Ownership
          </Button>
        ) : null}
      </div>

      <CenteredModal
        open={invite}
        title="Mitglied einladen"
        description="Es wird eine Einladungs-E-Mail mit Magic Link gesendet. Das Fenster bleibt offen, falls der Versand fehlschlägt."
        onClose={() => setInvite(false)}
      >
        <InviteMemberForm
          organisationId={props.organisationId}
          onSuccess={() => setInvite(false)}
        />
      </CenteredModal>

      <CenteredModal
        open={transfer}
        title="Ownership übertragen"
        description="Nur Inhaber oder Plattform-Admin."
        onClose={() => setTransfer(false)}
      >
        <TransferOwnershipForm
          organisationId={props.organisationId}
          onSuccess={() => setTransfer(false)}
        />
      </CenteredModal>
    </>
  );
}
