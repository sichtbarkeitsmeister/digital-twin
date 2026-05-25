import { Suspense } from "react";

import { AuthCard } from "@/components/dt/auth-card";

function AuthFallback() {
  return (
    <div className="h-[420px] w-full max-w-[520px] animate-pulse rounded-dt-lg bg-white/40 backdrop-blur-xl" />
  );
}

export default function SignUpPage() {
  return (
    <Suspense fallback={<AuthFallback />}>
      <AuthCard defaultTab="signup" />
    </Suspense>
  );
}
