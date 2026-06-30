"use client";

import { usePathname } from "next/navigation";

import { isDashboardChatFocusPath } from "@/app/dashboard/_components/dashboard-main-area";
import { DtLogo } from "@/components/dt/dt-logo";

export function DashboardLogoLink(props: {
  size?: "sm" | "md" | "lg" | "auth" | "header" | "sidebar" | "compact";
  className?: string;
}) {
  const pathname = usePathname();
  const href = isDashboardChatFocusPath(pathname) ? "/" : "/dashboard";

  return <DtLogo href={href} size={props.size} className={props.className} />;
}
