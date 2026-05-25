import { cn } from "@/components/dt/cn";

type DtGlassCardProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: "default" | "solid" | "subtle" | "quote";
  padding?: "none" | "sm" | "md" | "lg";
};

const paddingClasses = {
  none: "",
  sm: "p-5 sm:p-6",
  md: "p-7 sm:p-8",
  lg: "p-7 sm:p-10",
};

export function DtGlassCard({
  className,
  variant = "default",
  padding = "md",
  children,
  ...props
}: DtGlassCardProps) {
  return (
    <div
      className={cn(
        "rounded-dt-lg border backdrop-blur-[32px] backdrop-saturate-[180%]",
        variant === "default" &&
          "border-sbkm-navy/10 bg-white/55 shadow-dt-lg dark:border-white/10 dark:bg-white/[0.06]",
        variant === "subtle" &&
          "border-sbkm-navy/10 bg-white/40 shadow-dt dark:border-white/10 dark:bg-white/[0.04]",
        variant === "solid" &&
          "border-sbkm-navy/10 bg-white shadow-dt dark:border-white/10 dark:bg-sbkm-ink-900/80",
        variant === "quote" &&
          "relative overflow-hidden border-transparent bg-sbkm-navy text-white shadow-dt-lg before:pointer-events-none before:absolute before:-right-10 before:-top-10 before:h-[140px] before:w-[140px] before:rounded-full before:bg-[radial-gradient(circle,rgba(100,253,194,0.20),transparent_70%)]",
        paddingClasses[padding],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
