import Link from "next/link";
import { MessageSquare } from "lucide-react";

import { DtPillButton } from "@/components/dt/dt-pill-button";
import { cn } from "@/components/dt/cn";

export function ZumChatButton(props: {
  className?: string;
  size?: "sm" | "md" | "full";
  /** Dense toolbars: icon only below `sm`, icon + label from `sm`. */
  compact?: boolean;
}) {
  return (
    <DtPillButton
      asChild
      size={props.size ?? "sm"}
      variant="mint"
      className={cn(
        props.compact ? "inline-flex max-sm:h-10 max-sm:w-10 max-sm:px-0" : undefined,
        props.className,
      )}
    >
      <Link href="/" prefetch aria-label="Zum DigitalTwin-Chat">
        <MessageSquare className="h-4 w-4" strokeWidth={2.2} aria-hidden />
        <span className={props.compact ? "hidden sm:inline" : undefined}>
          Zum Chat
        </span>
      </Link>
    </DtPillButton>
  );
}
