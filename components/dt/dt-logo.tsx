import Image from "next/image";
import Link from "next/link";
import { cn } from "@/components/dt/cn";

type DtLogoProps = {
  href?: string;
  className?: string;
  size?: "sm" | "md" | "lg" | "auth" | "header" | "sidebar" | "compact";
};

const sizeClasses = {
  sm: "h-16 sm:h-[4.5rem]",
  md: "h-[4.5rem] sm:h-[5.5rem]",
  lg: "h-[5.5rem] sm:h-[5.5rem]",
  auth: "h-14 sm:h-16",
  header: "h-11 sm:h-12 md:h-14",
  sidebar: "h-11 sm:h-12",
  compact: "h-6 max-w-[5.5rem] sm:h-7 sm:max-w-[6.5rem]",
};

export function DtLogo({ href = "/", className, size = "md" }: DtLogoProps) {
  const image = (
    <Image
      src="/assets/digital-twin-logo.png"
      alt="DigitalTwin"
      width={320}
      height={88}
      priority
      className={cn(
        "w-auto object-contain dark:brightness-0 dark:invert",
        sizeClasses[size],
        className,
      )}
    />
  );

  if (!href) return image;

  return (
    <Link href={href} className="inline-flex shrink-0 items-center" aria-label="DigitalTwin">
      {image}
    </Link>
  );
}
