"use client";

import { ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";

export function DtGroundingBanner() {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-sbkm-mint/45 bg-sbkm-mint/15 px-3 py-2 text-sm text-sbkm-navy dark:border-sbkm-mint/30 dark:bg-sbkm-mint/10 dark:text-white sm:mx-6"
      role="status"
    >
      <ShieldCheck className="h-4 w-4 shrink-0 text-sbkm-navy dark:text-sbkm-mint" aria-hidden />
      <span>
        <strong className="font-semibold">Grounding Page aktiv:</strong> der SEO-Berater arbeitet
        nach Grounding Page Standard v1.7, plant Hub und Entitätsseiten und liefert fertige
        HTML-Dateien zum Einfügen auf der Website. Bestand und Freigabe im Tab „Grounding“.
      </span>
    </motion.div>
  );
}
