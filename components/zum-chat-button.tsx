import Link from "next/link";
import { MessageSquare } from "lucide-react";

import { DtPillButton } from "@/components/dt/dt-pill-button";
import { cn } from "@/components/dt/cn";

export function ZumChatButton(props: {
  className?: string;
  size?: "sm" | "md" | "full";
  /** Compact icon+label for dense toolbars. */
  compact?: boolean;
}) {
  return (
    <DtPillButton
      asChild
      size={props.size ?? "sm"}
      variant="mint"
      className={cn(props.compact ? "inline-flex" : undefined, props.className)}
    >
      <Link href="/" prefetch aria-label="Zum DigitalTwin-Chat">
        <MessageSquare className="h-4 w-4" strokeWidth={2.2} aria-hidden />
        {props.compact ? (
          <span className="sm:hidden">Chat</span>
        ) : null}
        <span className={props.compact ? "hidden sm:inline" : undefined}>
          Zum Chat
        </span>
      </Link>
    </DtPillButton>
  );
}
