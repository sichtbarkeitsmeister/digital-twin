import { cn } from "@/components/dt/cn";

type DtMetaChipProps = {
  children: React.ReactNode;
  className?: string;
};

export function DtMetaChip({ children, className }: DtMetaChipProps) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-pill bg-sbkm-navy px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.06em] text-sbkm-mint dark:bg-white dark:text-sbkm-navy",
        className,
      )}
    >
      {children}
    </span>
  );
}
