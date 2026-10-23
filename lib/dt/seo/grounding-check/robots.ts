/**
 * robots.txt reading for the reviewer hint „Blockiert die robots.txt KI-Crawler?“.
 * Follows Google's rules: the group whose user-agent matches the crawler's product token
 * wins over `*`; within a group the longest matching path wins, Allow on a tie;
 * `*` and `$` work as wildcards. Pure, no network.
 */

import { GROUNDING_AI_CRAWLERS } from "@/lib/dt/prompts/grounding-page-standard";

export type RobotsRule = { allow: boolean; path: string };
export type RobotsGroup = { agents: string[]; rules: RobotsRule[] };

export function parseRobotsTxt(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1]!.toLowerCase();
    const value = m[2]!.trim();

    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "allow" || field === "disallow") {
      // An empty Disallow allows everything; it adds no rule.
      if (field === "disallow" && value === "") continue;
      if (field === "allow" && value === "") continue;
      current.rules.push({ allow: field === "allow", path: value });
    }
  }
  return groups;
}

function patternToRegExp(path: string): RegExp {
  const anchored = path.endsWith("$");
  const body = (anchored ? path.slice(0, -1) : path)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** The groups that apply to a crawler: its own (merged), else `*`, else none. */
export function groupsForAgent(groups: RobotsGroup[], userAgent: string): RobotsGroup[] {
  const token = userAgent.toLowerCase();
  const own = groups.filter((g) => g.agents.some((a) => a === token));
  if (own.length > 0) return own;
  return groups.filter((g) => g.agents.includes("*"));
}

export function isPathAllowed(groups: RobotsGroup[], userAgent: string, path: string): { allowed: boolean; rule: RobotsRule | null } {
  const rules = groupsForAgent(groups, userAgent).flatMap((g) => g.rules);
  let best: RobotsRule | null = null;
  for (const rule of rules) {
    if (!patternToRegExp(rule.path).test(path)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) {
      best = rule;
    }
  }
  return { allowed: best ? best.allow : true, rule: best };
}

export type AiCrawlerAccess = {
  bot: string;
  status: "allowed" | "blocked" | "partial";
  /** German one-liner for the hint list. */
  detail: string;
};

/**
 * Access of each AI crawler to the site and to the grounding page path. `robotsTxt` null
 * means there is no robots.txt (everything allowed).
 */
export function evaluateAiCrawlerAccess(
  robotsTxt: string | null,
  groundingPath: string,
  crawlers: readonly string[] = GROUNDING_AI_CRAWLERS,
): AiCrawlerAccess[] {
  const groups = robotsTxt ? parseRobotsTxt(robotsTxt) : [];
  return crawlers.map((bot) => {
    const site = isPathAllowed(groups, bot, "/");
    const page = isPathAllowed(groups, bot, groundingPath || "/");
    if (!site.allowed && !page.allowed) {
      return { bot, status: "blocked" as const, detail: `${bot} ist gesperrt (${site.rule ? `Disallow: ${site.rule.path}` : "robots.txt"}).` };
    }
    if (!page.allowed) {
      return { bot, status: "partial" as const, detail: `${bot} darf die Website lesen, aber nicht ${groundingPath} (Disallow: ${page.rule?.path ?? "?"}).` };
    }
    if (!site.allowed) {
      return { bot, status: "partial" as const, detail: `${bot} ist für die Startseite gesperrt, ${groundingPath} ist erlaubt.` };
    }
    return { bot, status: "allowed" as const, detail: `${bot} ist erlaubt.` };
  });
}
