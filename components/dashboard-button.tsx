import Link from "next/link";

import { DtPillButton } from "@/components/dt/dt-pill-button";

export function DashboardButton() {
  return (
    <DtPillButton asChild size="sm" variant="solid">
      <Link href="/dashboard/members" prefetch>
        Dashboard
      </Link>
    </DtPillButton>
  );
}
