"use client";

import { useState } from "react";

import { InviteMemberForm } from "@/app/dashboard/_components/invite-member-form";
import { Button } from "@/components/ui/button";
import { CenteredModal } from "@/components/ui/centered-modal";

export function ResendInviteButton({
  organisationId,
  email,
  canGrantPlatformAdmin = false,
}: {
  organisationId: string;
  email: string;
  canGrantPlatformAdmin?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="transition-transform duration-150 active:scale-[0.98]"
      >
        E-Mail erneut
      </Button>
      {status ? (
        <span className="max-w-[12rem] text-right text-xs text-secondary">{status}</span>
      ) : null}

      <CenteredModal
        open={open}
        title="Einladungs-E-Mail erneut senden"
        description={`An ${email}`}
        onClose={() => setOpen(false)}
      >
        <InviteMemberForm
          organisationId={organisationId}
          initialEmail={email}
          submitLabel="E-Mail erneut senden"
          canGrantPlatformAdmin={canGrantPlatformAdmin}
          onSuccess={(message) => {
            setStatus(message);
            setOpen(false);
          }}
        />
      </CenteredModal>
    </>
  );
}
