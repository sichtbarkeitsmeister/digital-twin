"use client";

import * as React from "react";
import { Copy } from "lucide-react";

import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";

export function CopyToClipboardButton({
  text,
  className,
  label = "Kopieren",
}: {
  text: string;
  className?: string;
  label?: string;
}) {
  const [status, setStatus] = React.useState<"idle" | "ok" | "error">("idle");

  async function onCopy() {
    try {
      const toCopy = text.startsWith("/") ? `${window.location.origin}${text}` : text;
      await navigator.clipboard.writeText(toCopy);
      setStatus("ok");
      window.setTimeout(() => setStatus("idle"), 1200);
    } catch {
      setStatus("error");
      window.setTimeout(() => setStatus("idle"), 1600);
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={onCopy}
      className={cn(className)}
      aria-label={label}
    >
      <Copy className="mr-2 h-4 w-4" />
      {status === "ok" ? "Kopiert" : status === "error" ? "Kopieren fehlgeschlagen" : label}
    </Button>
  );
}

