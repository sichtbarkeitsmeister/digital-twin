import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

import { renderDtPortalWelcomeEmail } from "@/lib/email/templates/dt-portal-welcome";
import { getAppBaseUrl, sendEmail } from "@/lib/email/mailer";
import {
  legacyClientSlug,
  resolveLegacyClientKey,
  resolveWebsiteContentClient,
  resolveWebsiteContentUrl,
  stripLegacyEqualsPrefix,
} from "@/lib/dt/migration/client-slug";
import type {
  MigrationCounts,
  MigrationOptions,
  OrgMapEntry,
  VerificationMismatch,
} from "@/lib/dt/migration/types";

const BATCH = 500;

type Row = Record<string, unknown>;

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function bool(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

function normalizeTaskPriority(raw: string): string | null {
  const s = raw.toLowerCase();
  if (s === "hoch" || s === "high" || s === "urgent") return s === "urgent" ? "urgent" : "high";
  if (s === "mittel" || s === "medium") return "medium";
  if (s === "niedrig" || s === "low") return "low";
  return null;
}

function normalizeTaskStatus(raw: string): "open" | "in_progress" | "done" | "wont_fix" {
  const s = raw.toLowerCase();
  if (s.includes("erledigt") || s === "done" || s === "completed") return "done";
  if (s.includes("in_arbeit") || s.includes("progress") || s.includes("arbeit")) return "in_progress";
  if (s.includes("wont") || s.includes("abgelehnt")) return "wont_fix";
  return "open";
}

function chatModeFromSession(sessionId: string): "team" | "seo" | "default" {
  if (sessionId.startsWith("session_team_")) return "team";
  if (sessionId.startsWith("session_seo_")) return "seo";
  return "default";
}

async function fetchAllOld<T extends Row>(
  old: SupabaseClient,
  table: string,
  order?: string,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  const page = 1000;
  while (true) {
    let q = old.from(table).select("*").range(from, from + page - 1);
    if (order) q = q.order(order, { ascending: true });
    const { data, error } = await q;
    if (error) throw new Error(`OLD ${table}: ${error.message}`);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < page) break;
    from += page;
  }
  return rows;
}

export function createMigrationClients() {
  const oldUrl = process.env.OLD_SUPABASE_URL?.trim() ?? "https://zijlepanidmvwxbuwldz.supabase.co";
  const oldKey =
    process.env.OLD_SUPABASE_SERVICE_ROLE_KEY?.trim() ??
    process.env.OLD_SUPABASE_SERVICE_ROLE?.trim() ??
    process.env.OLD_SUPABASE_ANON_KEY?.trim();
  const newUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const newKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!oldKey) {
    throw new Error(
      "Missing OLD_SUPABASE_SERVICE_ROLE_KEY or OLD_SUPABASE_ANON_KEY (legacy anon can read most tables).",
    );
  }
  if (!newUrl || !newKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return {
    old: createClient(oldUrl, oldKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    new: createClient(newUrl, newKey, { auth: { persistSession: false, autoRefreshToken: false } }),
  };
}

async function resolveMigrationActorId(newDb: SupabaseClient): Promise<string> {
  const fromEnv = process.env.DT_MIGRATION_INVITED_BY_USER_ID?.trim();
  if (fromEnv) return fromEnv;

  const { data: admin } = await newDb
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .limit(1)
    .maybeSingle();
  if (admin?.id) return str(admin.id);

  const { data: anyUser } = await newDb.from("profiles").select("id").limit(1).maybeSingle();
  if (anyUser?.id) return str(anyUser.id);

  throw new Error(
    "No platform admin profile found. Set DT_MIGRATION_INVITED_BY_USER_ID in .env.local.",
  );
}

export async function buildOrgMap(
  old: SupabaseClient,
  newDb: SupabaseClient,
  opts: MigrationOptions,
): Promise<{ entries: OrgMapEntry[]; unmapped: string[] }> {
  const actorId = await resolveMigrationActorId(newDb);
  const slugSet = new Set<string>();

  for (const table of ["seo_clients", "client_config", "persona_prompts", "chat_messages"] as const) {
    try {
      const rows = await fetchAllOld<Row>(old, table);
      for (const row of rows) {
        const key = resolveLegacyClientKey(row);
        if (key) slugSet.add(key);
      }
    } catch {
      // table may be missing on some OLD projects
    }
  }

  const slugs = [...slugSet].filter((s) =>
    opts.orgFilter ? s === opts.orgFilter || legacyClientSlug(opts.orgFilter) === s : true,
  );

  const { data: orgs } = await newDb.from("organisations").select("id,name,slug");
  const bySlug = new Map((orgs ?? []).map((o) => [str(o.slug), o]));

  const entries: OrgMapEntry[] = [];
  const unmapped: string[] = [];

  for (const legacyClient of slugs.sort()) {
    const existing = bySlug.get(legacyClient);
    if (existing) {
      entries.push({
        legacyClient,
        organisationId: str(existing.id),
        organisationName: str(existing.name),
        created: false,
      });
      continue;
    }

    unmapped.push(legacyClient);
    if (opts.apply && !opts.dryRun) {
      const name = legacyClient.replace(/-/g, " ");
      const { data: created, error } = await newDb
        .from("organisations")
        .insert({ name, slug: legacyClient, created_by_user_id: actorId })
        .select("id,name,slug")
        .single();
      if (error || !created) {
        throw new Error(`Could not create org ${legacyClient}: ${error?.message}`);
      }
      entries.push({
        legacyClient,
        organisationId: str(created.id),
        organisationName: str(created.name),
        created: true,
      });
    }
  }

  return { entries, unmapped };
}

async function resolveAgentId(
  newDb: SupabaseClient,
  orgId: string,
  avatarSlug: string,
): Promise<string | null> {
  const slug = avatarSlug || "default";
  const { data } = await newDb
    .from("dt_agents")
    .select("id")
    .eq("organisation_id", orgId)
    .eq("slug", slug)
    .maybeSingle();
  if (data?.id) return str(data.id);

  const { data: fallback } = await newDb
    .from("dt_agents")
    .select("id")
    .eq("organisation_id", orgId)
    .eq("slug", "default")
    .maybeSingle();
  return fallback?.id ? str(fallback.id) : null;
}

async function resolveOrgOwnerUserId(newDb: SupabaseClient, orgId: string): Promise<string | null> {
  const { data } = await newDb
    .from("organisation_members")
    .select("user_id")
    .eq("organisation_id", orgId)
    .eq("org_role", "owner")
    .limit(1)
    .maybeSingle();
  return data?.user_id ? str(data.user_id) : null;
}

export async function runDtMigration(opts: MigrationOptions): Promise<{
  counts: MigrationCounts;
  mismatches: VerificationMismatch[];
  orgEntries: OrgMapEntry[];
}> {
  const { old, new: newDb } = createMigrationClients();
  const counts: MigrationCounts = {
    orgConfigs: 0,
    agents: 0,
    seoTasks: 0,
    chats: 0,
    messages: 0,
    reports: 0,
    sitePages: 0,
    archived: 0,
    invites: 0,
  };

  const logPath = join(
    process.cwd(),
    "logs",
    `dt-migration-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`,
  );
  mkdirSync(join(process.cwd(), "logs"), { recursive: true });

  const log = (event: Record<string, unknown>) => {
    appendFileSync(logPath, `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
  };

  log({ event: "start", dryRun: opts.dryRun, apply: opts.apply, orgFilter: opts.orgFilter });

  const { entries: orgEntries, unmapped } = await buildOrgMap(old, newDb, opts);

  if (unmapped.length > 0 && !opts.apply) {
    const reviewPath = join(process.cwd(), "scripts", "dt-migration-org-review.tsv");
    const lines = ["legacy_client\tsuggested_name\taction"];
    for (const s of unmapped) {
      lines.push(`${s}\t${s.replace(/-/g, " ")}\tcreate_or_map`);
    }
    writeFileSync(reviewPath, `${lines.join("\n")}\n`, "utf8");
    console.warn(`Unmapped clients (${unmapped.length}) → ${reviewPath}`);
    console.warn("Re-run with --apply to create organisations for unmapped slugs.");
  }

  if (orgEntries.length === 0) {
    const { data: fallbackOrgs } = await newDb.from("organisations").select("id,name,slug");
    for (const o of fallbackOrgs ?? []) {
      const slug = str(o.slug);
      if (!slug) continue;
      if (opts.orgFilter && slug !== opts.orgFilter && legacyClientSlug(opts.orgFilter) !== slug) {
        continue;
      }
      orgEntries.push({
        legacyClient: slug,
        organisationId: str(o.id),
        organisationName: str(o.name),
        created: false,
      });
    }
  }

  if (orgEntries.length === 0) {
    throw new Error("No organisations to migrate. Check --org filter or create org mappings first.");
  }

  const orgByClient = new Map(orgEntries.map((e) => [e.legacyClient, e]));

  // --- persona_prompts → dt_agents ---
  try {
    const personas = await fetchAllOld<Row>(old, "persona_prompts");
    for (const row of personas) {
      const client = resolveLegacyClientKey(row);
      if (!client || !orgByClient.has(client)) continue;
      const org = orgByClient.get(client)!;
      const avatarId = str(row.avatar_id) || "default";
      const kind =
        avatarId === "seo_advisor"
          ? "seo_advisor"
          : avatarId === "geo_advisor"
            ? "geo_advisor"
            : avatarId.includes("wunschkunde")
              ? "wunschkunde"
              : "persona";

      const avatarData = row.avatar_data as Record<string, unknown> | null;
      const name =
        str(row.name) ||
        str(avatarData?.name_clean) ||
        str(avatarData?.name) ||
        avatarId.replace(/_/g, " ");
      const role = str(row.role) || str(avatarData?.rolle_kurz) || str(avatarData?.role) || null;

      if (opts.dryRun || !opts.apply) {
        counts.agents++;
        continue;
      }

      const { error } = await newDb.from("dt_agents").upsert(
        {
          organisation_id: org.organisationId,
          kind,
          slug: avatarId,
          name,
          role,
          prompt_template: str(row.prompt_template) || "Du bist ein hilfreicher Assistent.",
          avatar_data: row.avatar_data ?? {},
          quick_actions: row.quick_actions ?? [],
          is_enabled: row.is_enabled !== false,
          position: Number(row.position) || 0,
        },
        { onConflict: "organisation_id,slug" },
      );
      if (error) console.warn(`agent ${client}/${avatarId}:`, error.message);
      else counts.agents++;
    }
  } catch (e) {
    console.warn("persona_prompts skipped:", e);
  }

  // --- seo_clients → dt_org_config ---
  try {
    const clients = await fetchAllOld<Row>(old, "seo_clients");
    for (const row of clients) {
      const client = resolveLegacyClientKey(row);
      if (!client || !orgByClient.has(client)) continue;
      const org = orgByClient.get(client)!;

      const patch = {
        organisation_id: org.organisationId,
        display_name: str(row.kunde) || org.organisationName,
        website_url: str(row.url) || null,
        ga4_property_id: str(row.ga4_property_id) || null,
        gsc_site_url: str(row.gsc_site_url) || null,
        ga4_account: str(row.ga4_account) || null,
        gsc_account: str(row.gsc_account) || null,
        sistrix_domain: str(row.sistrix_domain) || null,
        focus_keyword: str(row.focus_keyword) || null,
        report_recipient_email: str(row.recipient_email) || null,
        report_timeframe: str(row.timeframe) || "last_30_days",
        seo_enabled: bool(row.aktiv),
        seo_checklist: row.seo_checklist ?? [],
        sitemap_url: str(row.sitemap_url) || null,
        twin_provisioned: true,
      };

      if (opts.dryRun || !opts.apply) {
        counts.orgConfigs++;
        continue;
      }

      const { error } = await newDb.from("dt_org_config").upsert(patch, {
        onConflict: "organisation_id",
      });
      if (error) console.warn(`org_config ${client}:`, error.message);
      else counts.orgConfigs++;
    }
  } catch (e) {
    console.warn("seo_clients skipped:", e);
  }

  // --- seo_tasks ---
  try {
    const tasks = await fetchAllOld<Row>(old, "seo_tasks");
    for (const row of tasks) {
      const client = resolveLegacyClientKey(row);
      if (!client || !orgByClient.has(client)) continue;
      const org = orgByClient.get(client)!;

      if (opts.dryRun || !opts.apply) {
        counts.seoTasks++;
        continue;
      }

      const { error } = await newDb.from("dt_seo_tasks").insert({
        organisation_id: org.organisationId,
        title: str(row.title) || "SEO-Aufgabe",
        url: str(row.url) || null,
        keyword: str(row.keyword) || null,
        current_status: str(row.current_status) || null,
        action: str(row.action) || null,
        assigned_to_label: str(row.assigned_to ?? row.assignee) || null,
        status: normalizeTaskStatus(str(row.status) || "offen"),
        priority: normalizeTaskPriority(str(row.priority)),
        notes: str(row.notes) || null,
        created_at: row.created_at ?? undefined,
        updated_at: row.updated_at ?? undefined,
      });
      if (error && !error.message.includes("duplicate")) {
        console.warn(`seo_task ${client}:`, error.message);
      } else counts.seoTasks++;
    }
  } catch (e) {
    console.warn("seo_tasks skipped:", e);
  }

  // --- chat_messages → dt_chats + dt_chat_messages ---
  const ownerByOrg = new Map<string, string | null>();
  let allMessages: Row[] = [];
  try {
    allMessages = await fetchAllOld<Row>(old, "chat_messages", "created_at");
  } catch (e) {
    console.warn("chat_messages skipped:", e);
  }

  const bySession = new Map<string, Row[]>();
  for (const row of allMessages) {
    const client = resolveLegacyClientKey(row);
    if (!client || !orgByClient.has(client)) continue;
    if (opts.orgFilter && client !== opts.orgFilter && legacyClientSlug(opts.orgFilter) !== client) {
      continue;
    }
    const sid = str(row.session_id);
    if (!sid) continue;
    const key = `${client}::${sid}`;
    const list = bySession.get(key) ?? [];
    list.push(row);
    bySession.set(key, list);
  }

  for (const [key, msgs] of bySession) {
    const [client, sessionId] = key.split("::");
    const org = orgByClient.get(client)!;
    const mode = chatModeFromSession(sessionId);
    const avatarId = str(msgs[0]?.avatar_id) || "default";

    if (opts.dryRun || !opts.apply) {
      counts.chats++;
      counts.messages += msgs.length;
      continue;
    }

    const { data: existingChat } = await newDb
      .from("dt_chats")
      .select("id")
      .eq("organisation_id", org.organisationId)
      .eq("legacy_session_id", sessionId)
      .maybeSingle();

    if (existingChat?.id) {
      continue;
    }

    if (!ownerByOrg.has(org.organisationId)) {
      ownerByOrg.set(org.organisationId, await resolveOrgOwnerUserId(newDb, org.organisationId));
    }
    const agentId = await resolveAgentId(newDb, org.organisationId, avatarId);
    if (!agentId) {
      console.warn(`No agent for ${client}/${avatarId}, skip session ${sessionId}`);
      continue;
    }

    const firstUser = msgs.find((m) => str(m.role) === "user");
    const titleSource = str(firstUser?.message ?? firstUser?.content) || "Migrierter Chat";
    const title = titleSource.slice(0, 60);

    const owner = mode === "default" ? ownerByOrg.get(org.organisationId) ?? null : null;

    const { data: chatRow, error: chatErr } = await newDb
      .from("dt_chats")
      .insert({
        organisation_id: org.organisationId,
        agent_id: agentId,
        mode,
        owner_user_id: owner,
        title,
        legacy_session_id: sessionId,
      })
      .select("id")
      .single();

    if (chatErr || !chatRow) {
      console.warn(`chat ${sessionId}:`, chatErr?.message);
      continue;
    }
    const chatId = str(chatRow.id);
    counts.chats++;

    for (let i = 0; i < msgs.length; i += BATCH) {
      const slice = msgs.slice(i, i + BATCH);
      const payload = slice.map((m) => ({
        chat_id: chatId,
        role: str(m.role) === "assistant" ? "assistant" : "user",
        content: str(m.message ?? m.content) || "",
        metadata: m.metadata ?? {},
        created_at: m.created_at ?? undefined,
      }));

      const { error } = await newDb.from("dt_chat_messages").insert(payload);
      if (error) {
        console.warn(`messages ${sessionId} batch:`, error.message);
      } else {
        counts.messages += slice.length;
      }
    }

    const lastAt = msgs[msgs.length - 1]?.created_at;
    if (lastAt) {
      await newDb.from("dt_chats").update({ updated_at: lastAt }).eq("id", chatId);
    }
  }

  // --- seo_cache → dt_seo_reports ---
  try {
    const caches = await fetchAllOld<Row>(old, "seo_cache");
    for (const row of caches) {
      const client = resolveLegacyClientKey(row);
      if (!client || !orgByClient.has(client)) continue;
      const org = orgByClient.get(client)!;
      const email = str(row.recipient_email) || "migration@local";

      if (opts.dryRun || !opts.apply) {
        counts.reports++;
        continue;
      }

      const { error } = await newDb.from("dt_seo_reports").insert({
        organisation_id: org.organisationId,
        recipient_type: "kunde",
        recipient_email: email,
        state: "done",
        payload: row.data ?? row.payload ?? {},
        started_at: row.updated_at ?? row.created_at ?? undefined,
        finished_at: row.updated_at ?? row.created_at ?? undefined,
      });
      if (error) console.warn(`seo_cache ${client}:`, error.message);
      else counts.reports++;
    }
  } catch (e) {
    console.warn("seo_cache skipped:", e);
  }

  // --- archived_sessions ---
  try {
    const archived = await fetchAllOld<Row>(old, "archived_sessions");
    for (const row of archived) {
      const client = resolveLegacyClientKey(row);
      const sessionId = str(row.session_id);
      if (!client || !sessionId || !orgByClient.has(client)) continue;
      const org = orgByClient.get(client)!;

      if (opts.dryRun || !opts.apply) {
        counts.archived++;
        continue;
      }

      const { error } = await newDb
        .from("dt_chats")
        .update({ archived_at: row.archived_at ?? new Date().toISOString() })
        .eq("organisation_id", org.organisationId)
        .eq("legacy_session_id", sessionId);
      if (!error) counts.archived++;
    }
  } catch (e) {
    console.warn("archived_sessions skipped:", e);
  }

  // --- website_content → dt_site_pages ---
  try {
    const pages = await fetchAllOld<Row>(old, "website_content");
    for (const row of pages) {
      const client = resolveWebsiteContentClient(row);
      if (!client || !orgByClient.has(client)) continue;
      const org = orgByClient.get(client)!;
      const url = resolveWebsiteContentUrl(row, client);
      if (!url) continue;

      if (opts.dryRun || !opts.apply) {
        counts.sitePages++;
        continue;
      }

      const { error } = await newDb.from("dt_site_pages").upsert(
        {
          organisation_id: org.organisationId,
          url,
          title: stripLegacyEqualsPrefix(str(row.title)) || null,
          h1: stripLegacyEqualsPrefix(str(row.h1)) || null,
          meta_description: stripLegacyEqualsPrefix(str(row.meta_description)) || null,
          text_content: stripLegacyEqualsPrefix(str(row.text_content ?? row.content)) || null,
          is_excluded: bool(row.is_excluded),
          crawled_at: row.crawled_at ?? row.updated_at ?? undefined,
        },
        { onConflict: "organisation_id,url" },
      );
      if (error) console.warn(`site_page ${url}:`, error.message);
      else counts.sitePages++;
    }
  } catch (e) {
    console.warn("website_content skipped:", e);
  }

  // --- invites preview / send ---
  const inviteRows: string[] = ["email\torganisation\tlegacy_client\treason"];
  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const recentClients = new Set<string>();
  for (const row of allMessages) {
    const client = resolveLegacyClientKey(row);
    if (!client) continue;
    const ts = Date.parse(str(row.created_at));
    if (!Number.isNaN(ts) && ts >= ninetyDaysAgo) recentClients.add(client);
  }

  let seoClients: Row[] = [];
  try {
    seoClients = await fetchAllOld<Row>(old, "seo_clients");
  } catch {
    /* empty */
  }

  const invitedBy = process.env.DT_MIGRATION_INVITED_BY_USER_ID?.trim();
  const appBase = getAppBaseUrl();

  for (const entry of orgEntries) {
    const seoRow = seoClients.find((r) => resolveLegacyClientKey(r) === entry.legacyClient);
    const active = seoRow ? bool(seoRow.aktiv) : false;
    const recent = recentClients.has(entry.legacyClient);
    if (!active && !recent) continue;

    const email = str(seoRow?.recipient_email);
    if (!email) continue;

    inviteRows.push(`${email}\t${entry.organisationName}\t${entry.legacyClient}\t${active ? "aktiv" : "recent_chat"}`);

    if (!opts.sendInvites || opts.dryRun || !opts.apply) continue;
    if (!invitedBy) {
      console.warn("DT_MIGRATION_INVITED_BY_USER_ID required for --send-invites");
      break;
    }

    const { error: inviteErr } = await newDb.from("organisation_invites").insert({
      organisation_id: entry.organisationId,
      email: email.toLowerCase(),
      org_role: "employee",
      invited_by_user_id: invitedBy,
      status: "pending",
    });
    if (inviteErr && !inviteErr.message.includes("duplicate") && !inviteErr.message.includes("unique")) {
      console.warn(`invite ${email}:`, inviteErr.message);
      continue;
    }

    const { data: linkData, error: linkErr } = await newDb.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: `${appBase}/auth/login` },
    });

    const loginUrl = linkData?.properties?.action_link ?? `${appBase}/auth/login`;
    const html = renderDtPortalWelcomeEmail({
      organisationName: entry.organisationName,
      loginUrl,
    });

    if (!linkErr && process.env.SMTP_HOST) {
      await sendEmail({
        to: [email],
        subject: "Dein DigitalTwin-Portal ist umgezogen",
        text: `Anmeldung: ${loginUrl}`,
        html,
      });
    }

    counts.invites++;
    log({ event: "invite", email, org: entry.organisationId });
    await new Promise((r) => setTimeout(r, 1000));
  }

  writeFileSync(
    join(process.cwd(), "scripts", "dt-migration-invites-preview.tsv"),
    `${inviteRows.join("\n")}\n`,
    "utf8",
  );

  // --- verification ---
  const mismatches: VerificationMismatch[] = [];
  for (const entry of orgEntries) {
    const oldCount = allMessages.filter((m) => resolveLegacyClientKey(m) === entry.legacyClient).length;

    const { data: chatIds } = await newDb
      .from("dt_chats")
      .select("id")
      .eq("organisation_id", entry.organisationId);
    const ids = (chatIds ?? []).map((c) => c.id);
    let newCount = 0;
    if (ids.length > 0) {
      const { count } = await newDb
        .from("dt_chat_messages")
        .select("id", { count: "exact", head: true })
        .in("chat_id", ids);
      newCount = count ?? 0;
    }
    if (opts.apply && !opts.dryRun && oldCount !== newCount) {
      mismatches.push({
        legacyClient: entry.legacyClient,
        organisationId: entry.organisationId,
        oldMessages: oldCount,
        newMessages: newCount,
      });
    }
  }

  log({ event: "done", counts, mismatches: mismatches.length });
  console.log("Log:", logPath);

  return { counts, mismatches, orgEntries };
}
