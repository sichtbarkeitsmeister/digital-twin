import Link from "next/link";
import { cn } from "@/components/dt/cn";

type DtFooterProps = {
  className?: string;
  links?: Array<{ href: string; label: string }>;
};

const defaultLinks = [
  { href: "#", label: "Impressum" },
  { href: "#", label: "Datenschutz" },
  { href: "#", label: "Kontakt" },
];

export function DtFooter({ className, links = defaultLinks }: DtFooterProps) {
  return (
    <footer
      className={cn(
        "border-t border-sbkm-navy/[0.06] bg-white/40 px-5 py-8 backdrop-blur-[20px] backdrop-saturate-[160%] dark:border-white/10 dark:bg-sbkm-ink-900/55 sm:px-14",
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-dt flex-col items-center justify-between gap-3 text-[13px] text-sbkm-ink-600 dark:text-white/60 sm:flex-row">
        <span>
          © DigitalTwin. Powered by <strong className="text-sbkm-navy dark:text-white">sbkm.</strong>
        </span>
        <div className="hidden items-center gap-6 sm:flex">
          {links.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="relative px-0.5 py-1 text-sbkm-ink-600 transition-colors after:absolute after:inset-x-0.5 after:bottom-0 after:h-px after:origin-left after:scale-x-0 after:bg-sbkm-navy after:transition-transform after:duration-[420ms] after:ease-dt hover:text-sbkm-navy hover:after:scale-x-100 dark:text-white/60 dark:after:bg-sbkm-mint dark:hover:text-sbkm-mint"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </footer>
  );
}
