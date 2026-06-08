import { redirect } from "next/navigation";

/** Chat lives on `/`; keep this route for old bookmarks. */
export default async function DigitalTwinDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; scope?: string; chat?: string }>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  if (sp.org) qs.set("org", sp.org);
  if (sp.scope) qs.set("scope", sp.scope);
  if (sp.chat) qs.set("chat", sp.chat);
  const q = qs.toString();
  redirect(q ? `/?${q}` : "/");
}
