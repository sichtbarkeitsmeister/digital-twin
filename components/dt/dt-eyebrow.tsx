import { cn } from "@/components/dt/cn";

type DtEyebrowProps = {
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
};

export function DtEyebrow({ children, className, dot = false }: DtEyebrowProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-pill bg-sbkm-mint px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-sbkm-navy",
        dot &&
          "before:h-1.5 before:w-1.5 before:rounded-full before:bg-sbkm-navy before:content-['']",
        className,
      )}
    >
      {children}
    </span>
  );
}
