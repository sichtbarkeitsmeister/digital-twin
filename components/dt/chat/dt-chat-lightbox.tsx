"use client";

import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export function DtChatLightbox(props: {
  src: string | null;
  alt?: string;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {props.src ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-sbkm-navy/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Bildvorschau"
          onClick={props.onClose}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full bg-white/90 p-2 text-sbkm-navy shadow-dt hover:bg-white"
            aria-label="Schließen"
            onClick={props.onClose}
          >
            <X className="h-5 w-5" />
          </button>
          <motion.img
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2 }}
            src={props.src}
            alt={props.alt ?? ""}
            className="max-h-[90vh] max-w-full rounded-dt object-contain shadow-dt-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
