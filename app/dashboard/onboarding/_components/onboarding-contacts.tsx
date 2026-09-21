import { Mail, Phone } from "lucide-react";

import {
  DT_ONBOARDING_CONTACTS,
  DT_ONBOARDING_PHONE_NOTE,
  DT_ONBOARDING_SUPPORT_EMAIL,
  DT_ONBOARDING_SUPPORT_NOTE,
} from "@/lib/dt/onboarding/copy";

export function OnboardingContacts() {
  return (
    <div className="grid gap-4">
      {DT_ONBOARDING_CONTACTS.map((contact) => (
        <div
          key={contact.email}
          className="rounded-xl border border-sbkm-navy/10 bg-white/50 px-4 py-3 dark:border-white/10 dark:bg-white/[0.04]"
        >
          <p className="text-sm font-semibold text-primary">{contact.name}</p>
          <p className="mt-1 text-sm leading-relaxed text-secondary">{contact.role}</p>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary">
            <a
              className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
              href={`mailto:${contact.email}`}
            >
              <Mail className="size-3.5" aria-hidden />
              {contact.email}
            </a>
            <span>Durchwahl {contact.extension}</span>
            {contact.mobile ? <span>Mobil {contact.mobile}</span> : null}
          </p>
        </div>
      ))}

      <div className="rounded-xl border border-sbkm-navy/15 bg-sbkm-navy/[0.04] px-4 py-3 dark:border-white/15 dark:bg-white/[0.06]">
        <p className="text-sm leading-relaxed text-primary">{DT_ONBOARDING_SUPPORT_NOTE}</p>
        <p className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary">
          <Mail className="size-3.5" aria-hidden />
          <a className="underline-offset-2 hover:underline" href={`mailto:${DT_ONBOARDING_SUPPORT_EMAIL}`}>
            {DT_ONBOARDING_SUPPORT_EMAIL}
          </a>
        </p>
        <p className="mt-3 text-sm leading-relaxed text-secondary">{DT_ONBOARDING_PHONE_NOTE}</p>
        <p className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary">
          <Phone className="size-3.5" aria-hidden />
          0211 - 97 26 53 60
        </p>
      </div>
    </div>
  );
}
