import { DtGlassCard, DtHeading } from "@/components/dt";

export default function Page() {
  return (
    <DtGlassCard className="w-full max-w-[520px]" padding="lg">
      <DtHeading as="h1" variant="h4">
        Fast geschafft.
      </DtHeading>
      <p className="mt-3 text-sm leading-normal text-sbkm-ink-600 dark:text-white/70">
        Prüfe dein Postfach — wir haben dir einen Magic Link geschickt. Klicke auf
        den Link in der E-Mail, um deinen Zugang abzuschließen.
      </p>
    </DtGlassCard>
  );
}
