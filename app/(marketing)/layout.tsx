import { DtFooter } from "@/components/dt/dt-footer";
import { DtMarketingHeader } from "@/components/dt/dt-marketing-header";
import { DtPageShell } from "@/components/dt/dt-page-shell";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DtPageShell variant="marketing" className="flex flex-col">
      <DtMarketingHeader />
      <div className="flex-1">{children}</div>
      <DtFooter />
    </DtPageShell>
  );
}
