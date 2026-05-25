import { cn } from "@/components/dt/cn";

type DtIconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: "sm" | "md";
};

export function DtIconButton({
  className,
  size = "md",
  children,
  ...props
}: DtIconButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-grid place-items-center rounded-pill border-0 bg-white/60 text-sbkm-navy transition-colors hover:bg-sbkm-navy/10 dark:bg-white/10 dark:text-white dark:hover:bg-white/15",
        size === "md" ? "h-10 w-10" : "h-9 w-9",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
