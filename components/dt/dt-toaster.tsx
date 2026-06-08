"use client";

import { useTheme } from "next-themes";
import { Toaster } from "sonner";

export function DtToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "rounded-dt border border-sbkm-navy/10 bg-white/95 text-sbkm-navy shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(46,46,80,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-sbkm-navy/95 dark:text-white",
        },
      }}
    />
  );
}
