"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

const sizeClass = {
  sm: "max-w-[min(100%,28rem)] max-h-[min(90dvh,640px)]",
  lg: "max-w-[min(100%,64rem)] max-h-[min(90dvh,900px)]",
} as const;

export function CenteredModal(props: {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  titleId?: string;
  size?: keyof typeof sizeClass;
  closeDisabled?: boolean;
  header?: ReactNode;
  bodyClassName?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const titleId = props.titleId ?? "centered-modal-title";

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!props.open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [props.open]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {props.open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-sbkm-navy/60 p-4 backdrop-blur-sm sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby={props.header || props.title ? titleId : undefined}
          onClick={props.closeDisabled ? undefined : props.onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "flex w-full flex-col overflow-hidden rounded-2xl border border-sbkm-navy/12 bg-white shadow-[0_24px_80px_rgba(0,0,0,0.35)] dark:border-white/12 dark:bg-[#1a1530]",
              sizeClass[props.size ?? "sm"],
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {props.header ?? (
              <div className="flex shrink-0 items-start justify-between gap-3 border-b border-sbkm-navy/10 px-5 py-4 dark:border-white/10">
                <div className="min-w-0">
                  {props.title ? (
                    <h2
                      id={titleId}
                      className="text-lg font-semibold tracking-tight text-sbkm-navy dark:text-white"
                    >
                      {props.title}
                    </h2>
                  ) : null}
                  {props.description ? (
                    <p className="mt-1 text-sm text-sbkm-ink-600 dark:text-white/55">
                      {props.description}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  aria-label="Schließen"
                  disabled={props.closeDisabled}
                  onClick={props.onClose}
                  className="rounded-full p-1.5 text-sbkm-ink-500 transition-colors hover:bg-sbkm-navy/5 hover:text-sbkm-navy disabled:opacity-50 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            )}

            <div
              className={cn(
                "min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6 sm:py-5",
                props.bodyClassName,
              )}
            >
              {props.children}
            </div>

            {props.footer ? (
              <div className="shrink-0 border-t border-sbkm-navy/10 px-5 py-4 dark:border-white/10 sm:px-6">
                {props.footer}
              </div>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
