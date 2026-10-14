import { redirect } from "next/navigation";

/** Agent marketplace moved under Verwaltung. */
export default async function DigitalTwinAgentsRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const sp = await searchParams;
  if (sp.view === "prompts") {
    redirect("/dashboard/verwaltung/globale-prompts");
  }
  redirect("/dashboard/verwaltung/agents");
}
