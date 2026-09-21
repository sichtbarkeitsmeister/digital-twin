import { Mail, Phone } from "lucide-react";

import {
  DT_ONBOARDING_CONTACTS,
  DT_ONBOARDING_SUPPORT_EMAIL,
  DT_ONBOARDING_SWITCHBOARD_PHONE,
} from "@/lib/dt/onboarding/copy";
import { cn } from "@/lib/utils";

export function OnboardingContacts({
  variant = "sidebar",
  className,
}: {
  variant?: "sidebar" | "page";
  className?: string;
}) {
  const compact = variant === "sidebar";

  return (
    <div
      className={cn(
        compact
          ? "rounded-xl border border-sbkm-navy/10 bg-white/50 px-2.5 py-2.5 dark:border-white/10 dark:bg-white/[0.04]"
          : "grid gap-3",
        className,
      )}
    >
      <p
        className={cn(
          "font-bold text-primary",
          compact
            ? "px-0.5 text-[11px] uppercase tracking-[0.12em] text-sbkm-ink-500"
            : "text-sm",
        )}
      >
        Direkte Ansprechpartner
      </p>
      <ul className={cn("grid", compact ? "mt-2 gap-2" : "gap-3")}>
        {DT_ONBOARDING_CONTACTS.map((contact) => (
          <li key={contact.email} className={compact ? "min-w-0" : undefined}>
            <p className={cn("truncate font-semibold text-primary", compact ? "text-xs" : "text-sm")}>
              {contact.name}
            </p>
            <p className={cn("text-secondary", compact ? "text-[11px]" : "text-xs")}>
              {contact.shortRole}
            </p>
            <a
              className={cn(
                "mt-0.5 block truncate font-medium text-primary underline-offset-2 hover:underline",
                compact ? "text-[11px]" : "text-xs",
              )}
              href={`mailto:${contact.email}`}
              title={contact.email}
            >
              {contact.email}
            </a>
            <p className={cn("text-secondary", compact ? "text-[11px]" : "text-xs")}>
              {contact.extension}
              {contact.mobile ? ` · ${contact.mobile}` : ""}
            </p>
          </li>
        ))}
      </ul>
      <div
        className={cn(
          "grid gap-1 border-t border-sbkm-navy/10 pt-2 dark:border-white/10",
          compact ? "mt-2" : "mt-1",
        )}
      >
        <a
          className={cn(
            "inline-flex min-w-0 items-center gap-1 truncate font-semibold text-primary underline-offset-2 hover:underline",
            compact ? "text-[11px]" : "text-sm",
          )}
          href={`mailto:${DT_ONBOARDING_SUPPORT_EMAIL}`}
        >
          <Mail className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{DT_ONBOARDING_SUPPORT_EMAIL}</span>
        </a>
        <p
          className={cn(
            "inline-flex items-center gap-1 text-secondary",
            compact ? "text-[11px]" : "text-sm",
          )}
        >
          <Phone className="size-3 shrink-0" aria-hidden />
          {DT_ONBOARDING_SWITCHBOARD_PHONE}
        </p>
      </div>
    </div>
  );
}
