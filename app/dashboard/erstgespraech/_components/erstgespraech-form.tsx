"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ClipboardPenLine, Loader2, MessageCircle } from "lucide-react";

import {
  loadErstgespraechAction,
  saveErstgespraechAction,
} from "@/app/dashboard/erstgespraech/actions";
import { OrganisationSwitcher } from "@/app/dashboard/_components/organisation-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  EMPTY_FIRST_CONVERSATION,
  FIRST_CONVERSATION_SECTIONS,
  firstConversationFilledCount,
  type FirstConversationFieldKey,
  type FirstConversationRecord,
} from "@/lib/surveys/first-conversation";

const CREATE_ORG_HREF = "/dashboard/admin/organisations#organisation-anlegen";

function formatUpdatedAt(value: string | null) {
  if (!value) return null;
  try {
    return new Date(value).toLocaleString("de-DE", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

export function ErstgespraechForm(props: {
  organisationId: string | null;
  organisations: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const organisationId = props.organisationId;
  const [isPending, startTransition] = useTransition();
  const [record, setRecord] = useState<FirstConversationRecord>(EMPTY_FIRST_CONVERSATION);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(organisationId));
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!organisationId) {
      setRecord(EMPTY_FIRST_CONVERSATION);
      setUpdatedAt(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    setStatus(null);
    void (async () => {
      const res = await loadErstgespraechAction({ organisationId });
      if (cancelled) return;
      if (!res.ok || !res.data) {
        setError(res.message);
        setLoading(false);
        return;
      }
      setRecord(res.data.record);
      setUpdatedAt(res.data.updatedAt);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [organisationId]);

  const counts = useMemo(() => firstConversationFilledCount(record), [record]);

  function patch(key: FirstConversationFieldKey, value: string) {
    setRecord((prev) => ({ ...prev, [key]: value }));
  }

  function persist(then?: "stay" | "fragebogen") {
    if (!organisationId) {
      setError("Bitte zuerst eine Organisation wählen oder anlegen.");
      return;
    }
    setError(null);
    setStatus(null);
    startTransition(async () => {
      setStatus("Speichere Erstgespräch…");
      const res = await saveErstgespraechAction({ organisationId, record });
      setStatus(null);
      if (!res.ok || !res.data) {
        setError(res.message);
        return;
      }
      setUpdatedAt(res.data.updatedAt);
      if (then === "fragebogen") {
        router.push(
          `/dashboard/frageboegen/neu?org=${encodeURIComponent(organisationId)}`,
        );
        router.refresh();
        return;
      }
      setStatus("Gespeichert. Wird beim Erzeugen der Fragebögen übernommen.");
    });
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-primary">
          Erstgespräch — Kundendefinition
        </h1>
        <p className="max-w-2xl text-sm text-secondary">
          Hier führt die Agentur das erste Gespräch. Die Fragen sind die Gesprächsleitung —
          Antworten landen später vorausgefüllt in den Fragebögen. Crawl und
          Performance-Daten kommen zusätzlich beim Erzeugen der Fragebögen dazu.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageCircle className="size-4" aria-hidden />
            Organisation
          </CardTitle>
          <CardDescription>
            Eine Kundendefinition pro Organisation. Der Kunde füllt das nicht selbst aus.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <div className="grid max-w-md gap-2">
            <Label>Organisation</Label>
            <OrganisationSwitcher
              organisations={props.organisations}
              selectedOrganisationId={organisationId}
              orgPath="/dashboard/erstgespraech"
            />
          </div>
          <p className="text-xs text-secondary">
            Organisation fehlt?{" "}
            <Link
              href={CREATE_ORG_HREF}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              Organisation anlegen
            </Link>
          </p>
          {!organisationId ? (
            <p className="text-xs text-amber-800 dark:text-amber-200">
              Bitte oben eine Organisation wählen — danach die Gesprächsleitung.
            </p>
          ) : loading ? (
            <p className="text-xs text-secondary">Lade gespeichertes Erstgespräch…</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Badge variant={counts.filled > 0 ? "default" : "secondary"}>
                {counts.filled}/{counts.total} Felder ausgefüllt
              </Badge>
              {updatedAt ? (
                <Badge variant="outline">Zuletzt {formatUpdatedAt(updatedAt)}</Badge>
              ) : (
                <Badge variant="outline">Noch nicht gespeichert</Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {FIRST_CONVERSATION_SECTIONS.map((section, index) => (
        <Card key={section.id}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {index + 1}. {section.title}
            </CardTitle>
            <CardDescription>{section.description}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {section.fields.map((field) => (
              <div key={field.key} className="grid gap-2">
                <Label htmlFor={field.key}>{field.label}</Label>
                <p className="text-xs text-secondary">{field.ask}</p>
                {field.kind === "textarea" ? (
                  <Textarea
                    id={field.key}
                    value={record[field.key]}
                    onChange={(e) => patch(field.key, e.target.value)}
                    rows={field.rows ?? 3}
                    placeholder={field.placeholder}
                    disabled={!organisationId || loading}
                  />
                ) : (
                  <Input
                    id={field.key}
                    value={record[field.key]}
                    onChange={(e) => patch(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    disabled={!organisationId || loading}
                  />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      {status ? <p className="text-sm text-secondary">{status}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          disabled={isPending || loading || !organisationId}
          onClick={() => persist("stay")}
        >
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Speichere…
            </>
          ) : (
            "Erstgespräch speichern"
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={isPending || loading || !organisationId}
          onClick={() => persist("fragebogen")}
        >
          <ClipboardPenLine className="size-4" aria-hidden />
          Speichern und Fragebogen erzeugen
        </Button>
        {organisationId ? (
          <Button asChild type="button" variant="ghost">
            <Link href={`/dashboard/frageboegen?org=${encodeURIComponent(organisationId)}`}>
              Zu den Fragebögen
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
