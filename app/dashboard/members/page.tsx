import { redirect } from "next/navigation";

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org: orgParam } = await searchParams;
  const target = orgParam
    ? `/dashboard/organisations?org=${encodeURIComponent(orgParam)}`
    : "/dashboard/organisations";
  redirect(target);
}
