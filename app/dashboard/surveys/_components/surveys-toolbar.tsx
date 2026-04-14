"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type Visibility = "" | "public" | "private";
type PageSize = 10 | 20 | 50;

function normalizeVisibility(v: string): Visibility {
  return v === "public" || v === "private" ? v : "";
}

function normalizePageSize(v: string): PageSize {
  const n = Number.parseInt(v, 10);
  return n === 20 || n === 50 ? n : 10;
}

export function SurveysToolbar(props: {
  initialQuery: string;
  initialVisibility: Visibility;
  initialPageSize: PageSize;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState(props.initialQuery);
  const [visibility, setVisibility] = useState<Visibility>(props.initialVisibility);
  const [pageSize, setPageSize] = useState<PageSize>(props.initialPageSize);

  // Keep UI in sync if user navigates via back/forward.
  // Important: do NOT overwrite the search input while it's focused (prevents "jumping" text).
  useEffect(() => {
    const urlQ = searchParams.get("q") ?? "";
    const urlVis = normalizeVisibility(searchParams.get("visibility") ?? "");
    const urlPs = normalizePageSize(searchParams.get("pageSize") ?? "10");

    setVisibility(urlVis);
    setPageSize(urlPs);

    const isFocused = document.activeElement === inputRef.current;
    if (!isFocused) setQuery(urlQ);
  }, [searchParams]);

  const baseParamsString = useMemo(() => searchParams.toString(), [searchParams]);

  const replaceParams = (next: {
    q?: string;
    visibility?: Visibility;
    pageSize?: PageSize;
    page?: number;
  }) => {
    const sp = new URLSearchParams(baseParamsString);

    // Always reset to page 1 when changing filters.
    sp.set("page", String(next.page ?? 1));

    const q = (next.q ?? query).trim();
    if (q) sp.set("q", q);
    else sp.delete("q");

    const vis = next.visibility ?? visibility;
    if (vis) sp.set("visibility", vis);
    else sp.delete("visibility");

    const ps = next.pageSize ?? pageSize;
    sp.set("pageSize", String(ps));

    const qs = sp.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  };

  // Instant search (debounced).
  useEffect(() => {
    const handle = window.setTimeout(() => {
      replaceParams({ q: query });
    }, 250);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Suchen (Titel, Beschreibung, Slug)…"
        className="sm:w-[320px]"
      />

      <Select
        value={visibility}
        onChange={(e) => {
          const v = normalizeVisibility(e.target.value);
          setVisibility(v);
          replaceParams({ visibility: v });
        }}
        aria-label="Sichtbarkeit"
      >
        <option value="">Alle</option>
        <option value="public">Öffentlich</option>
        <option value="private">Privat</option>
      </Select>

      <Select
        value={String(pageSize)}
        onChange={(e) => {
          const ps = normalizePageSize(e.target.value);
          setPageSize(ps);
          replaceParams({ pageSize: ps });
        }}
        aria-label="Seitengröße"
      >
        <option value="10">10 / Seite</option>
        <option value="20">20 / Seite</option>
        <option value="50">50 / Seite</option>
      </Select>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={
          isPending &&
          query.trim() === "" &&
          visibility === "" &&
          pageSize === 10
        }
        onClick={() => {
          setQuery("");
          setVisibility("");
          setPageSize(10);
          startTransition(() => {
            router.replace(pathname, { scroll: false });
          });
        }}
      >
        Zurücksetzen
      </Button>
    </div>
  );
}

