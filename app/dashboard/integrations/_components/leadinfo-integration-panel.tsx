"use client";

import { useActionState } from "react";

import {
  generateLeadinfoIntegrationAction,
  rotateLeadinfoTokenAction,
  setLeadinfoStatusAction,
  type IntegrationActionState,
} from "@/app/dashboard/integrations/actions";
import { CopyTextButton } from "@/app/dashboard/integrations/_components/copy-text-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const initialState: IntegrationActionState = { ok: true, message: "" };

export function LeadinfoIntegrationPanel({
  organisationId,
  webhookUrl,
  status,
}: {
  organisationId: string;
  webhookUrl: string | null;
  status: "enabled" | "disabled" | null;
}) {
  const [generateState, generateAction, generatePending] = useActionState(
    generateLeadinfoIntegrationAction,
    initialState,
  );
  const [rotateState, rotateAction, rotatePending] = useActionState(
    rotateLeadinfoTokenAction,
    initialState,
  );
  const [statusState, statusAction, statusPending] = useActionState(
    setLeadinfoStatusAction,
    initialState,
  );

  const displayUrl = generateState.webhookUrl ?? rotateState.webhookUrl ?? statusState.webhookUrl ?? webhookUrl;
  const feedbackMessage =
    generateState.message || rotateState.message || statusState.message || "";
  const feedbackOk =
    generateState.message
      ? generateState.ok
      : rotateState.message
        ? rotateState.ok
        : statusState.message
          ? statusState.ok
          : true;

  if (!displayUrl) {
    return (
      <div className="grid gap-4">
        <p className="text-sm text-secondary">
          Generate a webhook URL for this organisation, then paste it into Leadinfo.
        </p>
        <form action={generateAction}>
          <input type="hidden" name="organisation_id" value={organisationId} />
          <Button type="submit" disabled={generatePending}>
            {generatePending ? "Generating…" : "Generate webhook URL"}
          </Button>
        </form>
        {feedbackMessage ? (
          <p className={feedbackOk ? "text-sm text-secondary" : "text-sm text-red-400"}>
            {feedbackMessage}
          </p>
        ) : null}
      </div>
    );
  }

  const currentStatus = status ?? "enabled";

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={currentStatus === "enabled" ? "default" : "secondary"}>
          {currentStatus === "enabled" ? "Enabled" : "Disabled"}
        </Badge>
      </div>

      <div className="grid gap-2">
        <p className="text-sm font-medium text-primary">Webhook URL</p>
        <div className="flex flex-wrap items-center gap-2">
          <Input readOnly value={displayUrl} className="font-mono text-xs" />
          <CopyTextButton value={displayUrl} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <form action={rotateAction}>
          <input type="hidden" name="organisation_id" value={organisationId} />
          <Button type="submit" variant="outline" disabled={rotatePending}>
            {rotatePending ? "Rotating…" : "Rotate token"}
          </Button>
        </form>

        <form action={statusAction}>
          <input type="hidden" name="organisation_id" value={organisationId} />
          <input
            type="hidden"
            name="status"
            value={currentStatus === "enabled" ? "disabled" : "enabled"}
          />
          <Button type="submit" variant="outline" disabled={statusPending}>
            {statusPending
              ? "Saving…"
              : currentStatus === "enabled"
                ? "Disable"
                : "Enable"}
          </Button>
        </form>
      </div>

      {feedbackMessage ? (
        <p className={feedbackOk ? "text-sm text-secondary" : "text-sm text-red-400"}>
          {feedbackMessage}
        </p>
      ) : null}

      <div className="rounded-lg border bg-muted/20 p-4 text-sm text-secondary">
        <p className="font-medium text-primary">Leadinfo setup</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Open Leadinfo → Settings → Integrations → Webhooks.</li>
          <li>Create a webhook and paste the URL above.</li>
          <li>Trigger a test event and inspect it under Received events.</li>
        </ol>
      </div>
    </div>
  );
}
