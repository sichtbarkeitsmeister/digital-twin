import { redirect } from "next/navigation";

/** SEO Modus moved under Verwaltung. */
export default async function DigitalTwinSeoRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const sp = await searchParams;
  const qs = sp.org ? `?org=${encodeURIComponent(sp.org)}` : "";
  redirect(`/dashboard/verwaltung/seo${qs}`);
}
