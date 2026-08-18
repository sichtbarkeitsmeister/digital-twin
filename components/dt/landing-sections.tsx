"use client";

import Link from "next/link";
import { Check, X } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

import {
  DtEyebrow,
  DtGlassCard,
  DtHeading,
  DtPillButton,
} from "@/components/dt";
import { cn } from "@/components/dt/cn";

const heroChecks = [
  "DSGVO-konform · Hosting in Deutschland",
  "Jeder Text zusätzlich von unserem Team geprüft",
  "Keine Anmeldung, kein Passwort nötig",
];

const painPoints = [
  "Texte werden nach Bauchgefühl freigegeben, ohne zu wissen, wie Ihre Wunschkunden wirklich reagieren.",
  "Fehler oder unpassende Formulierungen fallen erst auf, wenn Anfragen ausbleiben — Monate später.",
  "Der DigitalTwin prüft das für Sie und spart Ihnen genau diese Zeit. Wenn Sie möchten, können Sie ihn zusätzlich auch selbst nutzen, um eigene Texte vor Veröffentlichung gegenzuchecken.",
];

const workSteps = [
  {
    num: "01",
    title: "Gemeinsam legen wir die Basis",
    body: "Sie kennen Ihr Unternehmen und Ihre Wunschkunden am besten — dieses Wissen holen wir einmal von Ihnen ab. Je früher es bei uns eingeht, desto früher starten wir für Sie: Auswertung und technische Einrichtung übernehmen wir.",
  },
  {
    num: "02",
    title: "Wir lassen jeden Text gegenlesen",
    body: "Bevor ein Text, ein Angebot oder eine Antwort veröffentlicht wird, testen wir sie am digitalen Zwilling und passen an, was nicht passt.",
  },
  {
    num: "03",
    title: "Wir veröffentlichen das Ergebnis",
    body: "Nach Ihrer kurzen Freigabe ist der Text fertig abgestimmt — wir stellen ihn für Sie online. Zusätzlich steht Ihnen der DigitalTwin selbst zur Verfügung — für eigene Texte, Angebote oder Ideen, ganz wie Sie möchten.",
  },
];

const faqs = [
  {
    q: "Bringt mir das wirklich mehr Anfragen?",
    a: "Das Ziel ist nicht „ein weiteres Tool“, sondern Texte, die Ihre Wunschkunden tatsächlich verstehen und überzeugen — das ist der einzige Maßstab, an dem wir jeden Text prüfen.",
  },
  {
    q: "Funktioniert das auch bei einem Betrieb wie meinem?",
    a: "Der DigitalTwin basiert auf Ihren eigenen Angaben, nicht auf einer Standardvorlage — deshalb funktioniert er unabhängig davon, ob Sie eine Praxis, eine Kanzlei oder einen Handwerksbetrieb führen.",
  },
  {
    q: "Muss ich jetzt monatelang auf Ergebnisse warten?",
    a: "Nein — jeder Text wird vor Veröffentlichung geprüft, nicht erst danach nachgebessert. Sie sehen von Anfang an geprüfte Ergebnisse, nicht Testballons.",
  },
  {
    q: "Was muss ich dafür selbst tun?",
    a: "Einmalig: Sie teilen Ihr Wissen über Ihr Unternehmen und Ihre Zielgruppe mit uns. Das war's. Danach übernehmen wir die Text-Prüfung — den Zwilling können Sie zusätzlich selbst nutzen, müssen aber nicht.",
  },
  {
    q: "Wie lange dauert es, bis ich Ergebnisse sehe?",
    a: "Vom Austausch Ihres Wissens bis zu Ihrem ersten geprüften Bericht dauert es in der Regel bis zu einem Monat. Ab dann prüfen wir jeden neuen Text vor Veröffentlichung.",
  },
];

const interestSignals = [
  { label: "Kontaktformular ausgefüllt", value: "↑ 18% mehr" },
  { label: "Auf Button geklickt", value: "↑ 24% mehr" },
  { label: "Verweildauer auf der Seite", value: "↑ 35 Sek. länger" },
];

const accessSteps = [
  {
    num: "1",
    title: "Sie erhalten eine E-Mail von uns",
    body: "Sobald wir Ihr Wissen ausgewertet und Ihren digitalen Zwilling eingerichtet haben, senden wir Ihnen Ihren persönlichen Zugangslink.",
  },
  {
    num: "2",
    title: "Ein Klick genügt",
    body: "Der Link öffnet direkt Ihren Bericht — keine Registrierung, kein Passwort, kein Konto zum Verwalten.",
  },
  {
    num: "3",
    title: "Sie sehen Ihren SEO-Stand",
    body: "Letzte SEO-Optimierungen, anstehende Optimierungen, nächste Schritte und der aktuelle SEO-Stand — übersichtlich an einem Ort.",
  },
];

function FadeIn({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function LandingHero() {
  return (
    <section className="mx-auto flex w-full max-w-dt items-center px-5 py-10 sm:px-14 sm:py-16 lg:py-24">
      <div className="w-full max-w-3xl text-left">
        <FadeIn>
          <DtEyebrow dot>
            Entwickelt, eingerichtet und betreut von Sichtbarkeitsmeister — für Sie
            einsatzbereit
          </DtEyebrow>
        </FadeIn>

        <FadeIn delay={0.08}>
          <h1 className="mt-7 font-display text-[clamp(2rem,3.8vw+0.6rem,3.75rem)] font-bold leading-[1.08] tracking-[-0.02em] text-balance text-sbkm-navy dark:text-white">
            Bevor ein Text auf Ihrer Website landet, wissen wir schon, ob er die
            richtigen Menschen anspricht.
          </h1>
        </FadeIn>

        <FadeIn delay={0.14}>
          <p className="mt-5 max-w-[640px] text-pretty text-[clamp(1.05rem,0.5vw+1rem,1.25rem)] leading-relaxed text-sbkm-ink-600 dark:text-white/75">
            Der DigitalTwin verbindet unser SEO-Wissen mit einer Analyse Ihrer
            Wunschkunden. Konkret heißt das: Wir sehen vorab, welche Formulierung bei
            Ihrer Zielgruppe ankommt und wo Sie bei Google weiter oben erscheinen —
            bei Texten, Angeboten, Keywords und Kundenanfragen. Und Sie erhalten den
            DigitalTwin zusätzlich selbst, um eigene Ideen jederzeit aus
            Kundenperspektive zu testen.
          </p>
        </FadeIn>

        <FadeIn delay={0.2}>
          <div className="mt-9 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
            <DtPillButton asChild size="lg">
              <Link href="#zugang">So erhalten Sie Ihren Bericht</Link>
            </DtPillButton>
            <DtPillButton asChild variant="outline" size="lg">
              <Link href="#arbeit">Wie wir arbeiten</Link>
            </DtPillButton>
          </div>
        </FadeIn>

        <FadeIn delay={0.26}>
          <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-sbkm-ink-600 dark:text-white/70">
            {heroChecks.map((item) => (
              <span key={item} className="inline-flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 shrink-0 text-sbkm-mint" strokeWidth={2.4} />
                {item}
              </span>
            ))}
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

export function LandingProblem() {
  return (
    <section className="mx-auto w-full max-w-dt px-5 py-10 sm:px-14 sm:py-16">
      <div className="grid gap-8 lg:grid-cols-2 lg:gap-12 lg:items-start">
        <FadeIn>
          <DtGlassCard variant="quote" padding="lg" className="h-full">
            <p className="font-display text-[clamp(1.5rem,1.8vw+0.8rem,2.15rem)] font-medium leading-[1.2] tracking-[-0.015em] text-white">
              „Wir haben einen neuen Text online gestellt — und keine Ahnung, ob er bei
              unserer Zielgruppe überhaupt ankommt.“
            </p>
          </DtGlassCard>
        </FadeIn>

        <ul className="flex flex-col gap-5">
          {painPoints.map((point, i) => (
            <FadeIn key={point} delay={0.06 * (i + 1)}>
              <li className="flex gap-3.5">
                <span className="mt-0.5 inline-grid h-7 w-7 shrink-0 place-items-center rounded-full bg-red-500/15 text-red-600 dark:bg-red-400/15 dark:text-red-300">
                  <X className="h-4 w-4" strokeWidth={2.5} />
                </span>
                <p className="text-[15px] leading-relaxed text-sbkm-ink-700 dark:text-white/75">
                  {point}
                </p>
              </li>
            </FadeIn>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function LandingHowWeWork() {
  return (
    <section id="arbeit" className="mx-auto w-full max-w-dt scroll-mt-24 px-5 py-10 sm:px-14 sm:py-16 lg:py-20">
      <header className="mx-auto mb-10 max-w-2xl text-center">
        <DtEyebrow>So arbeiten wir für Sie</DtEyebrow>
        <DtHeading as="h2" variant="h2" className="mt-3">
          Ihr Wissen, unsere Kompetenz. Gemeinsam zu mehr Anfragen.
        </DtHeading>
        <p className="mx-auto mt-3.5 text-[17px] leading-relaxed text-sbkm-ink-600 dark:text-white/70">
          Sie kennen Ihr Unternehmen und Ihre Wunschkunden am besten — dieses Wissen
          holen wir einmal von Ihnen ab. Danach übernehmen wir Auswertung, Einrichtung
          und die laufende Prüfung jedes Textes. Der Zwilling steht Ihnen zusätzlich zur
          eigenen Nutzung frei — freiwillig, nie Pflicht.
        </p>
      </header>

      <div className="grid gap-5 md:grid-cols-3">
        {workSteps.map((step, i) => (
          <FadeIn key={step.num} delay={0.06 * i}>
            <DtGlassCard
              variant="subtle"
              padding="sm"
              className="flex h-full flex-col gap-3 transition-[transform,box-shadow] duration-200 ease-dt hover:-translate-y-0.5 hover:shadow-[0_16px_40px_rgba(46,46,80,0.12)] dark:hover:shadow-[0_16px_40px_rgba(0,0,0,0.35)]"
            >
              <span className="inline-grid h-[42px] w-[42px] place-items-center rounded-[14px] bg-sbkm-navy text-sm font-bold tracking-[-0.02em] text-sbkm-mint dark:bg-sbkm-mint dark:text-sbkm-navy">
                {step.num}
              </span>
              <h3 className="text-[20px] font-bold tracking-[-0.015em] text-sbkm-navy dark:text-white">
                {step.title}
              </h3>
              <p className="text-sm leading-[1.55] text-sbkm-ink-600 dark:text-white/70">
                {step.body}
              </p>
            </DtGlassCard>
          </FadeIn>
        ))}
      </div>
    </section>
  );
}

export function LandingPracticeDemo() {
  return (
    <section className="mx-auto w-full max-w-dt px-5 py-6 sm:px-14 sm:py-10">
      <FadeIn>
        <p className="mb-5 text-center text-[15px] text-sbkm-ink-600 dark:text-white/65">
          So sieht die Prüfung in der Praxis aus
        </p>
        <p className="mx-auto mb-6 max-w-2xl text-center text-[15px] leading-relaxed text-sbkm-ink-600 dark:text-white/70">
          Wir stellen Ihrem digitalen Zwilling gezielte Fragen zu Ihrem Text oder Ihrer
          Seite, bevor er online geht.
        </p>

        <DtGlassCard variant="solid" padding="none" className="mx-auto max-w-2xl overflow-hidden">
          <div className="border-b border-sbkm-navy/10 bg-sbkm-canvas/80 px-5 py-3.5 dark:border-white/10 dark:bg-sbkm-ink-900/60">
            <p className="text-[13px] font-medium text-sbkm-navy dark:text-white">
              DigitalTwin{" "}
              <span className="text-sbkm-ink-500 dark:text-white/45">↘</span>{" "}
              <span className="text-sbkm-ink-600 dark:text-white/70">
                Michael Sander · Patient / sucht neuen Zahnarzt in Düsseldorf
              </span>
            </p>
          </div>

          <div className="space-y-4 bg-sbkm-canvas/40 px-5 py-6 dark:bg-sbkm-ink-900/40">
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-sbkm-navy px-4 py-3 text-[14px] leading-relaxed text-white">
                Wenn du diesen Text liest, würdest du bei uns anrufen?
              </div>
            </div>
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-sbkm-navy/10 bg-white px-4 py-3 text-[14px] leading-relaxed text-sbkm-navy shadow-sm dark:border-white/10 dark:bg-white/[0.06] dark:text-white">
                Ja, ich würde anrufen. Aber ein Punkt lässt mich noch zögern…..
              </div>
            </div>
          </div>

          <div className="border-t border-sbkm-navy/10 px-5 py-3.5 dark:border-white/10">
            <div className="rounded-pill border border-sbkm-navy/10 bg-white/70 px-4 py-2.5 text-[13px] text-sbkm-ink-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/40">
              Nachricht an Michael Sander …
            </div>
          </div>
        </DtGlassCard>
      </FadeIn>
    </section>
  );
}

export function LandingFaq() {
  return (
    <section id="faq" className="mx-auto w-full max-w-dt scroll-mt-24 px-5 py-10 sm:px-14 sm:py-16 lg:py-20">
      <header className="mx-auto mb-10 max-w-2xl text-center">
        <DtEyebrow>Häufige Fragen, bevor Sie starten</DtEyebrow>
        <DtHeading as="h2" variant="h2" className="mt-3">
          Die Fragen, die sich die meisten stellen
        </DtHeading>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {faqs.map((item, i) => (
          <FadeIn
            key={item.q}
            delay={0.05 * i}
            className={cn(i === faqs.length - 1 && faqs.length % 2 === 1 && "md:col-span-2 md:max-w-[calc(50%-0.5rem)]")}
          >
            <DtGlassCard variant="subtle" padding="sm" className="h-full">
              <h3 className="flex gap-2 text-[16px] font-bold leading-snug text-sbkm-navy dark:text-white">
                <span
                  className="inline-grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sbkm-navy text-[13px] font-bold text-sbkm-mint dark:bg-sbkm-mint dark:text-sbkm-navy"
                  aria-hidden
                >
                  ?
                </span>
                {item.q}
              </h3>
              <p className="mt-2.5 text-sm leading-relaxed text-sbkm-ink-600 dark:text-white/70">
                {item.a}
              </p>
            </DtGlassCard>
          </FadeIn>
        ))}
      </div>
    </section>
  );
}

export function LandingReport() {
  return (
    <section id="bericht" className="mx-auto w-full max-w-dt scroll-mt-24 px-5 py-10 sm:px-14 sm:py-16 lg:py-20">
      <header className="mx-auto mb-10 max-w-2xl text-center">
        <DtEyebrow>Ihr Bericht</DtEyebrow>
        <DtHeading as="h2" variant="h2" className="mt-3">
          Was Sie in Ihrem Bericht sehen
        </DtHeading>
        <p className="mx-auto mt-3.5 text-[17px] leading-relaxed text-sbkm-ink-600 dark:text-white/70">
          Kein Fachchinesisch — nur die Fragen, die für Sie zählen: Kommen mehr
          Anfragen? Werden Sie bei Google besser gefunden?
        </p>
      </header>

      <FadeIn>
        <DtGlassCard variant="solid" padding="none" className="overflow-hidden">
          <div className="border-b border-sbkm-navy/10 bg-sbkm-navy px-5 py-3.5 dark:border-white/10">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-sbkm-mint">
              Ihre Sichtbarkeit · Beispielansicht
            </p>
          </div>

          <div className="space-y-6 p-5 sm:p-7">
            <div>
              <p className="mb-3 text-sm text-sbkm-ink-600 dark:text-white/65">
                Zeichen, dass Besucher Interesse haben:
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {interestSignals.map((signal) => (
                  <div
                    key={signal.label}
                    className="rounded-dt border border-sbkm-navy/10 bg-sbkm-canvas/70 p-4 dark:border-white/10 dark:bg-white/[0.04]"
                  >
                    <p className="text-[13px] leading-snug text-sbkm-ink-700 dark:text-white/75">
                      {signal.label}
                    </p>
                    <p className="mt-2 text-base font-bold text-sbkm-navy dark:text-sbkm-mint">
                      {signal.value}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-sbkm-navy/10 pt-5 dark:border-white/10 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-sbkm-ink-600 dark:text-white/65">
                Wie gut Sie bei Google gefunden werden
              </p>
              <p className="text-sm font-bold text-sbkm-navy dark:text-sbkm-mint">
                ↑ von Platz 9 auf Platz 3
              </p>
            </div>

            <div className="flex flex-col gap-2 border-t border-sbkm-navy/10 pt-5 dark:border-white/10 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
              <p className="shrink-0 text-sm text-sbkm-ink-600 dark:text-white/65">
                Ihre erfolgreichsten Seiten
              </p>
              <p className="text-sm text-sbkm-ink-500 dark:text-white/50">
                z.&nbsp;B. „Ratgeber: Das erwartet Sie bei der Vorsorgeuntersuch…“
              </p>
            </div>
          </div>
        </DtGlassCard>

        <p className="mt-4 text-center text-[13px] text-sbkm-ink-500 dark:text-white/45">
          Beispielhafte Darstellung — die echten Werte in Ihrem Bericht beziehen sich auf
          Ihre Website.
        </p>
      </FadeIn>
    </section>
  );
}

export function LandingAccess() {
  return (
    <section
      id="zugang"
      className="scroll-mt-24 border-y border-sbkm-navy/10 bg-sbkm-canvas/80 py-12 dark:border-white/10 dark:bg-sbkm-ink-900/40 sm:py-16 lg:py-20"
    >
      <div className="mx-auto w-full max-w-dt px-5 sm:px-14">
        <header className="mx-auto mb-10 max-w-2xl text-center">
          <DtEyebrow>Ihr Zugang</DtEyebrow>
          <DtHeading as="h2" variant="h2" className="mt-3">
            So erhalten Sie Ihren Bericht
          </DtHeading>
          <p className="mx-auto mt-3.5 text-[17px] leading-relaxed text-sbkm-ink-600 dark:text-white/70">
            Kein Account, kein Passwort — nur ein Link, den Sie von uns erhalten.
          </p>
        </header>

        <div className="grid gap-8 md:grid-cols-3 md:gap-6">
          {accessSteps.map((step, i) => (
            <FadeIn key={step.num} delay={0.06 * i} className="text-center md:text-left">
              <span className="mx-auto inline-grid h-11 w-11 place-items-center rounded-full bg-sbkm-navy text-base font-bold text-sbkm-mint dark:bg-sbkm-mint dark:text-sbkm-navy md:mx-0">
                {step.num}
              </span>
              <h3 className="mt-4 text-[18px] font-bold tracking-[-0.015em] text-sbkm-navy dark:text-white">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-sbkm-ink-600 dark:text-white/70">
                {step.body}
              </p>
            </FadeIn>
          ))}
        </div>

        <FadeIn delay={0.18}>
          <p className="mx-auto mt-10 max-w-3xl border-t border-dashed border-sbkm-navy/20 pt-6 text-center text-[13px] leading-relaxed text-sbkm-ink-600 dark:border-white/15 dark:text-white/55">
            Aus Sicherheitsgründen ist der Link zeitlich begrenzt gültig. Ist er
            abgelaufen, genügt eine kurze Nachricht an Ihren Ansprechpartner bei
            Sichtbarkeitsmeister — ein neuer Link ist in wenigen Minuten da.
          </p>
        </FadeIn>

        <FadeIn delay={0.22}>
          <div className="mt-8 flex justify-center">
            <DtPillButton asChild size="lg">
              <a
                href="https://www.sichtbarkeitsmeister.de/kontakt/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Zugang erhalten
              </a>
            </DtPillButton>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
