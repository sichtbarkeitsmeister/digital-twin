import Link from "next/link";
import { cn } from "@/components/dt/cn";

type DtNavLinkProps = {
  href: string;
  children: React.ReactNode;
  className?: string;
  external?: boolean;
  onClick?: () => void;
};

export function DtNavLink({
  href,
  children,
  className,
  external,
  onClick,
}: DtNavLinkProps) {
  const classes = cn(
    "relative px-0.5 py-1.5 text-sm font-medium text-sbkm-navy transition-colors after:absolute after:inset-x-0.5 after:bottom-0.5 after:h-px after:origin-left after:scale-x-0 after:bg-sbkm-navy after:transition-transform after:duration-[420ms] after:ease-dt hover:after:scale-x-100 dark:text-white dark:after:bg-sbkm-mint",
    className,
  );

  if (external) {
    return (
      <a
        href={href}
        className={classes}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
      >
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={classes} onClick={onClick}>
      {children}
    </Link>
  );
}
