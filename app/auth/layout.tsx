import { DtAuthHeader } from "@/components/dt/dt-marketing-header";
import { DtFooter } from "@/components/dt/dt-footer";
import { DtPageShell } from "@/components/dt/dt-page-shell";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DtPageShell variant="auth" className="flex min-h-screen flex-col">
      <DtAuthHeader />
      <main className="flex flex-1 items-center justify-center px-5 py-10 sm:px-14 sm:py-16">
        {children}
      </main>
      <DtFooter
        links={[
          { href: "#", label: "Impressum" },
          { href: "#", label: "Datenschutz" },
          { href: "#", label: "Support" },
        ]}
      />
    </DtPageShell>
  );
}
