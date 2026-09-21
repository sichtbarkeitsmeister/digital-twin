import { Mail, Phone } from "lucide-react";

import {
  DT_ONBOARDING_CONTACTS,
  DT_ONBOARDING_PHONE_NOTE,
  DT_ONBOARDING_SUPPORT_NOTE,
  DT_ONBOARDING_SWITCHBOARD_PHONE,
  type DtOnboardingContact,
} from "@/lib/dt/onboarding/copy";

function initials(name: string): string {
  const parts = name
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function ContactPhoto({ contact }: { contact: DtOnboardingContact }) {
  if (contact.photoSrc) {
    return (
      <img
        src={contact.photoSrc}
        alt=""
        className="size-20 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <div
      className="grid size-20 shrink-0 place-items-center rounded-full bg-sbkm-mint/50 text-lg font-bold text-sbkm-navy dark:bg-sbkm-mint/20 dark:text-sbkm-mint"
      aria-hidden
    >
      {initials(contact.name)}
    </div>
  );
}

export function AnsprechpartnerTeam() {
  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-primary">
          Ansprechpartner
        </h1>
        <p className="max-w-2xl text-sm text-secondary">
          Team von Sichtbarkeitsmeister — Erreichbarkeit im Projekt.
        </p>
      </div>

      <ul className="grid gap-4 lg:grid-cols-2">
        {DT_ONBOARDING_CONTACTS.map((contact) => (
          <li
            key={contact.email}
            className="flex gap-4 rounded-2xl border border-sbkm-navy/10 bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.04]"
          >
            <ContactPhoto contact={contact} />
            <div className="min-w-0 grid gap-1">
              <p className="text-base font-semibold text-primary">{contact.name}</p>
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-sbkm-ink-500">
                {contact.shortRole}
              </p>
              <p className="text-sm leading-relaxed text-secondary">{contact.role}</p>
              <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <a
                  className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
                  href={`mailto:${contact.email}`}
                >
                  <Mail className="size-3.5" aria-hidden />
                  {contact.email}
                </a>
                <span className="inline-flex items-center gap-1 text-secondary">
                  <Phone className="size-3.5" aria-hidden />
                  {contact.extension}
                </span>
                {contact.mobile ? (
                  <span className="text-secondary">Mobil {contact.mobile}</span>
                ) : null}
              </p>
            </div>
          </li>
        ))}
      </ul>

      <div className="rounded-2xl border border-sbkm-navy/15 bg-sbkm-navy/[0.04] p-5 dark:border-white/15 dark:bg-white/[0.06]">
        <p className="text-sm leading-relaxed text-primary">{DT_ONBOARDING_SUPPORT_NOTE}</p>
        <p className="mt-4 text-sm leading-relaxed text-secondary">{DT_ONBOARDING_PHONE_NOTE}</p>
        <p className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-primary">
          <Phone className="size-4" aria-hidden />
          {DT_ONBOARDING_SWITCHBOARD_PHONE}
        </p>
      </div>
    </div>
  );
}
