import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { DtToaster } from "@/components/dt/dt-toaster";
import "./globals.css";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: "DigitalTwin — Bevor ein Text online geht, wissen wir, ob er ankommt",
  description:
    "Der DigitalTwin verbindet SEO-Wissen mit der Analyse Ihrer Wunschkunden. Texte werden vor Veröffentlichung geprüft — entwickelt und betreut von Sichtbarkeitsmeister.",
};

const poppins = Poppins({
  variable: "--font-poppins",
  display: "swap",
  subsets: ["latin"],
  weight: ["100", "400", "700"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" suppressHydrationWarning>
      <body className={`${poppins.variable} font-sans antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
          <DtToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
