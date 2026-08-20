"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ClipboardPenLine, Loader2, MessageCircle, Trash2, Upload } from "lucide-react";

import {
  loadErstgespraechAction,
  fillErstgespraechFromFilesAction,
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
  FIRST_CONVERSATION_FILE_ACCEPT,
  FIRST_CONVERSATION_KIND_TABS,
  FIRST_CONVERSATION_MAX_FILES,
  applyFirstConversationKind,
  firstConversationFilledCount,
  firstConversationKindOf,
  firstConversationSectionsForKind,
  type FirstConversationFieldKey,
  type FirstConversationFileMeta,
  type FirstConversationKind,
  type FirstConversationRecord,
} from "@/lib/surveys/first-conversation";
import { cn } from "@/lib/utils";

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
  const [files, setFiles] = useState<FirstConversationFileMeta[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(organisationId));
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!organisationId) {
      setRecord(EMPTY_FIRST_CONVERSATION);
      setFiles([]);
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
      setFiles(res.data.files);
      setUpdatedAt(res.data.updatedAt);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [organisationId]);

  const counts = useMemo(() => firstConversationFilledCount(record), [record]);
  const kind = firstConversationKindOf(record);
  const sections = useMemo(() => firstConversationSectionsForKind(kind), [kind]);

  function patch(key: FirstConversationFieldKey, value: string) {
    setRecord((prev) => ({ ...prev, [key]: value }));
  }

  function setKind(next: FirstConversationKind) {
    setRecord((prev) => applyFirstConversationKind(prev, next));
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

  async function uploadFiles(fileList: FileList | null) {
    if (!organisationId || !fileList?.length) return;
    setError(null);
    setStatus("Datei wird gelesen und leere Felder vorausgefüllt…");
    for (const file of Array.from(fileList)) {
      const form = new FormData();
      form.append("organisationId", organisationId);
      form.append("file", file);
      const res = await fetch("/api/dt/erstgespraech/files", {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        extractWarning?: string | null;
        filledKeys?: string[];
        record?: FirstConversationRecord;
        files?: FirstConversationFileMeta[];
      };
      if (!json.ok) {
        setStatus(null);
        setError(json.message ?? "Upload fehlgeschlagen.");
        return;
      }
      if (json.record) setRecord(json.record);
      if (json.files) setFiles(json.files);
      const extra = json.extractWarning ? ` ${json.extractWarning}` : "";
      const filled =
        json.filledKeys?.length
          ? ` ${json.filledKeys.length} Felder aus der Datei übernommen.`
          : " Keine neuen Felder — Inhalt wird beim Fragebogen trotzdem genutzt.";
      setStatus(`„${file.name}“ gespeichert.${filled}${extra}`);
    }
  }

  async function removeFile(fileId: string) {
    if (!organisationId) return;
    setError(null);
    const res = await fetch(
      `/api/dt/erstgespraech/files?org=${encodeURIComponent(organisationId)}&fileId=${encodeURIComponent(fileId)}`,
      { method: "DELETE" },
    );
    const json = (await res.json()) as {
      ok?: boolean;
      message?: string;
      files?: FirstConversationFileMeta[];
    };
    if (!json.ok) {
      setError(json.message ?? "Löschen fehlgeschlagen.");
      return;
    }
    setFiles(json.files ?? []);
  }

  function fillFromFiles() {
    if (!organisationId) return;
    setError(null);
    startTransition(async () => {
      setStatus("KI liest die Dateien…");
      const res = await fillErstgespraechFromFilesAction({
        organisationId,
        record,
      });
      setStatus(null);
      if (!res.ok || !res.data) {
        setError(res.message);
        return;
      }
      setRecord(res.data.record);
      setUpdatedAt(res.data.updatedAt);
      setStatus(res.message);
    });
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-primary">
          Erstgespräch — Kundendefinition
        </h1>
        <p className="max-w-2xl text-sm text-secondary">
          Gesprächsleitung für das erste Treffen: aktueller Stand, Leistungen und Fokus,
          Wunschkunden, dann was geplant ist. Oben die Art wählen — die Fragen bleiben dieselben
          Felder, nur die Worte wechseln (Patient, Mandant, Kunde). Der Kunde füllt das nicht selbst
          aus.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Art des Gesprächs</CardTitle>
          <CardDescription>
            Arztpraxis und Kanzlei sind die Hauptkunden. Weitere für alle anderen Firmen. Wechsel
            ändert nur die Worte — eingetragene Antworten bleiben.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            {FIRST_CONVERSATION_KIND_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setKind(tab.id)}
                disabled={!organisationId || loading}
                className={cn(
                  "rounded-xl border px-3 py-2 text-left text-sm font-medium transition",
                  kind === tab.id
                    ? "border-sbkm-mint/50 bg-sbkm-mint/15 text-primary"
                    : "border-sbkm-navy/10 hover:bg-sbkm-navy/5",
                )}
              >
                {tab.label}
                <span className="mt-0.5 block text-xs font-normal text-secondary">{tab.hint}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageCircle className="size-4" aria-hidden />
            Organisation
          </CardTitle>
          <CardDescription>
            Eine Kundendefinition pro Organisation. Die Gesprächsleitung füllt die Agentur aus.
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
              Bitte eine Organisation wählen — danach die Gesprächsleitung.
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="size-4" aria-hidden />
            Meeting-Zusammenfassungen & Unterlagen
          </CardTitle>
          <CardDescription>
            PDF, Word (.docx) oder Text mit Infos zur Firma und Ausrichtung. Die KI füllt leere
            Felder und später den Fragebogen — nur wo der Text eine klare Antwort hergibt.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <input
            id="erstgespraech-files"
            type="file"
            className="hidden"
            accept={FIRST_CONVERSATION_FILE_ACCEPT}
            multiple
            disabled={!organisationId || loading || isPending}
            onChange={(e) => {
              void uploadFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button asChild type="button" size="sm" variant="outline" disabled={!organisationId || loading}>
              <label htmlFor="erstgespraech-files" className="cursor-pointer">
                Datei hochladen
              </label>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!organisationId || loading || isPending || files.length === 0}
              onClick={fillFromFiles}
            >
              Leere Felder aus Dateien füllen
            </Button>
          </div>
          {files.length === 0 ? (
            <p className="text-xs text-secondary">
              Noch keine Dateien. Bis zu {FIRST_CONVERSATION_MAX_FILES} Dateien, je 10 MB.
            </p>
          ) : (
            <ul className="grid gap-2">
              {files.map((file) => (
                <li
                  key={file.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-sbkm-navy/10 px-3 py-2"
                >
                  <span className="min-w-0 truncate">
                    {file.fileName}
                    <span className="ml-2 text-xs text-secondary">
                      {file.hasText ? "Text gelesen" : "ohne extrahierten Text"}
                    </span>
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`${file.fileName} entfernen`}
                    onClick={() => void removeFile(file.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {sections.map((section, index) => (
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
