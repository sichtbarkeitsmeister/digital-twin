import { cn } from "@/components/dt/cn";

type DtStatTileProps = {
  label: string;
  value: string;
  description: string;
  className?: string;
};

export function DtStatTile({ label, value, description, className }: DtStatTileProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-dt border border-white/[0.06] bg-sbkm-navy p-6 text-white dark:border-white/10 dark:bg-white/[0.05]",
        "before:pointer-events-none before:absolute before:-right-10 before:-top-10 before:h-[140px] before:w-[140px] before:rounded-full before:bg-[radial-gradient(circle,rgba(100,253,194,0.18),transparent_70%)]",
        className,
      )}
    >
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/55">
        {label}
      </div>
      <div className="mt-3 text-[clamp(2rem,2vw+1rem,2.8rem)] font-bold leading-none tracking-[-0.03em] text-sbkm-mint">
        {value}
      </div>
      <div className="mt-3 text-[12.5px] text-white/70">{description}</div>
    </div>
  );
}
