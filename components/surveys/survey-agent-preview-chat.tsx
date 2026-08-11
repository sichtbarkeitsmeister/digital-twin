"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type PreviewChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export function SurveyAgentPreviewChat(props: {
  organisationId: string;
  agentName: string;
  agentRole: string | null;
  promptTemplate: string;
  disabled?: boolean;
  className?: string;
}) {
  const [messages, setMessages] = useState<PreviewChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const promptKeyRef = useRef(props.promptTemplate);

  // Reset thread when the preview persona changes substantially.
  useEffect(() => {
    if (promptKeyRef.current === props.promptTemplate) return;
    promptKeyRef.current = props.promptTemplate;
    setMessages([]);
    setError(null);
  }, [props.promptTemplate, props.agentName]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, busy]);

  async function send() {
    const content = draft.trim();
    if (!content || busy || props.disabled) return;
    if (!props.organisationId) {
      setError("Bitte zuerst eine Organisation wählen.");
      return;
    }
    if (props.promptTemplate.trim().length < 40) {
      setError("Persona-Prompt ist noch zu kurz für einen Probe-Chat.");
      return;
    }

    const userMsg: PreviewChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content,
    };
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, userMsg]);
    setDraft("");
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/dt/preview-agent-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organisationId: props.organisationId,
          name: props.agentName,
          role: props.agentRole,
          promptTemplate: props.promptTemplate,
          content,
          history,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        reply?: string;
        message?: string;
      };
      if (!json.ok || !json.reply?.trim()) {
        setError(json.message ?? "Antwort fehlgeschlagen.");
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: json.reply!.trim(),
        },
      ]);
    } catch {
      setError("Netzwerkfehler — bitte erneut versuchen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      className={cn(
        "shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)]",
        props.className,
      )}
    >
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircle className="size-4 text-sbkm-mint" aria-hidden />
          Probe-Chat mit {props.agentName}
        </CardTitle>
        <CardDescription>
          Stelle Fragen an die Vorschau — wird nicht gespeichert. Nutzt den aktuellen
          Persona-Prompt oben.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="max-h-72 space-y-3 overflow-y-auto rounded-xl border border-border bg-muted/20 p-3">
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Noch keine Nachrichten. z.&nbsp;B. „Welche Fachbegriffe kennst du nicht?“
            </p>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "max-w-[92%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap",
                  m.role === "user"
                    ? "ml-auto bg-sbkm-navy text-white"
                    : "mr-auto bg-white text-sbkm-navy shadow-sm dark:bg-white/10 dark:text-white",
                )}
              >
                {m.content}
              </div>
            ))
          )}
          {busy ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {props.agentName} antwortet …
            </p>
          ) : null}
          <div ref={bottomRef} />
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Nachricht an ${props.agentName}…`}
            rows={2}
            disabled={busy || props.disabled}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            className="min-h-[72px] flex-1"
          />
          <Button
            type="button"
            disabled={busy || props.disabled || !draft.trim()}
            onClick={() => void send()}
            className="shrink-0 gap-1.5"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Send className="size-4" aria-hidden />
            )}
            Fragen
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
