import { cn } from "@/components/dt/cn";

type DtHeadingProps = {
  as?: "h1" | "h2" | "h3" | "h4" | "p";
  variant?: "display" | "hero" | "h2" | "h3" | "h4";
  children: React.ReactNode;
  className?: string;
};

const variantClasses = {
  display:
    "font-display text-display font-medium uppercase tracking-[-0.005em] text-balance",
  hero: "font-display text-hero-display font-medium uppercase tracking-[-0.005em] text-balance",
  h2: "text-[clamp(1.75rem,1.6vw+1rem,2.5rem)] font-bold leading-[1.1] tracking-[-0.02em] text-balance",
  h3: "text-[clamp(1.375rem,0.8vw+1rem,1.75rem)] font-bold leading-snug tracking-[-0.015em]",
  h4: "text-lg font-bold leading-snug",
};

export function DtHeading({
  as: Tag = "h2",
  variant = "h2",
  children,
  className,
}: DtHeadingProps) {
  return (
    <Tag className={cn("text-sbkm-navy dark:text-white", variantClasses[variant], className)}>
      {children}
    </Tag>
  );
}
