import { cn } from "@/components/dt/cn";

type DtPageShellProps = {
  children: React.ReactNode;
  className?: string;
  variant?: "marketing" | "auth" | "dashboard" | "plain";
};

export function DtPageShell({
  children,
  className,
  variant = "marketing",
}: DtPageShellProps) {
  return (
    <div
      className={cn(
        "min-h-screen text-sbkm-navy antialiased",
        variant === "dashboard"
          ? "bg-sbkm-canvas bg-dt-dashboard dark:bg-sbkm-ink-900 dark:bg-dt-dashboard-dark dark:text-white"
          : "bg-sbkm-canvas bg-dt-page dark:bg-sbkm-ink-900 dark:bg-dt-page-dark dark:text-white",
        className,
      )}
    >
      {children}
    </div>
  );
}
