"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { LayoutDashboard, Plus } from "lucide-react";

type OrganisationOption = {
  id: string;
  name: string;
  slug: string | null;
};

export function ChatMockup({ organisations }: { organisations: OrganisationOption[] }) {
  const quickTests = useMemo(
    () => [
      "Wie würdest du nach einem Umzugsunternehmen suchen?",
      "Was ist dir bei der Auswahl am wichtigsten?",
      "Was würde dich von einer Anfrage abhalten?",
    ],
    [],
  );

  const initialOrgId = organisations[0]?.id ?? "";
  const [selectedOrgId, setSelectedOrgId] = useState(initialOrgId);
  const [draft, setDraft] = useState("");
  const [hasSent, setHasSent] = useState(false);

  return (
    <div className="min-h-[calc(100vh-4rem)] w-full">
      <div className="mx-auto w-full max-w-7xl px-4 py-6">
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <aside className="rounded-2xl border bg-card/60 backdrop-blur">
            <div className="px-4 py-5">
              <div className="grid gap-4">
                <div className="grid gap-1">
                  <p className="text-2xl font-bold leading-none text-brand">
                    digital
                    <br />
                    twin.
                  </p>
                </div>

                <button
                  type="button"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border bg-background/30 px-4 text-sm font-semibold text-primary hover:bg-accent"
                >
                  <Plus className="h-4 w-4 text-brand" />
                  Neuer Chat
                </button>

                <div className="grid gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-secondary">
                    Organisation
                  </p>
                  <label className="relative">
                    <span className="sr-only">Organisation auswählen</span>
                    <select
                      value={selectedOrgId}
                      onChange={(e) => setSelectedOrgId(e.target.value)}
                      className="h-10 w-full cursor-pointer appearance-none rounded-xl border bg-background/40 pl-3 pr-8 text-sm font-medium text-primary outline-none transition-colors hover:bg-accent focus:ring-2 focus:ring-ring"
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
                </div>
              </div>
            </div>

            <div className="border-t px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-secondary">
                Chat-Verlauf
              </p>
              <div className="mt-3 grid gap-2">
                {[
                  { title: "Sandra & Michael Weber", subtitle: "B2C Premium Familie" },
                  { title: "Phoenix", subtitle: "Support FAQ" },
                  { title: "Onboarding", subtitle: "Neue Kunden" },
                ].map((c) => (
                  <button
                    key={c.title}
                    type="button"
                    className="rounded-xl border bg-background/30 px-3 py-2 text-left hover:bg-accent"
                    onClick={() => {
                      // Mockup only – selecting a chat does nothing yet.
                      setHasSent(true);
                    }}
                  >
                    <p className="text-sm font-medium text-primary">{c.title}</p>
                    <p className="text-xs text-secondary">{c.subtitle}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-auto border-t px-4 py-4">
              <Link
                href="/dashboard/members"
                prefetch
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border bg-background/30 px-3 text-sm font-semibold text-primary hover:bg-accent"
              >
                <LayoutDashboard className="h-4 w-4 text-brand" />
                Dashboard
              </Link>
              <p className="mt-3 text-xs text-secondary">
                Mockup only – keine echte Chat-Funktionalität.
              </p>
            </div>
          </aside>

          <main className="flex min-h-[680px] flex-col rounded-2xl border bg-card/60 backdrop-blur">
            <div className="flex items-center justify-end gap-2 border-b px-4 py-4">
              <button
                type="button"
                className="rounded-xl border bg-background/30 px-3 py-2 text-xs text-secondary"
              >
                Meinung
              </button>
              <button
                type="button"
                className="rounded-xl border bg-background/30 px-3 py-2 text-xs text-secondary"
              >
                Text
              </button>
            </div>

            <div className="flex-1 px-4 py-6">
              {!hasSent ? (
                <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center gap-6">
                  <div className="grid gap-2 text-center">
                    <div className="mx-auto h-10 w-10 rounded-full bg-background/40 ring-1 ring-brand/30" />
                    <p className="text-secondary">
                      Starte eine Unterhaltung mit deinem Kunden-Avatar
                    </p>
                  </div>

                  <div className="w-full max-w-xl">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-secondary">
                      Schnelltest
                    </p>
                    <div className="grid gap-2">
                      {quickTests.map((q) => (
                        <button
                          key={`chatbox_${q}`}
                          type="button"
                          className="rounded-xl border bg-background/30 px-4 py-3 text-left text-sm text-primary hover:bg-accent"
                          onClick={() => setDraft(q)}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mx-auto w-full max-w-3xl">
                  <p className="text-sm text-secondary">
                    (Mockup) Chat-Verlauf würde hier erscheinen.
                  </p>
                </div>
              )}
            </div>

            <div className="border-t px-4 py-4">
              <div className="flex items-center gap-3 rounded-2xl border bg-background/30 px-4 py-3">
                <input
                  className="h-10 flex-1 bg-transparent text-sm text-primary placeholder:text-secondary focus:outline-none"
                  placeholder="Stelle eine Frage…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <button
                  type="button"
                  className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
                  onClick={() => {
                    // Design-only: mark as "sent" to hide quick tests.
                    setHasSent(true);
                  }}
                >
                  Senden
                </button>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

