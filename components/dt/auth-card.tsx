"use client";

import { Mail } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import {
  DtField,
  DtGlassCard,
  DtHeading,
  DtInput,
  DtInputWrap,
  DtPillButton,
  DtTabs,
} from "@/components/dt";
import { translateAuthError } from "@/lib/auth/error-messages";
import { createClient } from "@/lib/supabase/client";

export function AuthCard({ defaultTab }: { defaultTab?: "signup" | "signin" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab =
    searchParams.get("tab") === "signin" || defaultTab === "signin"
      ? "signin"
      : "signup";
  const [tab, setTab] = useState(initialTab);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const { error: authError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/confirm?next=/dashboard`,
        },
      });
      if (authError) throw authError;
      setSuccess(true);
    } catch (err: unknown) {
      setError(translateAuthError(err instanceof Error ? err.message : null));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <DtGlassCard className="w-full max-w-[520px]" padding="lg">
      <DtTabs
        tabs={[
          { id: "signup", label: "Zugang anfordern" },
          { id: "signin", label: "Anmelden" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "signup" ? (
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div>
            <DtHeading as="h2" variant="h4">
              Zugang anfordern
            </DtHeading>
            <p className="mt-1 text-sm leading-normal text-sbkm-ink-600 dark:text-white/70">
              In zwei Minuten startklar. Du bekommst deinen Zugang per E-Mail —
              ganz ohne Passwort.
            </p>
          </div>

          {success ? (
            <SuccessMessage email={email} onReset={() => { setSuccess(false); setEmail(""); }} />
          ) : (
            <>
              <DtField label="Geschäftliche E-Mail" htmlFor="signup-email">
                <DtInputWrap icon={<Mail className="h-[18px] w-[18px]" strokeWidth={1.6} />}>
                  <DtInput
                    id="signup-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="andre@deine-agentur.de"
                    autoComplete="email"
                  />
                </DtInputWrap>
              </DtField>

              <MagicLinkHint />

              {error ? <p className="text-sm text-red-500">{error}</p> : null}

              <DtPillButton type="submit" size="full" disabled={isLoading}>
                {isLoading ? "Wird gesendet …" : "Zugang anfordern"}
              </DtPillButton>

              <p className="text-center text-[13.5px] text-sbkm-ink-600 dark:text-white/70">
                Schon dabei?{" "}
                <button
                  type="button"
                  className="font-bold text-sbkm-navy underline underline-offset-[3px] dark:text-white"
                  onClick={() => setTab("signin")}
                >
                  Jetzt anmelden
                </button>
              </p>
            </>
          )}
        </form>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div>
            <DtHeading as="h2" variant="h4">
              Willkommen zurück.
            </DtHeading>
            <p className="mt-1 text-sm leading-normal text-sbkm-ink-600 dark:text-white/70">
              Gib deine E-Mail-Adresse ein — wir schicken dir einen Anmeldelink.
            </p>
          </div>

          {success ? (
            <SuccessMessage email={email} onReset={() => { setSuccess(false); setEmail(""); }} />
          ) : (
            <>
              <DtField label="E-Mail" htmlFor="signin-email">
                <DtInputWrap icon={<Mail className="h-[18px] w-[18px]" strokeWidth={1.6} />}>
                  <DtInput
                    id="signin-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="andre@deine-agentur.de"
                    autoComplete="email"
                  />
                </DtInputWrap>
              </DtField>

              <MagicLinkHint />

              {error ? <p className="text-sm text-red-500">{error}</p> : null}

              <DtPillButton type="submit" size="full" disabled={isLoading}>
                {isLoading ? "Wird gesendet …" : "Anmeldelink senden"}
              </DtPillButton>

              <DtPillButton
                type="button"
                variant="outline"
                size="full"
                onClick={() => router.push("/dashboard")}
              >
                Ich bin bereits angemeldet
              </DtPillButton>

              <p className="text-center text-[13.5px] text-sbkm-ink-600 dark:text-white/70">
                Noch kein Zugang?{" "}
                <button
                  type="button"
                  className="font-bold text-sbkm-navy underline underline-offset-[3px] dark:text-white"
                  onClick={() => setTab("signup")}
                >
                  Jetzt anfordern
                </button>
              </p>
            </>
          )}
        </form>
      )}
    </DtGlassCard>
  );
}

function MagicLinkHint() {
  return (
    <p className="rounded-dt bg-sbkm-mint/10 px-3 py-2 text-[13px] leading-normal text-sbkm-ink-600 dark:bg-white/5 dark:text-white/70">
      Du brauchst kein Passwort: Wir schicken dir eine E-Mail mit einem Link, der
      dich direkt anmeldet. Der Link gilt nur kurze Zeit und lässt sich einmal
      verwenden.
    </p>
  );
}

function SuccessMessage({ email, onReset }: { email: string; onReset: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-normal text-sbkm-ink-600 dark:text-white/70">
        E-Mail ist unterwegs{email ? ` an ${email}` : ""}. Klicke auf den Anmeldelink
        darin, dann bist du eingeloggt. Kommt nichts an, sieh bitte im Spam-Ordner
        nach.
      </p>
      <DtPillButton type="button" variant="outline" size="full" onClick={onReset}>
        Andere Adresse verwenden
      </DtPillButton>
    </div>
  );
}
