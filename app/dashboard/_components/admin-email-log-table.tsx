"use client";

import { motion } from "framer-motion";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type EmailLogRow = {
  id: string;
  kind: string;
  status: string;
  to_addresses: string[] | null;
  subject: string;
  error_message: string | null;
  smtp_message_id: string | null;
  created_at: string;
};

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  sent: "outline",
  skipped: "secondary",
  failed: "destructive",
};

const STATUS_LABEL: Record<string, string> = {
  sent: "Gesendet",
  skipped: "Übersprungen",
  failed: "Fehlgeschlagen",
};

function formatTimestamp(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("de-DE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatKind(kind: string) {
  if (kind === "owner_welcome") return "Inhaber-Willkommen";
  if (kind === "test") return "Test";
  if (kind === "generic") return "Allgemein";
  return kind;
}

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

const item = {
  hidden: { opacity: 0, y: 4 },
  show: { opacity: 1, y: 0, transition: { duration: 0.2 } },
};

export function AdminEmailLogTable({ logs }: { logs: EmailLogRow[] }) {
  return (
    <div className="min-w-0 overflow-x-auto rounded-xl border border-sbkm-navy/8 dark:border-white/8">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-sbkm-navy/8 bg-sbkm-navy/[0.03] text-[11px] font-semibold uppercase tracking-wide text-secondary dark:border-white/8 dark:bg-white/[0.03]">
            <th className="px-3 py-2.5 font-medium">Zeit</th>
            <th className="px-3 py-2.5 font-medium">Status</th>
            <th className="px-3 py-2.5 font-medium">Typ</th>
            <th className="px-3 py-2.5 font-medium">Empfänger</th>
            <th className="px-3 py-2.5 font-medium">Betreff</th>
            <th className="px-3 py-2.5 font-medium">Details</th>
          </tr>
        </thead>
        <motion.tbody variants={container} initial="hidden" animate="show">
          {logs.map((log) => (
            <motion.tr
              key={log.id}
              variants={item}
              className="border-b border-sbkm-navy/6 transition-colors duration-150 hover:bg-sbkm-navy/[0.03] dark:border-white/6 dark:hover:bg-white/[0.03]"
            >
              <td className="whitespace-nowrap px-3 py-3 text-xs tabular-nums text-secondary">
                {formatTimestamp(log.created_at)}
              </td>
              <td className="px-3 py-3">
                <Badge variant={STATUS_VARIANT[log.status] ?? "secondary"}>
                  {STATUS_LABEL[log.status] ?? log.status}
                </Badge>
              </td>
              <td className="px-3 py-3 text-xs text-primary">{formatKind(log.kind)}</td>
              <td className="max-w-[10rem] px-3 py-3">
                <span className="block truncate text-xs" title={(log.to_addresses ?? []).join(", ")}>
                  {(log.to_addresses ?? []).join(", ") || "—"}
                </span>
              </td>
              <td className="max-w-[12rem] px-3 py-3">
                <span className="block truncate text-xs text-primary" title={log.subject}>
                  {log.subject}
                </span>
              </td>
              <td className="max-w-[14rem] px-3 py-3">
                {log.error_message ? (
                  <span
                    className="block text-xs text-destructive"
                    title={log.error_message}
                  >
                    {log.error_message}
                  </span>
                ) : log.smtp_message_id ? (
                  <span
                    className={cn(
                      "block truncate font-mono text-[11px] text-secondary",
                    )}
                    title={log.smtp_message_id}
                  >
                    {log.smtp_message_id}
                  </span>
                ) : (
                  <span className="text-xs text-secondary">—</span>
                )}
              </td>
            </motion.tr>
          ))}
        </motion.tbody>
      </table>
    </div>
  );
}
