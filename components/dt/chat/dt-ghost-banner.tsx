"use client";

import { Ghost } from "lucide-react";
import { motion } from "framer-motion";

export function DtGhostBanner() {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-amber-400/35 bg-amber-50/90 px-3 py-2 text-sm text-amber-950 dark:border-amber-300/25 dark:bg-amber-500/10 dark:text-amber-100 sm:mx-6"
      role="status"
    >
      <Ghost className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden />
      <span>
        <strong className="font-semibold">Ghost-Modus aktiv:</strong> nichts wird gespeichert. Der
        Verlauf verschwindet, wenn du den Modus beendest.
      </span>
    </motion.div>
  );
}
