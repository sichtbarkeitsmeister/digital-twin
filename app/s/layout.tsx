import { DtPageShell } from "@/components/dt/dt-page-shell";

export default function PublicSurveyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DtPageShell variant="plain" className="min-h-screen">
      {children}
    </DtPageShell>
  );
}
