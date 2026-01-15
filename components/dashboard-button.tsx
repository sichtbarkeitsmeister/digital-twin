import Link from "next/link";
import { Button } from "./ui/button";

export function DashboardButton() {
  return (
    <>
      <Link href="/dashboard">
        <Button size="sm">
          <span>Dashboard</span>
        </Button>
      </Link>
    </>
  );
}
