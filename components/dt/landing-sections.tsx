import Link from "next/link";
import { Check } from "lucide-react";

import {
  DtEyebrow,
  DtGlassCard,
  DtHeading,
  DtMetaChip,
  DtPillButton,
  DtStatTile,
} from "@/components/dt";

const pipelineSteps = [
  {
    num: "1",
    title: "Schreiben",
    body: "Brief eingeben, Zwilling entwirft in deiner Markenstimme. Du redigierst — er recherchiert, prüft Keywords und schlägt Headlines vor.",
    meta: "~ 40 min pro Beitrag",
  },
  {
    num: "2",
    title: "Prüfen",
    body: "Markenstimme-Score, SEO-Briefing, GEO-Check für ChatGPT & Perplexity. Freigaben mit einem Klick, kommentierbar im Team.",
    meta: "≥ 90 % Stimmen-Score",
  },
  {
    num: "3",
    title: "Veröffentlichen",
    body: "Direkt in WordPress, LinkedIn, Newsletter oder Google for Jobs. Reichweite und Rankings landen am Tag danach im Dashboard.",
    meta: "Auto-Publishing in 9 Kanälen",
  },
];

const trustStats = [
  {
    label: "Top-10-Rankings",
    value: "401",
    description: "+27 in den letzten 30 Tagen",
  },
  {
    label: "Ø Markenstimme-Score",
    value: "94 %",
    description: "+6 Punkte ggü. Quartal",
  },
  {
    label: "Content-Teams im Einsatz",
    value: "128",
    description: "Praxen, Kanzleien, Handwerk",
  },
  {
    label: "Stunden gespart / Monat",
    value: "38,5 h",
    description: "pro Redakteur:in im Schnitt",
  },
];

const heroChecks = [
  "DSGVO-konform · Hosting in DE",
  "Trainiert auf deiner Markenstimme",
  "Keine Kreditkarte nötig",
];

export function LandingHero() {
  return (
    <section className="mx-auto flex w-full max-w-dt items-center px-5 py-10 sm:px-14 sm:py-16 lg:py-24">
      <div className="w-full text-left">
        <DtEyebrow dot>KI-Assistent für Content-Teams</DtEyebrow>

        <DtHeading as="h1" variant="hero" className="mt-7">
          <span className="inline-block">Schreiben.</span>{" "}
          <span className="inline-block">Prüfen.</span>{" "}
          <span className="inline-block">Veröffentlichen.</span>
        </DtHeading>

        <p className="mt-5 max-w-[620px] text-pretty text-[clamp(1.05rem,0.6vw+1rem,1.35rem)] leading-normal text-sbkm-ink-600 dark:text-white/75">
          Minimal, schnell und fokussiert — dein digitaler Zwilling übernimmt Recherche,
          Markenstimme-Check und Veröffentlichung. Planbar. Messbar.
        </p>

        <div className="mt-9 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
          <DtPillButton asChild size="lg">
            <Link href="/auth/sign-up">Zugang anfordern</Link>
          </DtPillButton>
          <DtPillButton asChild variant="outline" size="lg">
            <Link href="/dashboard">Live-Demo öffnen</Link>
          </DtPillButton>
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-sbkm-ink-600 dark:text-white/70">
          {heroChecks.map((item) => (
            <span key={item} className="inline-flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-sbkm-mint" strokeWidth={2.4} />
              {item}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

export function LandingPipeline() {
  return (
    <section id="pipeline" className="mx-auto w-full max-w-dt px-5 py-10 sm:px-14 sm:py-16 lg:py-20">
      <header className="mb-10 text-center">
        <DtEyebrow>Der Workflow</DtEyebrow>
        <DtHeading as="h2" variant="h2" className="mt-3">
          Vom leeren Cursor zum Live-Beitrag — in drei klaren Schritten.
        </DtHeading>
        <p className="mx-auto mt-3.5 max-w-[580px] text-[17px] leading-normal text-sbkm-ink-600 dark:text-white/70">
          Kein Rätselraten, keine Blackbox. Du siehst jederzeit, was passiert — und wer
          es freigegeben hat.
        </p>
      </header>

      <div className="grid gap-5 md:grid-cols-3">
        {pipelineSteps.map((step) => (
          <DtGlassCard
            key={step.num}
            variant="subtle"
            padding="sm"
            className="flex flex-col gap-3 transition-[transform,box-shadow] duration-200 ease-dt hover:-translate-y-0.5 hover:shadow-[0_16px_40px_rgba(46,46,80,0.12)] dark:hover:shadow-[0_16px_40px_rgba(0,0,0,0.35)]"
          >
            <span className="inline-grid h-[42px] w-[42px] place-items-center rounded-[14px] bg-sbkm-navy text-base font-bold tracking-[-0.02em] text-white dark:bg-sbkm-mint dark:text-sbkm-navy">
              {step.num}
            </span>
            <h3 className="text-[22px] font-bold tracking-[-0.015em] text-sbkm-navy dark:text-white">
              {step.title}
            </h3>
            <p className="text-sm leading-[1.55] text-sbkm-ink-600 dark:text-white/70">
              {step.body}
            </p>
            <DtMetaChip className="mt-auto">{step.meta}</DtMetaChip>
          </DtGlassCard>
        ))}
      </div>
    </section>
  );
}

export function LandingTrust() {
  return (
    <section id="trust" className="mx-auto mb-8 grid w-full max-w-dt gap-4 px-5 sm:grid-cols-2 sm:px-14 lg:grid-cols-4">
      {trustStats.map((stat) => (
        <DtStatTile key={stat.label} {...stat} />
      ))}
    </section>
  );
}
