import { DtFooter } from "@/components/dt/dt-footer";
import { DtMarketingHeader } from "@/components/dt/dt-marketing-header";
import { DtPageShell } from "@/components/dt/dt-page-shell";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DtPageShell
      variant="marketing"
      className="group/marketing flex min-h-0 flex-col has-[.dt-home-chat]:h-dvh has-[.dt-home-chat]:max-h-dvh has-[.dt-home-chat]:overflow-hidden"
    >
      <DtMarketingHeader />
      <div className="min-h-0 flex-1">{children}</div>
      <DtFooter className="shrink-0 group-has-[.dt-home-chat]/marketing:hidden" />
    </DtPageShell>
  );
}
