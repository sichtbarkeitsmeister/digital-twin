import { redirect } from "next/navigation";

export default async function OrganisationLegacyDetailPage({
  params,
}: {
  params: Promise<{ organisationId: string }>;
}) {
  const { organisationId } = await params;
  redirect(`/dashboard/organisations?org=${encodeURIComponent(organisationId)}`);
}
