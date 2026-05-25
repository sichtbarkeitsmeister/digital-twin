import { DtFooter } from "@/components/dt/dt-footer";
import { DtPageShell } from "@/components/dt/dt-page-shell";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DtPageShell variant="marketing" className="flex min-h-screen flex-col">
      <div className="flex-1">{children}</div>
      <DtFooter />
    </DtPageShell>
  );
}
