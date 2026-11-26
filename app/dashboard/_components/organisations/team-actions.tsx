"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CenteredModal } from "@/components/ui/centered-modal";
import { InviteMemberForm } from "@/app/dashboard/_components/invite-member-form";

export function TeamActions(props: {
  organisationId: string;
}) {
  const [invite, setInvite] = useState(false);

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
    </>
  );
}
