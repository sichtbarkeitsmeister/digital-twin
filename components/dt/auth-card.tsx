"use client";

import { Eye, Mail, User } from "lucide-react";
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
import { germanAuthErrorMessage } from "@/lib/shared/auth-error-messages";
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
  const [showPassword, setShowPassword] = useState(false);

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
      setError(germanAuthErrorMessage(err));
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
              In zwei Minuten startklar. Du bekommst die Zugangsdaten per E-Mail.
            </p>
          </div>

          {success ? (
            <SuccessMessage onReset={() => { setSuccess(false); setEmail(""); }} />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <DtField label="Vorname" htmlFor="first-name">
                  <DtInputWrap icon={<User className="h-[18px] w-[18px]" strokeWidth={1.6} />}>
                    <DtInput id="first-name" placeholder="André" autoComplete="given-name" />
                  </DtInputWrap>
                </DtField>
                <DtField label="Nachname" htmlFor="last-name">
                  <DtInputWrap>
                    <DtInput id="last-name" placeholder="Petermann" autoComplete="family-name" />
                  </DtInputWrap>
                </DtField>
              </div>

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

              <DtField label="Passwort" htmlFor="signup-password">
                <DtInputWrap
                  trailing={
                    <button
                      type="button"
                      className="grid place-items-center px-3.5 text-sbkm-ink-500 hover:text-sbkm-navy dark:hover:text-white"
                      aria-label="Passwort anzeigen"
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      <Eye className="h-[18px] w-[18px]" strokeWidth={1.6} />
                    </button>
                  }
                >
                  <DtInput
                    id="signup-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Mindestens 10 Zeichen"
                    autoComplete="new-password"
                  />
                </DtInputWrap>
              </DtField>

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
              Melde dich an und führe deine Pipeline weiter.
            </p>
          </div>

          {success ? (
            <SuccessMessage onReset={() => { setSuccess(false); setEmail(""); }} />
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

              {error ? <p className="text-sm text-red-500">{error}</p> : null}

              <DtPillButton type="submit" size="full" disabled={isLoading}>
                {isLoading ? "Wird gesendet …" : "Magic Link senden"}
              </DtPillButton>

              <DtPillButton
                type="button"
                variant="outline"
                size="full"
                onClick={() => router.push("/dashboard")}
              >
                Zum Dashboard
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

function SuccessMessage({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-normal text-sbkm-ink-600 dark:text-white/70">
        Prüfe dein Postfach — wir haben dir einen Magic Link geschickt. Klicke auf den
        Link in der E-Mail, um den Vorgang abzuschließen.
      </p>
      <DtPillButton type="button" variant="outline" size="full" onClick={onReset}>
        Erneut senden
      </DtPillButton>
    </div>
  );
}
