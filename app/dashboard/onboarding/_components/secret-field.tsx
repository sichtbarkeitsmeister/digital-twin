"use client";

import { useState } from "react";
import { Copy, Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function SecretField(props: {
  id: string;
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  autoComplete?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "ok" | "error">("idle");
  const editable = Boolean(props.onChange) && !props.readOnly;

  async function copy() {
    try {
      await navigator.clipboard.writeText(props.value);
      setCopyState("ok");
      window.setTimeout(() => setCopyState("idle"), 1200);
    } catch {
      setCopyState("error");
      window.setTimeout(() => setCopyState("idle"), 1600);
    }
  }

  return (
    <div className="flex gap-2">
      <Input
        id={props.id}
        type={visible ? "text" : "password"}
        value={props.value}
        onChange={editable ? (e) => props.onChange?.(e.target.value) : undefined}
        placeholder={props.placeholder}
        disabled={props.disabled}
        readOnly={!editable}
        autoComplete={props.autoComplete ?? "off"}
        className={cn(!editable && "bg-muted/40")}
      />
      <Button
        type="button"
        size="icon"
        variant="outline"
        className="shrink-0"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Passwort verbergen" : "Passwort anzeigen"}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="shrink-0"
        onClick={() => void copy()}
        disabled={!props.value}
      >
        <Copy className="size-4" />
        {copyState === "ok" ? "Kopiert" : copyState === "error" ? "Fehler" : "Kopieren"}
      </Button>
    </div>
  );
}
