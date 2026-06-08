"use client";

import { motion } from "framer-motion";

export function OrganisationPageShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <motion.div
      className="grid gap-6"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      {children}
    </motion.div>
  );
}
