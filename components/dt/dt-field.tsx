import { cn } from "@/components/dt/cn";

type DtFieldProps = {
  label: React.ReactNode;
  htmlFor?: string;
  optional?: boolean;
  className?: string;
  children: React.ReactNode;
};

export function DtField({ label, htmlFor, optional, className, children }: DtFieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[12.5px] font-bold tracking-[0.01em] text-sbkm-navy dark:text-white">
        {label}
        {optional ? (
          <span className="font-normal text-sbkm-ink-500"> · optional</span>
        ) : null}
      </label>
      {children}
    </div>
  );
}

type DtInputWrapProps = React.HTMLAttributes<HTMLDivElement> & {
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
};

export function DtInputWrap({ icon, trailing, className, children, ...props }: DtInputWrapProps) {
  return (
    <div
      className={cn(
        "flex items-center rounded-[10px] border border-sbkm-navy/15 bg-white transition-[border-color,box-shadow] focus-within:border-sbkm-navy focus-within:shadow-dt-focus hover:border-sbkm-navy dark:border-white/15 dark:bg-sbkm-ink-900/80 dark:focus-within:border-sbkm-mint",
        className,
      )}
      {...props}
    >
      {icon ? <span className="ml-3.5 shrink-0 text-sbkm-ink-500">{icon}</span> : null}
      {children}
      {trailing}
    </div>
  );
}

export function DtInput({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "min-w-0 flex-1 border-0 bg-transparent px-3.5 py-3 text-sm text-sbkm-navy outline-none placeholder:text-sbkm-ink-500 dark:text-white",
        className,
      )}
      {...props}
    />
  );
}

export function DtTextarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-[120px] w-full rounded-[10px] border border-sbkm-navy/15 bg-white px-3.5 py-3 text-sm text-sbkm-navy outline-none transition-[border-color,box-shadow] placeholder:text-sbkm-ink-500 focus:border-sbkm-navy focus:shadow-dt-focus hover:border-sbkm-navy dark:border-white/15 dark:bg-sbkm-ink-900/80 dark:text-white dark:focus:border-sbkm-mint",
        className,
      )}
      {...props}
    />
  );
}
