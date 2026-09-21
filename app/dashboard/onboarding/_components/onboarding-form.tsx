"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { ClipboardList, Loader2, RefreshCw } from "lucide-react";

import {
  loadOnboardingAction,
  saveOnboardingAction,
} from "@/app/dashboard/onboarding/actions";
import { OnboardingContacts } from "@/app/dashboard/onboarding/_components/onboarding-contacts";
import { OnboardingFilesPanel } from "@/app/dashboard/onboarding/_components/onboarding-files-panel";
import { SecretField } from "@/app/dashboard/onboarding/_components/secret-field";
import { OrganisationSwitcher } from "@/app/dashboard/_components/organisation-switcher";
import { CopyToClipboardButton } from "@/app/dashboard/_components/copy-to-clipboard-button";
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
import {
  DT_ONBOARDING_MAX_COMPETITORS,
  DT_ONBOARDING_MEDIA_INTRO,
  DT_ONBOARDING_MEDIA_ITEMS,
  DT_ONBOARDING_SMTP_PROTOCOLS,
  EMPTY_ONBOARDING_RECORD,
  onboardingPublicPath,
  type DtOnboardingRecord,
} from "@/lib/dt/onboarding/copy";
import {
  onboardingChecklist,
  onboardingFilledCount,
} from "@/lib/dt/onboarding/normalize";

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

export function OnboardingForm(props: {
  organisationId: string | null;
  organisations: Array<{ id: string; name: string; slug?: string | null }>;
  appBaseUrl: string;
}) {
  const organisationId = props.organisationId;
  const [isPending, startTransition] = useTransition();
  const [record, setRecord] = useState<DtOnboardingRecord>(EMPTY_ONBOARDING_RECORD);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(organisationId));
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [fileCount, setFileCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!organisationId) {
      setRecord(EMPTY_ONBOARDING_RECORD);
      setUpdatedAt(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    setStatus(null);
    void (async () => {
      const res = await loadOnboardingAction({ organisationId });
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

  const checklist = useMemo(
    () => onboardingChecklist(record, fileCount),
    [record, fileCount],
  );
  const counts = useMemo(() => onboardingFilledCount(checklist), [checklist]);

  const uploadUrl = record.uploadToken
    ? `${props.appBaseUrl.replace(/\/+$/, "")}${onboardingPublicPath(record.uploadToken)}`
    : "";

  function patch<K extends keyof DtOnboardingRecord>(key: K, value: DtOnboardingRecord[K]) {
    setRecord((prev) => ({ ...prev, [key]: value }));
  }

  function persist(regenerateUpload = false) {
    if (!organisationId) {
      setError("Bitte zuerst eine Organisation wählen.");
      return;
    }
    setError(null);
    setStatus(null);
    startTransition(async () => {
      setStatus("Speichere Onboarding…");
      const res = await saveOnboardingAction({
        organisationId,
        record,
        regenerateUpload,
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

  const disabled = !organisationId || loading;

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-primary">Onboarding</h1>
        <p className="max-w-2xl text-sm text-secondary">
          Zugangsdaten, Bildmaterial und Ansprechpartner — alles über den DigitalTwin-Zugang.
          Bitte füllen Sie die Felder aus. Cloud-Link und Passwort können Sie hier jederzeit
          abrufen.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="size-4" aria-hidden />
            Organisation
          </CardTitle>
          <CardDescription>
            Eine Onboarding-Akte pro Organisation. Mitglieder und das Agentur-Team sehen dieselben
            Daten.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <div className="grid max-w-md gap-2">
            <Label>Organisation</Label>
            <OrganisationSwitcher
              organisations={props.organisations}
              selectedOrganisationId={organisationId}
              orgPath="/dashboard/onboarding"
            />
          </div>
          {!organisationId ? (
            <p className="text-xs text-amber-800 dark:text-amber-200">
              Bitte oben eine Organisation wählen.
            </p>
          ) : loading ? (
            <p className="text-xs text-secondary">Lade Onboarding…</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Badge variant={counts.filled === counts.total ? "default" : "secondary"}>
                {counts.filled}/{counts.total} Bereiche ausgefüllt
              </Badge>
              {fileCount > 0 ? (
                <Badge variant="outline">{fileCount} Datei{fileCount === 1 ? "" : "en"}</Badge>
              ) : null}
              {updatedAt ? (
                <Badge variant="outline">Zuletzt {formatUpdatedAt(updatedAt)}</Badge>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">1. Bilder und Videos</CardTitle>
          <CardDescription>
            Upload-Link nur zum Hochladen — von außen können keine Dateien heruntergeladen werden.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-sm font-medium text-primary">{DT_ONBOARDING_MEDIA_INTRO}</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-secondary">
            {DT_ONBOARDING_MEDIA_ITEMS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>

          <div className="grid gap-2">
            <Label htmlFor="cloud-link">Link zur Cloud</Label>
            <div className="flex flex-wrap gap-2">
              <Input id="cloud-link" value={uploadUrl} readOnly className="bg-muted/40" />
              <CopyToClipboardButton text={uploadUrl} disabled={!uploadUrl} />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="cloud-pass">Passwort</Label>
            <SecretField
              id="cloud-pass"
              value={record.uploadPassword}
              readOnly
              disabled={disabled}
            />
          </div>

          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending || disabled}
              onClick={() => persist(true)}
            >
              <RefreshCw className="size-3.5" />
              Neuen Link und neues Passwort erzeugen
            </Button>
          </div>

          <OnboardingFilesPanel
            organisationId={organisationId}
            onCountChange={setFileCount}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">2. Zugangsdaten zum Hoster</CardTitle>
          <CardDescription>Login für den Webspace / das Hosting-Paket.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="hoster-user">User</Label>
            <Input
              id="hoster-user"
              value={record.hosterUser}
              onChange={(e) => patch("hosterUser", e.target.value)}
              disabled={disabled}
              autoComplete="off"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="hoster-pass">Pass</Label>
            <SecretField
              id="hoster-pass"
              value={record.hosterPassword}
              onChange={(v) => patch("hosterPassword", v)}
              disabled={disabled}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">3. SMTP-Zugang E-Mail</CardTitle>
          <CardDescription>
            Für das Kontaktformular auf der Webseite benötigen wir die Zugangsdaten von dem
            E-Mail-Postausgangsserver.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="smtp-host">Mailserver</Label>
            <Input
              id="smtp-host"
              value={record.smtpHost}
              onChange={(e) => patch("smtpHost", e.target.value)}
              placeholder="z. B. mail.ihre-domain.de"
              disabled={disabled}
              autoComplete="off"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="smtp-port">SMTP Auth Port</Label>
            <Input
              id="smtp-port"
              value={record.smtpPort}
              onChange={(e) => patch("smtpPort", e.target.value)}
              placeholder="Beispiel: 587"
              disabled={disabled}
              inputMode="numeric"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="smtp-protocol">SMTP Auth Protokoll</Label>
            <select
              id="smtp-protocol"
              value={record.smtpProtocol}
              onChange={(e) => patch("smtpProtocol", e.target.value)}
              disabled={disabled}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              {DT_ONBOARDING_SMTP_PROTOCOLS.map((protocol) => (
                <option key={protocol} value={protocol}>
                  {protocol}
                </option>
              ))}
            </select>
            <p className="text-xs text-secondary">Beispiel: TLS</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="smtp-user">Username / E-Mail</Label>
            <Input
              id="smtp-user"
              value={record.smtpUsername}
              onChange={(e) => patch("smtpUsername", e.target.value)}
              disabled={disabled}
              autoComplete="off"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="smtp-pass">Passwort</Label>
            <SecretField
              id="smtp-pass"
              value={record.smtpPassword}
              onChange={(v) => patch("smtpPassword", v)}
              disabled={disabled}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">4. Zugang zum CMS-System der Webseite</CardTitle>
          <CardDescription>
            Wir benötigen außerdem den Zugang zum Content Management System (CMS) der Webseite.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="cms-url">Anmeldelink</Label>
            <Input
              id="cms-url"
              value={record.cmsLoginUrl}
              onChange={(e) => patch("cmsLoginUrl", e.target.value)}
              placeholder="https://ihre-domain.de/wp-admin"
              disabled={disabled}
              autoComplete="off"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="cms-user">User</Label>
              <Input
                id="cms-user"
                value={record.cmsUser}
                onChange={(e) => patch("cmsUser", e.target.value)}
                disabled={disabled}
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cms-pass">Pass</Label>
              <SecretField
                id="cms-pass"
                value={record.cmsPassword}
                onChange={(v) => patch("cmsPassword", v)}
                disabled={disabled}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">5. Mitbewerber</CardTitle>
          <CardDescription>
            Nennen Sie bis zu 5 Mitbewerber, mit denen Sie sich vergleichen.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {Array.from({ length: DT_ONBOARDING_MAX_COMPETITORS }, (_, index) => (
            <div key={index} className="grid gap-2">
              <Label htmlFor={`competitor-${index}`}>Mitbewerber {index + 1}</Label>
              <Input
                id={`competitor-${index}`}
                value={record.competitors[index] ?? ""}
                onChange={(e) => {
                  const next = [...record.competitors];
                  next[index] = e.target.value;
                  patch("competitors", next);
                }}
                disabled={disabled}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">6. E-Mail für die Buchhaltung</CardTitle>
          <CardDescription>
            Um die Kommunikation mit der Buchhaltung zu vereinfachen, können Sie uns die
            E-Mail-Adresse für Ihre Rechnungsthemen mitteilen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid max-w-lg gap-2">
            <Label htmlFor="billing-email">E-Mail</Label>
            <Input
              id="billing-email"
              type="email"
              value={record.billingEmail}
              onChange={(e) => patch("billingEmail", e.target.value)}
              disabled={disabled}
              autoComplete="off"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">7. Direkte Ansprechpartner im Projekt</CardTitle>
          <CardDescription>
            Das Team von Sichtbarkeitsmeister — so erreichen Sie uns.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OnboardingContacts />
        </CardContent>
      </Card>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      {status ? <p className="text-sm text-secondary">{status}</p> : null}

      <div className="flex flex-wrap items-center gap-2 pb-8">
        <Button
          type="button"
          disabled={isPending || loading || !organisationId}
          onClick={() => persist(false)}
        >
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Speichere…
            </>
          ) : (
            "Onboarding speichern"
          )}
        </Button>
      </div>
    </div>
  );
}
