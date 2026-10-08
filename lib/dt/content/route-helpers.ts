import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { loadContentLocalSources } from "@/lib/dt/content/load-sources";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import type { ContentLocalSources, ContentReadiness } from "@/lib/dt/content/types";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const orgIdSchema = z.string().uuid();

/** Path segments used as DB keys — never let `/`, `..` or `?` through. */
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,159}$/i;

export function isValidContentSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

export function isValidContentJobId(id: string): boolean {
  return z.string().uuid().safeParse(id).success;
}

export function parseContentStep(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 8 ? n : null;
}

export type ContentGate = {
  /** Signed-in user's client (RLS) — for reads of shared tables. */
  supabase: SupabaseClient;
  /** Service client — for the content tables; access was already checked. */
  service: SupabaseClient;
  userId: string;
  userEmail: string | null;
  organisationId: string;
};

export function contentError(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status });
}

export function contentOk<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

/** Same access rule as the SEO workspace (platform admin; org must exist and be enabled). */
export async function gateContentRoute(
  organisationId: unknown,
): Promise<{ ok: true; gate: ContentGate } | { ok: false; response: NextResponse }> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user?.id) {
    return { ok: false, response: contentError("Nicht angemeldet.", 401) };
  }

  const parsed = orgIdSchema.safeParse(organisationId);
  if (!parsed.success) {
    return { ok: false, response: contentError("Ungültige Organisation.", 400) };
  }

  const access = await requireDtSeoAccess(supabase, user.id, parsed.data);
  if (!access.ok) {
    return { ok: false, response: contentError(access.message, access.status) };
  }

  return {
    ok: true,
    gate: {
      supabase,
      service: createServiceClient(),
      userId: user.id,
      userEmail: user.email ?? null,
      organisationId: parsed.data,
    },
  };
}

export async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** „11 von 13 Abschnitten aus den Gesprächen · 24 Antworten aus dem Anbieter-Fragebogen „…““ */
export function describeAnbieterSources(anbieter: ContentLocalSources["anbieter"]): string | null {
  if (!anbieter) return null;
  const parts: string[] = [];
  if (anbieter.workshop) {
    parts.push(`${anbieter.workshop.filled} von ${anbieter.workshop.total} Abschnitten aus den Gesprächen`);
  }
  if (anbieter.fragebogen) {
    const n = anbieter.fragebogen.facts;
    parts.push(`${n} ${n === 1 ? "Antwort" : "Antworten"} aus dem Anbieter-Fragebogen „${anbieter.fragebogen.title}“`);
  }
  return parts.join(" · ");
}

function pagesWord(n: number): string {
  return `${n} ${n === 1 ? "Seite" : "Seiten"}`;
}

function deDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" });
}

/**
 * The „Seiten“ check has two sources: the uploaded Seitenstruktur (Excel template, for a
 * client without a website) or the pages taken over from the crawl of the existing site.
 */
export function describeSeiten(local: Pick<ContentLocalSources, "structure" | "crawl" | "pages">): {
  ok: boolean;
  hint: string;
} {
  const parts: string[] = [];
  if (local.pages.structure > 0) {
    parts.push(
      local.structure
        ? `${pagesWord(local.pages.structure)} aus der Seitenstruktur${local.structure.filename?.trim() ? ` „${local.structure.filename.trim()}“` : ""}`
        : `${pagesWord(local.pages.structure)} in der Tabelle`,
    );
  }
  if (local.pages.crawl > 0) {
    const stand = deDate(local.crawl.lastCrawledAt);
    parts.push(`${pagesWord(local.pages.crawl)} aus dem Crawl${stand ? ` (Stand ${stand})` : ""}`);
  }
  if (parts.length > 0) return { ok: true, hint: `${parts.join(" · ")}.` };

  if (local.structure) {
    return {
      ok: true,
      hint: `Seitenstruktur „${local.structure.filename?.trim() || "ohne Dateiname"}“ hochgeladen – die Seiten erscheinen beim nächsten Laden der Tabelle.`,
    };
  }
  if (local.crawl.pageCount > 0) {
    return {
      ok: false,
      hint: `${pagesWord(local.crawl.pageCount)} gecrawlt, aber noch nicht übernommen – unter „Seitenquelle“ auf „Seiten übernehmen“ klicken.`,
    };
  }
  return {
    ok: false,
    hint: "Keine Seiten. Entweder die Excel-Seitenstruktur hochladen (Kunde ohne Website) oder die bestehende Website crawlen – beides unter „Seitenquelle“.",
  };
}

/** The three readiness checks from DigitalTwin's own tables. */
export function readinessFromLocal(local: ContentLocalSources): ContentReadiness {
  const sources = describeAnbieterSources(local.anbieter);
  const seiten = describeSeiten(local);
  const checks: ContentReadiness["checks"] = [
    {
      id: "anbieter",
      ok: Boolean(local.anbieter),
      label: "Anbieterfakten",
      hint: sources
        ? `${sources}.`
        : "Noch keine Anbieterfakten: weder ein ausgefüllter Anbieter-Fragebogen noch ausgewertete Gespräche.",
    },
    {
      id: "avatar",
      ok: local.avatarCount > 0,
      label: "Avatar",
      hint:
        local.avatarCount > 0
          ? `${local.avatarCount} Avatar${local.avatarCount === 1 ? "" : "e"} verfügbar.`
          : "Noch kein Avatar für diese Organisation angelegt.",
    },
    {
      id: "structure",
      ok: seiten.ok,
      label: "Seiten",
      hint: seiten.hint,
    },
  ];
  return { ready: checks.every((c) => c.ok), checks };
}

export async function loadContentReadiness(
  service: SupabaseClient,
  organisationId: string,
): Promise<{ readiness: ContentReadiness; local: ContentLocalSources }> {
  const local = await loadContentLocalSources(service, organisationId);
  return { readiness: readinessFromLocal(local), local };
}
