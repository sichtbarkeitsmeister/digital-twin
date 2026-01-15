"use client";

import { useMemo, useState } from "react";

type OrganisationOption = {
  id: string;
  name: string;
  slug: string | null;
};

export function ChatMockup({ organisations }: { organisations: OrganisationOption[] }) {
  const initialOrgId = organisations[0]?.id ?? "";
  const [selectedOrgId, setSelectedOrgId] = useState(initialOrgId);

  const selectedOrg = useMemo(() => {
    return organisations.find((o) => o.id === selectedOrgId) ?? organisations[0] ?? null;
  }, [organisations, selectedOrgId]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col px-5 py-8">
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="rounded-2xl border bg-card/60 backdrop-blur">
          <div className="flex items-center justify-between border-b px-4 py-4">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-xl bg-brand/20 ring-1 ring-brand/40" />
              <div className="grid leading-tight">
                <p className="text-sm font-semibold">DigitalTwin</p>
                <p className="text-xs text-secondary">
                  {selectedOrg?.name ?? "Workspace"}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="rounded-lg border bg-background/40 px-2 py-1 text-xs text-secondary hover:bg-accent"
            >
              New Chat
            </button>
          </div>

          <div className="grid gap-3 p-4">
            <div className="grid gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-secondary">
                Schnelltest
              </p>
              <div className="grid gap-2">
                {[
                  "Wie würdest du nach einem Hausarzt suchen?",
                  "Was ist dir bei der Terminvergabe am wichtigsten?",
                  "Welche Informationen fehlen auf Hausarzt-Websites?",
                ].map((q) => (
                  <button
                    key={q}
                    type="button"
                    className="rounded-xl border bg-background/40 px-3 py-2 text-left text-sm text-primary hover:bg-accent"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-2 pt-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-secondary">
                Chat-Verlauf
              </p>
              <div className="rounded-xl border bg-background/30 px-3 py-2">
                <p className="text-sm font-medium">Wie würdest du nach eine…</p>
                <p className="text-xs text-secondary">15.01, 00:19</p>
              </div>
            </div>
          </div>
        </aside>

        <main className="rounded-2xl border bg-card/60 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-4">
            <div className="flex items-center gap-2">
              <label className="relative">
                <span className="sr-only">Organisation auswählen</span>
                <select
                  value={selectedOrgId}
                  onChange={(e) => setSelectedOrgId(e.target.value)}
                  className="h-9 max-w-[240px] cursor-pointer appearance-none rounded-xl border bg-background/40 pl-3 pr-8 text-sm font-medium text-primary outline-none transition-colors hover:bg-accent focus:ring-2 focus:ring-ring"
                >
                  {organisations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-secondary">
                  ▼
                </span>
              </label>

              <div className="hidden items-center gap-2 sm:flex">
                <button
                  type="button"
                  className="rounded-xl border bg-background/30 px-3 py-2 text-xs text-secondary"
                >
                  Meinung
                </button>
                <button
                  type="button"
                  className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
                >
                  Text
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-xl border bg-background/30 px-3 py-2 text-xs text-secondary"
              >
                Configuration
              </button>
              <button
                type="button"
                className="rounded-xl border bg-background/30 px-3 py-2 text-xs text-secondary"
              >
                Export
              </button>
            </div>
          </div>

          <div className="grid gap-6 px-4 py-6">
            <div className="flex justify-end">
              <div className="max-w-[720px] rounded-2xl bg-primary/15 px-4 py-3 ring-1 ring-brand/30">
                <p className="text-sm font-medium text-primary">
                  Was ist dir bei der Terminvergabe am wichtigsten?
                </p>
              </div>
            </div>

            <div className="flex">
              <div className="max-w-[820px] rounded-2xl border bg-background/30 px-5 py-4">
                <p className="text-lg font-semibold">
                  Was mir bei der Terminvergabe am wichtigsten ist
                </p>
                <p className="mt-3 text-sm text-primary">
                  <span className="font-semibold text-brand">
                    Ehrlich gesagt: Verfügbarkeit HEUTE.
                  </span>{" "}
                  Ich bin krank, habe Fieber und kann morgen nicht ausfallen – das
                  ist nicht verhandelbar.
                </p>

                <p className="mt-5 text-sm font-semibold">Meine Top-Prioritäten</p>
                <ul className="mt-3 grid gap-2 text-sm text-primary">
                  <li>
                    <span className="font-semibold text-brand">
                      Online-Terminbuchung
                    </span>{" "}
                    – ich will nicht 20 Minuten in der Telefonschlange hängen
                  </li>
                  <li>
                    <span className="font-semibold text-brand">
                      Akut-Sprechstunde oder Gleicher-Tag-Termin
                    </span>{" "}
                    – nicht in 4 Wochen, sondern JETZT
                  </li>
                  <li>
                    <span className="font-semibold text-brand">Kurze Wartezeit</span>{" "}
                    – maximal 30–45 Minuten, sonst werde ich noch kränker
                  </li>
                  <li>
                    <span className="font-semibold text-brand">
                      Digitale Krankschreibung
                    </span>{" "}
                    – damit ich die sofort habe und nicht nochmal hingehen muss
                  </li>
                </ul>

                <p className="mt-5 text-sm font-semibold">Das Wichtigste</p>
                <p className="mt-2 text-sm text-primary">
                  Für mich zählt nur eins:{" "}
                  <span className="font-semibold text-brand">
                    Kann ich HEUTE noch einen Arzt sehen oder nicht?
                  </span>{" "}
                  Alles andere ist mir schnuppe. Wenn eine Praxis sagt “nur mit
                  Termin, nächster freier in 6 Wochen”, bin ich direkt weg.
                </p>
              </div>
            </div>

            <div className="flex justify-end">
              <div className="max-w-[720px] rounded-2xl bg-primary/15 px-4 py-3 ring-1 ring-brand/30">
                <p className="text-sm font-medium text-primary">
                  Welche Informationen fehlen auf Hausarzt-Websites?
                </p>
              </div>
            </div>
          </div>

          <div className="border-t px-4 py-4">
            <div className="flex items-center gap-3 rounded-2xl border bg-background/30 px-4 py-3">
              <input
                className="h-10 flex-1 bg-transparent text-sm text-primary placeholder:text-secondary focus:outline-none"
                placeholder="Stelle eine Frage…"
                readOnly
              />
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
              >
                Senden
              </button>
            </div>
          </div>
        </main>
      </div>

      <p className="mt-4 text-center text-xs text-secondary">
        Mockup only – keine echte Chat-Funktionalität.
      </p>
    </div>
  );
}

