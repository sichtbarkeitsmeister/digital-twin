import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/components/dt/cn";

const dtPillButtonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-pill font-bold tracking-[0.02em] transition-all duration-200 ease-dt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        mint: "bg-sbkm-mint text-sbkm-navy",
        solid: "bg-sbkm-navy text-white",
        outline:
          "bg-white/60 text-sbkm-navy shadow-[inset_0_0_0_1.5px_#2E2E50] dark:bg-transparent dark:text-white dark:shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.4)]",
        ghost: "bg-transparent text-sbkm-navy dark:text-white",
        navy: "bg-sbkm-navy text-white",
      },
      size: {
        sm: "px-[18px] py-2 text-[13.5px]",
        md: "px-6 py-3.5 text-[15px]",
        lg: "px-[30px] py-4 text-base",
        full: "w-full px-6 py-3.5 text-[15px]",
      },
    },
    defaultVariants: {
      variant: "mint",
      size: "md",
    },
  },
);

export type DtPillButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof dtPillButtonVariants> & {
    asChild?: boolean;
  };

export function DtPillButton({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: DtPillButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(
        dtPillButtonVariants({ variant, size }),
        "hover:-translate-y-px hover:bg-sbkm-navy hover:text-white hover:shadow-dt-hover dark:hover:bg-sbkm-mint dark:hover:text-sbkm-navy dark:hover:shadow-dt-mint",
        className,
      )}
      {...props}
    />
  );
}
