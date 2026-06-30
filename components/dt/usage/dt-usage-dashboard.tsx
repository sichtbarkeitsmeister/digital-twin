"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  Bot,
  Building2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Coins,
  Euro,
  MessageSquare,
  Settings2,
  Users,
  Zap,
} from "lucide-react";

import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtSelect } from "@/components/dt/dt-select";
import { DtTabs } from "@/components/dt/dt-tabs";
import { Badge } from "@/components/ui/badge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UsageTotals = {
  messages: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  avgTokensPerMessage: number;
};

type UserRow = {
  userId: string;
  label: string;
  email: string | null;
  messages: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  chatCount: number;
};

type AgentRow = {
  agentId: string;
  name: string;
  messages: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

type ModeRow = {
  mode: string;
  messages: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

type DayRow = {
  date: string;
  messages: number;
  inputTokens: number;
  outputTokens: number;
};

type RecentRow = {
  id: string;
  at: string;
  userLabel: string;
  chatTitle: string | null;
  chatMode: string | null;
  agentName: string | null;
  via: string;
  inputTokens: number;
  outputTokens: number;
};

type OrgRow = {
  orgId: string;
  name: string;
  messages: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  userCount: number;
};

type OrgTotals = UsageTotals & {
  activeOrgCount: number;
};

// ---------------------------------------------------------------------------
// Cost helpers  ($/M tokens)
// ---------------------------------------------------------------------------

type CostRates = { inputPerMTok: number; outputPerMTok: number };

// Claude Sonnet 4 / claude-3-5-sonnet-20241022
const DEFAULT_RATES: CostRates = { inputPerMTok: 3, outputPerMTok: 15 };

function calcCost(inputTok: number, outputTok: number, rates: CostRates): number {
  return (inputTok * rates.inputPerMTok + outputTok * rates.outputPerMTok) / 1_000_000;
}

function formatCost(usd: number): string {
  if (usd === 0) return "0,00 $";
  if (usd < 0.001) return `< 0,001 $`;
  if (usd < 1) return `${usd.toFixed(3)} $`;
  return `${usd.toFixed(2)} $`;
}

// ---------------------------------------------------------------------------
// Label helpers
// ---------------------------------------------------------------------------

const MODE_LABELS: Record<string, string> = {
  default: "Persönlich",
  team: "Team",
  seo: "SEO",
  ghost: "Ghost",
  unknown: "Unbekannt",
};

const VIA_LABELS: Record<string, string> = {
  anthropic_direct: "Direkt",
  anthropic_ghost: "Ghost",
  n8n: "n8n",
};

function formatTokens(n: number, precise = false): string {
  if (precise) return n.toLocaleString("de-DE");
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatDayLabel(isoDate: string, short = false): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (short) return d.toLocaleDateString("de-DE", { day: "2-digit", month: "short" });
  return d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "short" });
}

function modeLabel(mode: string | null): string {
  if (!mode) return "—";
  return MODE_LABELS[mode] ?? mode;
}

function viaLabel(via: string): string {
  return VIA_LABELS[via] ?? via;
}

/** Fill in zero-value days for every day in the range so the chart is always full-width. */
function padDays(rows: DayRow[], daysBack: number): DayRow[] {
  const map = new Map(rows.map((r) => [r.date, r]));
  const result: DayRow[] = [];
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    result.push(map.get(key) ?? { date: key, messages: 0, inputTokens: 0, outputTokens: 0 });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function UsageKpiCard(props: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  highlight?: boolean;
}) {
  const Icon = props.icon;
  return (
    <DtGlassCard
      className={`relative overflow-hidden p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${
        props.highlight ? "border-sbkm-mint/40 dark:border-sbkm-mint/25" : ""
      }`}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-sbkm-ink-500 dark:text-white/50">
          {props.label}
        </p>
        <Icon
          className={`h-4 w-4 shrink-0 ${props.highlight ? "text-sbkm-mint" : "text-sbkm-mint"}`}
          aria-hidden
        />
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-sbkm-navy dark:text-white">
        {props.value}
      </p>
      {props.hint ? (
        <p className="mt-1 text-xs text-sbkm-ink-600 dark:text-white/55">{props.hint}</p>
      ) : null}
    </DtGlassCard>
  );
}

function UsageDailyChart(props: { days: DayRow[]; rates: CostRates }) {
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const maxTotal = Math.max(1, ...props.days.map((d) => d.inputTokens + d.outputTokens));
  const hasAnyData = props.days.some((d) => d.inputTokens + d.outputTokens > 0);

  const hovered = props.days.find((d) => d.date === hoveredDate);

  // show every Nth label to avoid clutter
  const showLabelEvery = props.days.length <= 7 ? 1 : props.days.length <= 14 ? 2 : props.days.length <= 31 ? 3 : 7;

  return (
    <div>
      {/* Tooltip */}
      <div className="mb-3 h-10">
        <AnimatePresence>
          {hovered && (hovered.inputTokens + hovered.outputTokens > 0) ? (
            <motion.div
              key={hovered.date}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="inline-flex flex-wrap items-center gap-3 rounded-dt border border-sbkm-navy/10 bg-white/90 px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-sbkm-navy/80"
            >
              <span className="font-semibold text-sbkm-navy dark:text-white">
                {formatDayLabel(hovered.date)}
              </span>
              <span className="tabular-nums text-sbkm-ink-600 dark:text-white/60">
                {hovered.messages} Antw.
              </span>
              <span className="inline-flex items-center gap-1 tabular-nums">
                <span className="h-2 w-2 rounded-sm bg-sbkm-mint" />
                in {formatTokens(hovered.inputTokens)}
              </span>
              <span className="inline-flex items-center gap-1 tabular-nums">
                <span className="h-2 w-2 rounded-sm bg-sbkm-navy/30 dark:bg-white/25" />
                out {formatTokens(hovered.outputTokens)}
              </span>
              <span className="font-mono text-sbkm-ink-700 dark:text-white/75">
                ≈ {formatCost(calcCost(hovered.inputTokens, hovered.outputTokens, props.rates))}
              </span>
            </motion.div>
          ) : (
            <p className="text-xs text-sbkm-ink-500 dark:text-white/40">
              Balken ansteuern für Details
            </p>
          )}
        </AnimatePresence>
      </div>

      <div className="flex h-40 items-end gap-[2px] sm:gap-1">
        {props.days.map((point, i) => {
          const total = point.inputTokens + point.outputTokens;
          const inputH = (point.inputTokens / maxTotal) * 100;
          const outputH = (point.outputTokens / maxTotal) * 100;
          const isEmpty = total === 0;
          const isHovered = point.date === hoveredDate;
          const showLabel = i % showLabelEvery === 0;

          return (
            <div
              key={point.date}
              className="group flex min-w-0 flex-1 flex-col items-center gap-1"
              onMouseEnter={() => setHoveredDate(point.date)}
              onMouseLeave={() => setHoveredDate(null)}
            >
              <div className="flex w-full max-w-[36px] flex-1 flex-col justify-end gap-px">
                {!isEmpty ? (
                  <>
                    <div
                      className={`w-full rounded-t-sm transition-all duration-150 ${
                        isHovered
                          ? "bg-sbkm-navy/45 dark:bg-white/35"
                          : "bg-sbkm-navy/20 dark:bg-white/18"
                      }`}
                      style={{ height: `${Math.max(2, outputH)}%` }}
                    />
                    <div
                      className={`w-full transition-all duration-150 ${
                        isHovered ? "bg-sbkm-mint" : "bg-sbkm-mint/75"
                      }`}
                      style={{ height: `${Math.max(2, inputH)}%` }}
                    />
                  </>
                ) : (
                  <div className="w-full rounded-sm" style={{ height: "2px", background: "transparent" }} />
                )}
              </div>
              <span
                className={`max-w-full truncate text-[9px] font-medium tabular-nums transition-colors duration-150 ${
                  showLabel ? "opacity-100" : "opacity-0"
                } ${isHovered ? "text-sbkm-navy dark:text-white" : "text-sbkm-ink-500 dark:text-white/40"}`}
              >
                {formatDayLabel(point.date, true)}
              </span>
            </div>
          );
        })}
      </div>

      {!hasAnyData ? (
        <p className="mt-3 text-center text-xs text-sbkm-ink-500 dark:text-white/40">
          Keine Nutzung in diesem Zeitraum
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-4 text-xs text-sbkm-ink-600 dark:text-white/55">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-sbkm-mint/75" aria-hidden />
          Input (Kontext)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-sbkm-navy/20 dark:bg-white/18" aria-hidden />
          Output (Antwort)
        </span>
      </div>
    </div>
  );
}

function UsageHorizontalBars(props: {
  items: Array<{
    id: string;
    label: string;
    sublabel?: string;
    costLabel?: string;
    totalTokens: number;
    inputTokens?: number;
    outputTokens?: number;
  }>;
  maxItems?: number;
  onItemClick?: (id: string) => void;
}) {
  const items = props.items.slice(0, props.maxItems ?? 8);
  const max = Math.max(1, ...items.map((i) => i.totalTokens));

  if (items.length === 0) {
    return <p className="text-sm text-sbkm-ink-600 dark:text-white/55">Noch keine Daten.</p>;
  }

  return (
    <ul className="grid gap-4">
      {items.map((item, index) => {
        const pct = (item.totalTokens / max) * 100;
        const hasSplit =
          item.inputTokens !== undefined &&
          item.outputTokens !== undefined &&
          item.totalTokens > 0;
        const clickable = Boolean(props.onItemClick);

        return (
          <motion.li
            key={item.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05, duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="grid gap-1.5"
          >
            <button
              type="button"
              disabled={!clickable}
              onClick={() => props.onItemClick?.(item.id)}
              className={`grid gap-1.5 text-left ${
                clickable
                  ? "group cursor-pointer rounded-dt px-1 py-0.5 transition-colors hover:bg-sbkm-mint/8"
                  : ""
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className={`min-w-0 truncate text-sm font-medium text-sbkm-navy dark:text-white ${
                    clickable ? "group-hover:text-sbkm-mint" : ""
                  }`}
                >
                  {item.label}
                  {clickable ? (
                    <ChevronRight
                      className="ml-1 inline h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100"
                      aria-hidden
                    />
                  ) : null}
                </span>
                <div className="flex items-baseline gap-2 shrink-0">
                  {item.costLabel ? (
                    <span className="font-mono text-xs tabular-nums text-sbkm-mint">
                      {item.costLabel}
                    </span>
                  ) : null}
                  <span className="font-mono text-xs tabular-nums text-sbkm-ink-600 dark:text-white/60">
                    {formatTokens(item.totalTokens)}
                  </span>
                </div>
              </div>
              {item.sublabel ? (
                <p className="text-xs text-sbkm-ink-500 dark:text-white/45">{item.sublabel}</p>
              ) : null}
              <div className="h-2 overflow-hidden rounded-full bg-sbkm-navy/[0.06] dark:bg-white/10">
                {hasSplit ? (
                  <div className="flex h-full transition-all duration-500" style={{ width: `${pct}%` }}>
                    <div
                      className="h-full bg-sbkm-mint"
                      style={{ width: `${(item.inputTokens! / item.totalTokens) * 100}%` }}
                    />
                    <div
                      className="h-full bg-sbkm-navy/28 dark:bg-white/22"
                      style={{ width: `${(item.outputTokens! / item.totalTokens) * 100}%` }}
                    />
                  </div>
                ) : (
                  <div
                    className="h-full rounded-full bg-sbkm-mint transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                )}
              </div>
            </button>
          </motion.li>
        );
      })}
    </ul>
  );
}

function CostSettingsPanel(props: {
  rates: CostRates;
  onChange: (rates: CostRates) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-pill border border-sbkm-navy/15 bg-white/60 px-3 py-1.5 text-xs font-semibold text-sbkm-ink-600 transition hover:bg-sbkm-mint/10 hover:text-sbkm-navy dark:border-white/15 dark:bg-white/5 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white"
      >
        <Settings2 className="h-3.5 w-3.5" aria-hidden />
        Preismodell
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="mt-2 grid gap-3 rounded-dt border border-sbkm-navy/10 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5">
              <p className="text-xs text-sbkm-ink-600 dark:text-white/55">
                Anthropic-Listenpreise (USD pro Million Tokens).{" "}
                <span className="font-semibold">Claude 3.5 Sonnet:</span> 3 $ / 15 $,{" "}
                <span className="font-semibold">Haiku:</span> 0,25 $ / 1,25 $.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-sbkm-ink-500 dark:text-white/50">
                    Input $/MTok
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={0.25}
                    value={props.rates.inputPerMTok}
                    onChange={(e) =>
                      props.onChange({ ...props.rates, inputPerMTok: Number(e.target.value) || 0 })
                    }
                    className="h-9 rounded-pill border border-sbkm-navy/15 bg-white px-3 text-sm tabular-nums dark:border-white/15 dark:bg-white/5 dark:text-white"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-sbkm-ink-500 dark:text-white/50">
                    Output $/MTok
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={0.25}
                    value={props.rates.outputPerMTok}
                    onChange={(e) =>
                      props.onChange({ ...props.rates, outputPerMTok: Number(e.target.value) || 0 })
                    }
                    className="h-9 rounded-pill border border-sbkm-navy/15 bg-white px-3 text-sm tabular-nums dark:border-white/15 dark:bg-white/5 dark:text-white"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: "Sonnet 3.5", in: 3, out: 15 },
                  { label: "Sonnet 4", in: 3, out: 15 },
                  { label: "Haiku 3.5", in: 0.8, out: 4 },
                  { label: "Opus 4", in: 15, out: 75 },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() =>
                      props.onChange({ inputPerMTok: preset.in, outputPerMTok: preset.out })
                    }
                    className="rounded-pill border border-sbkm-navy/12 bg-white/60 px-2.5 py-1 text-[11px] font-medium text-sbkm-navy transition hover:bg-sbkm-mint/15 dark:border-white/12 dark:bg-white/5 dark:text-white"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function UsageSkeleton() {
  return (
    <div className="grid gap-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-dt bg-sbkm-navy/[0.06] dark:bg-white/[0.07]"
          />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-dt bg-sbkm-navy/[0.06] dark:bg-white/[0.07]" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-52 animate-pulse rounded-dt bg-sbkm-navy/[0.06] dark:bg-white/[0.07]" />
        <div className="h-52 animate-pulse rounded-dt bg-sbkm-navy/[0.06] dark:bg-white/[0.07]" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DtUsageDashboard(props: {
  organisations: Array<{ id: string; name: string }>;
  initialOrgId: string;
  isPlatformAdmin?: boolean;
}) {
  const isAdmin = Boolean(props.isPlatformAdmin);
  const [orgId, setOrgId] = useState(props.initialOrgId);
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState(isAdmin ? "orgs" : "overview");
  const [rates, setRates] = useState<CostRates>(DEFAULT_RATES);

  const [loading, setLoading] = useState(!isAdmin);
  const [orgsLoading, setOrgsLoading] = useState(isAdmin);
  const [totals, setTotals] = useState<UsageTotals | null>(null);
  const [orgTotals, setOrgTotals] = useState<OrgTotals | null>(null);
  const [byUser, setByUser] = useState<UserRow[]>([]);
  const [byAgent, setByAgent] = useState<AgentRow[]>([]);
  const [byMode, setByMode] = useState<ModeRow[]>([]);
  const [byDay, setByDay] = useState<DayRow[]>([]);
  const [byOrg, setByOrg] = useState<OrgRow[]>([]);
  const [orgByDay, setOrgByDay] = useState<DayRow[]>([]);
  const [recent, setRecent] = useState<RecentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [orgsError, setOrgsError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/dt/usage?org=${encodeURIComponent(orgId)}&days=${days}`);
    const json = (await res.json()) as {
      ok?: boolean;
      message?: string;
      totals?: UsageTotals;
      byUser?: UserRow[];
      byAgent?: AgentRow[];
      byMode?: ModeRow[];
      byDay?: DayRow[];
      recent?: RecentRow[];
    };
    setLoading(false);
    if (!json.ok) {
      setError(json.message ?? "Laden fehlgeschlagen.");
      return;
    }
    setTotals(json.totals ?? null);
    setByUser(json.byUser ?? []);
    setByAgent(json.byAgent ?? []);
    setByMode(json.byMode ?? []);
    setByDay(json.byDay ?? []);
    setRecent(json.recent ?? []);
  }, [orgId, days]);

  const loadOrgs = useCallback(async () => {
    if (!isAdmin) return;
    setOrgsLoading(true);
    setOrgsError(null);
    const res = await fetch(`/api/dt/usage/orgs?days=${days}`);
    const json = (await res.json()) as {
      ok?: boolean;
      message?: string;
      totals?: OrgTotals;
      byOrg?: OrgRow[];
      byDay?: DayRow[];
    };
    setOrgsLoading(false);
    if (!json.ok) {
      setOrgsError(json.message ?? "Laden fehlgeschlagen.");
      return;
    }
    setOrgTotals(json.totals ?? null);
    setByOrg(json.byOrg ?? []);
    setOrgByDay(json.byDay ?? []);
  }, [days, isAdmin]);

  useEffect(() => {
    if (tab === "orgs" && isAdmin) {
      void loadOrgs();
    }
  }, [tab, loadOrgs, isAdmin]);

  useEffect(() => {
    if (tab !== "orgs") {
      void load();
    }
  }, [tab, load]);

  const drillIntoOrg = useCallback((id: string) => {
    setOrgId(id);
    setTab("overview");
  }, []);

  const selectedOrgName =
    props.organisations.find((o) => o.id === orgId)?.name ?? "Organisation";

  const tabs = useMemo(() => {
    const base = [
      { id: "overview", label: "Übersicht" },
      { id: "users", label: "Nutzer" },
      { id: "agents", label: "Agenten" },
      { id: "activity", label: "Aktivität" },
    ];
    if (isAdmin) {
      return [{ id: "orgs", label: "Organisationen" }, ...base];
    }
    return base;
  }, [isAdmin]);

  // Derived values
  const totalCost = useMemo(
    () => (totals ? calcCost(totals.inputTokens, totals.outputTokens, rates) : 0),
    [totals, rates],
  );

  const globalCost = useMemo(
    () => (orgTotals ? calcCost(orgTotals.inputTokens, orgTotals.outputTokens, rates) : 0),
    [orgTotals, rates],
  );

  const paddedDays = useMemo(() => padDays(byDay, days), [byDay, days]);
  const paddedOrgDays = useMemo(() => padDays(orgByDay, days), [orgByDay, days]);

  const topUser = byUser[0];

  const orgChartItems = byOrg.map((o) => ({
    id: o.orgId,
    label: o.name,
    sublabel: `${o.userCount} Nutzer · ${o.messages} Antworten`,
    costLabel: formatCost(calcCost(o.inputTokens, o.outputTokens, rates)),
    totalTokens: o.totalTokens,
    inputTokens: o.inputTokens,
    outputTokens: o.outputTokens,
  }));

  const modeItems = byMode.map((m) => ({
    id: m.mode,
    label: modeLabel(m.mode),
    sublabel: `${m.messages} Antworten`,
    costLabel: formatCost(calcCost(m.inputTokens, m.outputTokens, rates)),
    totalTokens: m.totalTokens,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
  }));

  const userItems = byUser.map((u) => ({
    id: u.userId,
    label: u.label,
    sublabel: `${u.chatCount} Chats · ${u.messages} Antworten`,
    costLabel: formatCost(calcCost(u.inputTokens, u.outputTokens, rates)),
    totalTokens: u.totalTokens,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
  }));

  const agentItems = byAgent.map((a) => ({
    id: a.agentId,
    label: a.name,
    sublabel: `${a.messages} Antworten`,
    costLabel: formatCost(calcCost(a.inputTokens, a.outputTokens, rates)),
    totalTokens: a.totalTokens,
    inputTokens: a.inputTokens,
    outputTokens: a.outputTokens,
  }));

  return (
    <div className="grid gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-sbkm-navy dark:text-white">
            Token-Nutzung
          </h1>
          <p className="mt-1 text-sm text-sbkm-ink-600 dark:text-white/60">
            Verbrauch und Kosten durch KI-Antworten.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {isAdmin && tab !== "orgs" ? (
            <DtSelect
              label="Organisation"
              labelClassName="font-semibold normal-case tracking-normal text-sbkm-ink-600 dark:text-white/55"
              triggerClassName="min-w-[200px]"
              value={orgId}
              onValueChange={setOrgId}
              options={props.organisations.map((o) => ({ value: o.id, label: o.name }))}
            />
          ) : null}
          <DtSelect
            label="Zeitraum"
            labelClassName="font-semibold normal-case tracking-normal text-sbkm-ink-600 dark:text-white/55"
            triggerClassName="min-w-[140px]"
            value={String(days)}
            onValueChange={(v) => setDays(Number(v))}
            options={[
              { value: "7", label: "7 Tage" },
              { value: "30", label: "30 Tage" },
              { value: "90", label: "90 Tage" },
            ]}
          />
        </div>
      </div>

      {/* Explainer strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-dt border border-sbkm-navy/10 bg-gradient-to-br from-white via-white to-sbkm-mint/[0.04] px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:border-white/10 dark:from-white/[0.04] dark:to-sbkm-mint/[0.06]">
        <p className="text-sm text-sbkm-ink-700 dark:text-white/75">
          <span className="font-semibold text-sbkm-navy dark:text-white">Input</span> = System-Prompt
          + Verlauf + Anhänge.{" "}
          <span className="font-semibold text-sbkm-navy dark:text-white">Output</span> = die Antwort.
          Input kostet deutlich weniger als Output.
        </p>
        <CostSettingsPanel rates={rates} onChange={setRates} />
      </div>

      {error || orgsError ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error ?? orgsError}
        </p>
      ) : null}

      <DtTabs
        layoutId="usage-dashboard-tab"
        tabs={tabs}
        active={tab}
        onChange={setTab}
        className="mb-0"
      />

      {isAdmin && tab !== "orgs" ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => setTab("orgs")}
            className="font-medium text-sbkm-ink-600 transition hover:text-sbkm-mint dark:text-white/55 dark:hover:text-sbkm-mint"
          >
            Alle Organisationen
          </button>
          <ChevronRight className="h-4 w-4 text-sbkm-ink-400 dark:text-white/35" aria-hidden />
          <span className="font-semibold text-sbkm-navy dark:text-white">{selectedOrgName}</span>
        </div>
      ) : null}

      {tab === "orgs" && isAdmin ? (
        orgsLoading ? (
          <UsageSkeleton />
        ) : !orgTotals ? null : orgTotals.messages === 0 ? (
          <DtGlassCard className="flex flex-col items-center gap-3 p-10 text-center">
            <Building2 className="h-10 w-10 text-sbkm-mint/70" aria-hidden />
            <p className="font-semibold text-sbkm-navy dark:text-white">Noch keine Token-Nutzung</p>
            <p className="max-w-md text-sm text-sbkm-ink-600 dark:text-white/55">
              Sobald in einer Organisation KI-Antworten generiert werden, erscheinen hier
              plattformweite Verläufe und Kosten pro Organisation.
            </p>
          </DtGlassCard>
        ) : (
          <motion.div
            key={`orgs-${days}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="grid gap-5"
          >
            <motion.div
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
              initial="hidden"
              animate="show"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
            >
              {[
                {
                  icon: Euro,
                  label: "Geschätzte Kosten (gesamt)",
                  value: formatCost(globalCost),
                  hint: `${rates.inputPerMTok} $ / ${rates.outputPerMTok} $ pro MTok`,
                  highlight: true,
                },
                {
                  icon: Zap,
                  label: "Gesamt-Tokens",
                  value: formatTokens(orgTotals.totalTokens),
                  hint: `${formatTokens(orgTotals.inputTokens)} in · ${formatTokens(orgTotals.outputTokens)} out`,
                  highlight: false,
                },
                {
                  icon: MessageSquare,
                  label: "KI-Antworten",
                  value: String(orgTotals.messages),
                  hint: `Ø ${formatTokens(orgTotals.avgTokensPerMessage)} Tokens pro Antwort`,
                  highlight: false,
                },
                {
                  icon: Building2,
                  label: "Aktive Organisationen",
                  value: String(orgTotals.activeOrgCount),
                  hint: `${props.organisations.length} Organisationen insgesamt`,
                  highlight: false,
                },
              ].map((card) => (
                <motion.div
                  key={card.label}
                  variants={{
                    hidden: { opacity: 0, y: 6 },
                    show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] } },
                  }}
                >
                  <UsageKpiCard
                    icon={card.icon}
                    label={card.label}
                    value={card.value}
                    hint={card.hint}
                    highlight={card.highlight}
                  />
                </motion.div>
              ))}
            </motion.div>

            <DtGlassCard className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold tracking-tight text-sbkm-navy dark:text-white">
                    Verbrauch pro Tag (alle Organisationen)
                  </h2>
                  <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/55">
                    Mint = Input · Grau = Output · Balken ansteuern für Kosten
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold tabular-nums tracking-tight text-sbkm-mint">
                    {formatCost(globalCost)}
                  </p>
                  <p className="text-xs text-sbkm-ink-500 dark:text-white/40">gesamt</p>
                </div>
              </div>
              <div className="mt-5">
                <UsageDailyChart days={paddedOrgDays} rates={rates} />
              </div>
            </DtGlassCard>

            <div className="grid gap-4 lg:grid-cols-2">
              <DtGlassCard className="p-5">
                <h2 className="flex items-center gap-2 text-sm font-bold text-sbkm-navy dark:text-white">
                  <Building2 className="h-4 w-4 text-sbkm-mint" aria-hidden />
                  Organisationen nach Verbrauch
                </h2>
                <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/55">
                  Klicken für Details pro Organisation
                </p>
                <div className="mt-4">
                  <UsageHorizontalBars items={orgChartItems} onItemClick={drillIntoOrg} />
                </div>
              </DtGlassCard>
              <DtGlassCard className="overflow-hidden p-0">
                <div className="border-b border-sbkm-navy/10 px-4 py-3 dark:border-white/10">
                  <h2 className="text-sm font-semibold text-sbkm-navy dark:text-white">
                    Detailtabelle
                  </h2>
                  <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/55">
                    Zeile anklicken, um Nutzer und Agenten der Organisation zu sehen
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-sbkm-navy/10 text-xs text-sbkm-ink-500 dark:border-white/10">
                        <th className="px-4 py-2 font-semibold">Organisation</th>
                        <th className="px-4 py-2 text-right font-semibold tabular-nums">Nutzer</th>
                        <th className="px-4 py-2 text-right font-semibold tabular-nums">Antw.</th>
                        <th className="px-4 py-2 text-right font-semibold tabular-nums">Tokens</th>
                        <th className="px-4 py-2 text-right font-semibold">Kosten</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byOrg.map((o) => (
                        <tr
                          key={o.orgId}
                          onClick={() => drillIntoOrg(o.orgId)}
                          className="cursor-pointer border-b border-sbkm-navy/5 transition-colors hover:bg-sbkm-mint/8 dark:border-white/5"
                        >
                          <td className="max-w-[180px] truncate px-4 py-2.5 font-medium text-sbkm-navy dark:text-white">
                            {o.name}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{o.userCount}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{o.messages}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                            {formatTokens(o.totalTokens)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-sbkm-mint">
                            {formatCost(calcCost(o.inputTokens, o.outputTokens, rates))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-sbkm-navy/10 dark:border-white/10">
                        <td className="px-4 py-2 text-xs font-semibold text-sbkm-ink-600 dark:text-white/55">
                          Gesamt
                        </td>
                        <td colSpan={3} />
                        <td className="px-4 py-2 text-right font-mono text-xs font-semibold tabular-nums text-sbkm-mint">
                          {formatCost(globalCost)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </DtGlassCard>
            </div>
          </motion.div>
        )
      ) : loading ? (
        <UsageSkeleton />
      ) : !totals ? null : totals.messages === 0 ? (
        <DtGlassCard className="flex flex-col items-center gap-3 p-10 text-center">
          <Coins className="h-10 w-10 text-sbkm-mint/70" aria-hidden />
          <p className="font-semibold text-sbkm-navy dark:text-white">Noch keine Token-Nutzung</p>
          <p className="max-w-md text-sm text-sbkm-ink-600 dark:text-white/55">
            Sobald in dieser Organisation KI-Antworten generiert werden, erscheinen hier Verläufe und
            Kosten aufgeteilt nach Nutzer, Agent und Chat-Modus.
          </p>
        </DtGlassCard>
      ) : (
        <motion.div
          key={`${orgId}-${days}-${tab}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="grid gap-5"
        >
          {/* ── OVERVIEW ── */}
          {tab === "overview" ? (
            <>
              <motion.div
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
                initial="hidden"
                animate="show"
                variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
              >
                {[
                  {
                    icon: Euro,
                    label: "Geschätzte Kosten",
                    value: formatCost(totalCost),
                    hint: `${rates.inputPerMTok} $ / ${rates.outputPerMTok} $ pro MTok`,
                    highlight: true,
                  },
                  {
                    icon: Zap,
                    label: "Gesamt-Tokens",
                    value: formatTokens(totals.totalTokens),
                    hint: `${formatTokens(totals.inputTokens)} in · ${formatTokens(totals.outputTokens)} out`,
                    highlight: false,
                  },
                  {
                    icon: MessageSquare,
                    label: "KI-Antworten",
                    value: String(totals.messages),
                    hint: `Ø ${formatTokens(totals.avgTokensPerMessage)} Tokens pro Antwort`,
                    highlight: false,
                  },
                  {
                    icon: Users,
                    label: "Aktivster Nutzer",
                    value: topUser ? formatCost(calcCost(topUser.inputTokens, topUser.outputTokens, rates)) : "—",
                    hint: topUser?.label ?? "Keine Nutzerdaten",
                    highlight: false,
                  },
                ].map((card) => (
                  <motion.div
                    key={card.label}
                    variants={{
                      hidden: { opacity: 0, y: 6 },
                      show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] } },
                    }}
                  >
                    <UsageKpiCard
                      icon={card.icon}
                      label={card.label}
                      value={card.value}
                      hint={card.hint}
                      highlight={card.highlight}
                    />
                  </motion.div>
                ))}
              </motion.div>

              <DtGlassCard className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-bold tracking-tight text-sbkm-navy dark:text-white">
                      Verbrauch pro Tag
                    </h2>
                    <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/55">
                      Mint = Input · Grau = Output · Balken ansteuern für Kosten
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold tabular-nums tracking-tight text-sbkm-mint">
                      {formatCost(totalCost)}
                    </p>
                    <p className="text-xs text-sbkm-ink-500 dark:text-white/40">gesamt</p>
                  </div>
                </div>
                <div className="mt-5">
                  <UsageDailyChart days={paddedDays} rates={rates} />
                </div>
              </DtGlassCard>

              <div className="grid gap-4 lg:grid-cols-2">
                <DtGlassCard className="p-5">
                  <h2 className="text-sm font-bold text-sbkm-navy dark:text-white">Nach Chat-Modus</h2>
                  <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/55">
                    Mint = Kosten · rechte Zahl = Tokens
                  </p>
                  <div className="mt-4">
                    <UsageHorizontalBars items={modeItems} />
                  </div>
                </DtGlassCard>
                <DtGlassCard className="p-5">
                  <h2 className="text-sm font-bold text-sbkm-navy dark:text-white">Top-Agenten</h2>
                  <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/55">
                    Nach Gesamt-Tokens (Input + Output)
                  </p>
                  <div className="mt-4">
                    <UsageHorizontalBars items={agentItems} maxItems={5} />
                  </div>
                </DtGlassCard>
              </div>
            </>
          ) : null}

          {/* ── USERS ── */}
          {tab === "users" ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <DtGlassCard className="p-5">
                <h2 className="flex items-center gap-2 text-sm font-bold text-sbkm-navy dark:text-white">
                  <Users className="h-4 w-4 text-sbkm-mint" aria-hidden />
                  Nutzer nach Kosten
                </h2>
                <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/55">
                  Mint = Kostenanteil
                </p>
                <div className="mt-4">
                  <UsageHorizontalBars items={userItems} />
                </div>
              </DtGlassCard>
              <DtGlassCard className="overflow-hidden p-0">
                <div className="border-b border-sbkm-navy/10 px-4 py-3 dark:border-white/10">
                  <h2 className="text-sm font-semibold text-sbkm-navy dark:text-white">Detailtabelle</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[460px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-sbkm-navy/10 text-xs text-sbkm-ink-500 dark:border-white/10">
                        <th className="px-4 py-2 font-semibold">Nutzer</th>
                        <th className="px-4 py-2 text-right font-semibold tabular-nums">Chats</th>
                        <th className="px-4 py-2 text-right font-semibold tabular-nums">Antw.</th>
                        <th className="px-4 py-2 text-right font-semibold tabular-nums">Tokens</th>
                        <th className="px-4 py-2 text-right font-semibold">Kosten</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byUser.map((u) => (
                        <tr
                          key={u.userId}
                          className="border-b border-sbkm-navy/5 transition-colors hover:bg-sbkm-mint/5 dark:border-white/5"
                        >
                          <td className="max-w-[140px] truncate px-4 py-2.5 text-sbkm-navy dark:text-white">
                            {u.label}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{u.chatCount}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{u.messages}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                            {formatTokens(u.totalTokens)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-sbkm-mint">
                            {formatCost(calcCost(u.inputTokens, u.outputTokens, rates))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-sbkm-navy/10 dark:border-white/10">
                        <td className="px-4 py-2 text-xs font-semibold text-sbkm-ink-600 dark:text-white/55">
                          Gesamt
                        </td>
                        <td colSpan={3} />
                        <td className="px-4 py-2 text-right font-mono text-xs font-semibold tabular-nums text-sbkm-mint">
                          {formatCost(totalCost)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </DtGlassCard>
            </div>
          ) : null}

          {/* ── AGENTS ── */}
          {tab === "agents" ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <DtGlassCard className="p-5">
                <h2 className="flex items-center gap-2 text-sm font-bold text-sbkm-navy dark:text-white">
                  <Bot className="h-4 w-4 text-sbkm-mint" aria-hidden />
                  Agenten nach Kosten
                </h2>
                <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/55">
                  Mint = Input · Grau = Output
                </p>
                <div className="mt-4">
                  <UsageHorizontalBars items={agentItems} />
                </div>
              </DtGlassCard>
              <DtGlassCard className="overflow-hidden p-0">
                <div className="border-b border-sbkm-navy/10 px-4 py-3 dark:border-white/10">
                  <h2 className="text-sm font-semibold text-sbkm-navy dark:text-white">Detailtabelle</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[440px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-sbkm-navy/10 text-xs text-sbkm-ink-500 dark:border-white/10">
                        <th className="px-4 py-2 font-semibold">Agent</th>
                        <th className="px-4 py-2 text-right font-semibold tabular-nums">Antw.</th>
                        <th className="px-4 py-2 text-right font-semibold tabular-nums">Tokens</th>
                        <th className="px-4 py-2 text-right font-semibold">Kosten</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byAgent.map((a) => (
                        <tr
                          key={a.agentId}
                          className="border-b border-sbkm-navy/5 transition-colors hover:bg-sbkm-mint/5 dark:border-white/5"
                        >
                          <td className="px-4 py-2.5 text-sbkm-navy dark:text-white">{a.name}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{a.messages}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                            {formatTokens(a.totalTokens)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-sbkm-mint">
                            {formatCost(calcCost(a.inputTokens, a.outputTokens, rates))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-sbkm-navy/10 dark:border-white/10">
                        <td className="px-4 py-2 text-xs font-semibold text-sbkm-ink-600 dark:text-white/55">
                          Gesamt
                        </td>
                        <td colSpan={2} />
                        <td className="px-4 py-2 text-right font-mono text-xs font-semibold tabular-nums text-sbkm-mint">
                          {formatCost(totalCost)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </DtGlassCard>
            </div>
          ) : null}

          {/* ── ACTIVITY ── */}
          {tab === "activity" ? (
            <DtGlassCard className="overflow-hidden p-0">
              <div className="border-b border-sbkm-navy/10 px-4 py-3 dark:border-white/10">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-sbkm-navy dark:text-white">
                  <Activity className="h-4 w-4 text-sbkm-mint" aria-hidden />
                  Letzte KI-Antworten
                </h2>
              </div>
              <ul className="divide-y divide-sbkm-navy/5 dark:divide-white/5">
                {recent.length === 0 ? (
                  <li className="px-4 py-6 text-center text-sm text-sbkm-ink-600 dark:text-white/55">
                    Keine Einträge im Zeitraum.
                  </li>
                ) : (
                  recent.map((r) => {
                    const rowCost = calcCost(r.inputTokens, r.outputTokens, rates);
                    return (
                      <li
                        key={r.id}
                        className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-sbkm-mint/[0.04]"
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-sbkm-navy dark:text-white">
                            {r.userLabel}
                            {r.agentName ? (
                              <span className="font-normal text-sbkm-ink-600 dark:text-white/60">
                                {" "}
                                · {r.agentName}
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-sbkm-ink-600 dark:text-white/55">
                            {r.chatTitle ?? "Ohne Chat-Titel"}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <Badge variant="secondary">{modeLabel(r.chatMode)}</Badge>
                            <Badge variant="outline">{viaLabel(r.via)}</Badge>
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-xs">
                          <p className="font-mono font-semibold tabular-nums text-sbkm-mint">
                            {formatCost(rowCost)}
                          </p>
                          <p className="mt-0.5 font-mono tabular-nums text-sbkm-ink-600 dark:text-white/55">
                            {formatTokens(r.inputTokens + r.outputTokens)} tok
                          </p>
                          <p className="mt-0.5 font-mono text-[10px] tabular-nums text-sbkm-ink-400 dark:text-white/35">
                            in {formatTokens(r.inputTokens)} · out {formatTokens(r.outputTokens)}
                          </p>
                          <p className="mt-1 tabular-nums text-sbkm-ink-400 dark:text-white/35">
                            {new Date(r.at).toLocaleString("de-DE", {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                      </li>
                    );
                  })
                )}
              </ul>
            </DtGlassCard>
          ) : null}
        </motion.div>
      )}
    </div>
  );
}
