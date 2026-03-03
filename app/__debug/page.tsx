export default function DebugPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <h1 className="text-2xl font-bold tracking-tight">Debug page</h1>
      <p className="mt-2 text-sm text-secondary">
        This page is intentionally static (no Supabase, no cookies/headers).
      </p>
    </div>
  );
}

