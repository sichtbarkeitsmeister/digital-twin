import { redirect } from "next/navigation";

/** Agent marketplace moved under Verwaltung. */
export default function DigitalTwinAgentsRedirectPage() {
  redirect("/dashboard/verwaltung/agents");
}
