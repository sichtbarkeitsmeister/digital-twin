import Image from "next/image";
import Link from "next/link";
import { cn } from "@/components/dt/cn";

type DtLogoProps = {
  href?: string;
  className?: string;
  size?: "sm" | "md" | "lg" | "auth" | "header" | "sidebar" | "compact";
};

const sizeClasses = {
  sm: "h-8 sm:h-9",
  md: "h-9 sm:h-10",
  lg: "h-10 sm:h-11",
  auth: "h-9 sm:h-10",
  header: "h-8 sm:h-9 md:h-10",
  sidebar: "h-8 sm:h-9",
  compact: "h-6 max-w-[7.5rem] sm:h-7 sm:max-w-[8.5rem]",
};

export function DtLogo({ href = "/", className, size = "md" }: DtLogoProps) {
  const imageClassName = cn(
    "w-auto object-contain object-left",
    sizeClasses[size],
    className,
  );

  const image = (
    <>
      {/* digitaltwin-logo-dark = indigo wordmark for light backgrounds */}
      <Image
        src="/assets/digitaltwin-logo-dark.png"
        alt="Digital Twin"
        width={1059}
        height={173}
        priority
        className={cn(imageClassName, "dark:hidden")}
      />
      {/* digitaltwin-logo-white = white wordmark for dark backgrounds */}
      <Image
        src="/assets/digitaltwin-logo-white.png"
        alt="Digital Twin"
        width={1059}
        height={173}
        priority
        className={cn(imageClassName, "hidden dark:block")}
      />
    </>
  );

  if (!href) {
    return <span className="inline-flex shrink-0 items-center">{image}</span>;
  }

  return (
    <Link href={href} className="inline-flex shrink-0 items-center" aria-label="Digital Twin">
      {image}
    </Link>
  );
}
