"use client";

import { motion } from "framer-motion";

const shimmer =
  "animate-dt-shimmer rounded-2xl bg-gradient-to-r from-sbkm-navy/8 via-sbkm-navy/14 to-sbkm-navy/8 bg-[length:200%_100%] dark:from-white/6 dark:via-white/12 dark:to-white/6";

export function DtChatSkeleton() {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      aria-busy
      aria-label="Chat wird geladen"
    >
      <div className="scrollbar-subtle flex min-h-0 flex-1 flex-col justify-start overflow-x-hidden overflow-y-auto overscroll-y-contain px-4 py-6 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="mx-auto flex w-full max-w-3xl flex-col gap-3"
        >
          <div className={`h-14 w-[58%] ${shimmer}`} />
          <div className={`h-20 w-[78%] self-end ${shimmer}`} />
          <div className={`h-16 w-[65%] ${shimmer}`} />
        </motion.div>
      </div>
      <p className="shrink-0 border-t border-sbkm-navy/8 px-6 py-2 text-center text-xs text-sbkm-ink-500 dark:border-white/8 dark:text-white/45">
        Verlauf wird geladen …
      </p>
    </div>
  );
}
