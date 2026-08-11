import { ExternalLink } from "lucide-react";

import { DtPillButton } from "@/components/dt/dt-pill-button";
import { cn } from "@/components/dt/cn";

/** Turn a stored website URL into a safe absolute href. */
export function normalizeWebsiteHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function websiteHostnameLabel(raw: string): string {
  const href = normalizeWebsiteHref(raw);
  if (!href) return "Website";
  try {
    return new URL(href).hostname.replace(/^www\./, "") || "Website";
  } catch {
    return "Website";
  }
}

/** Pill button that opens the organisation website in a new tab. */
export function DtOrgWebsiteButton(props: {
  websiteUrl: string | null | undefined;
  className?: string;
  size?: "sm" | "md";
  /** Prefer hostname label (e.g. intensivpflege-ayags.de) over generic "Website". */
  showHostname?: boolean;
}) {
  const href = props.websiteUrl ? normalizeWebsiteHref(props.websiteUrl) : null;
  if (!href) return null;

  const label = props.showHostname === false ? "Website" : websiteHostnameLabel(href);

  return (
    <DtPillButton
      asChild
      size={props.size ?? "sm"}
      variant="outline"
      className={cn("max-w-[14rem] shrink-0", props.className)}
    >
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Website öffnen: ${label}`}
        title={href}
      >
        <ExternalLink className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} aria-hidden />
        <span className="truncate">{label}</span>
      </a>
    </DtPillButton>
  );
}
