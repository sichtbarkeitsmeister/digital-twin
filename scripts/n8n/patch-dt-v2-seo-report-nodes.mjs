/**
 * Patches on the live "DT v2 - SEO Report" graph (and on a fresh legacy clone).
 * Does not rebuild the workflow.
 *
 * Previous-period keyword totals must come from a query-dimension Search Console
 * response. The dimension-less totals request returns one row and no query key;
 * counting that row reports "1 Keyword" while clicks and impressions stay correct.
 */

const EN_DASH = "\u2013";

const PRIMARY_GSC_ACCOUNT = "ads@sichtbarkeitsmeister.de";

const WIDE_HEADER_STRIP =
  "reportHtml = reportHtml.replace(/<div[^>]*>[\\s\\S]*?Berichtszeitraum:[\\s\\S]*?Vergleichszeitraum:[\\s\\S]*?<\\/div>/i, '');";

const NARROW_HEADER_STRIP =
  "reportHtml = reportHtml.replace(/<div[^>]*>[\\s\\S]{0,600}?Berichtszeitraum:[\\s\\S]{0,600}?Vergleichszeitraum:[\\s\\S]{0,400}?<\\/div>/i, '');";

function patchIfGsc(nodes) {
  const node = nodes.find((n) => n.name === "If GSC");
  if (!node) return false;
  const conditions = node.parameters?.conditions;
  const first = conditions?.conditions?.[0];
  if (!conditions || !first) return false;
  conditions.options = {
    ...(conditions.options || {}),
    caseSensitive: true,
    leftValue: "",
    typeValidation: "loose",
    version: 3,
  };
  // Read the account from Parameter verarbeiten and compare the full address.
  // The previous operator omitted filter.operator.equals, so the check fell
  // through to the ads2 output even when gsc_account was ads@.
  first.leftValue =
    "={{ String($('Parameter verarbeiten').first().json.gsc_account || '').trim() }}";
  first.rightValue = PRIMARY_GSC_ACCOUNT;
  first.operator = {
    type: "string",
    operation: "equals",
    name: "filter.operator.equals",
  };
  return true;
}

function patchFormatReport(nodes) {
  const node = nodes.find((n) => n.name === "Format Report");
  const code = node?.parameters?.jsCode;
  if (typeof code !== "string") return false;
  if (!code.includes(WIDE_HEADER_STRIP)) return code.includes(NARROW_HEADER_STRIP);
  node.parameters.jsCode = code.replace(WIDE_HEADER_STRIP, NARROW_HEADER_STRIP);
  return true;
}

const PREVIOUS_QUERY_PAIRS = [
  [
    `GSC Vormonat ${EN_DASH} Nur Metriken - ads@`,
    `GSC Keywords Query ${EN_DASH} Nur Metriken - ads@`,
    "['query']",
  ],
  [
    `GSC Vormonat ${EN_DASH} Nur Metriken`,
    `GSC Keywords Query ${EN_DASH} Nur Metriken`,
    "['query']",
  ],
];

const PREVIOUS_PAGE_PAIRS = [
  ["GSC Keywords Vergleichszeitraum", "GSC Keywords Query", "['query', 'page']"],
  ["GSC Keywords Vergleichszeitraum ads2", "GSC Keywords Query  ads2", "['query', 'page']"],
];

const PREVIOUS_ANALYSIS_NODES = [
  [
    "Analyze Keywords Vormonat - ads@",
    `GSC Vormonat ${EN_DASH} Nur Metriken - ads@`,
    "GSC Keywords Vergleichszeitraum",
    "GSC Keywords Gesamt Vormonat - ads@",
  ],
  [
    "Analyze Keywords Vormonat - ads2@",
    `GSC Vormonat ${EN_DASH} Nur Metriken`,
    "GSC Keywords Vergleichszeitraum ads2",
    "GSC Keywords Gesamt Vormonat - ads2@",
  ],
];

function findNode(nodes, name) {
  return nodes.find((node) => node.name === name) ?? null;
}

function requestBodyField(parameters) {
  if (!parameters || typeof parameters !== "object") return null;
  for (const field of ["jsonBody", "body"]) {
    const value = parameters[field];
    if (typeof value === "string" && value.includes("startDate")) return field;
  }
  return null;
}

/** Swap the report window for the previous window without renaming the API fields. */
export function toPreviousPeriodSearchBody(body) {
  return body
    .replaceAll(".json.startDate", ".json.prevStartDate")
    .replaceAll(".json.endDate", ".json.prevEndDate");
}

function hasQuotedDimension(body, name) {
  return new RegExp(`['"]${name}['"]`).test(body);
}

function canonicalPreviousBody(dimensionsLiteral) {
  return `={{ JSON.stringify({ startDate: $('Parameter verarbeiten').first().json.prevStartDate, endDate: $('Parameter verarbeiten').first().json.prevEndDate, dimensions: ${dimensionsLiteral}, rowLimit: 25000 }) }}`;
}

/**
 * Build the previous-period Search Analytics body from the working current-period
 * request. A missing query dimension, or rowLimit 1, is replaced so the response
 * is one row per query instead of the property total.
 */
export function previousQueryBodyFromCurrent(currentBody, dimensionsLiteral) {
  const swapped = typeof currentBody === "string" ? toPreviousPeriodSearchBody(currentBody) : "";
  const needsPage = dimensionsLiteral.includes("page");
  const usable =
    hasQuotedDimension(swapped, "query") && (!needsPage || hasQuotedDimension(swapped, "page"));
  const body = usable ? swapped : canonicalPreviousBody(dimensionsLiteral);
  return body.replace(/rowLimit\s*:\s*1(?!\d)/, "rowLimit: 25000");
}

function patchSearchBodyPair(nodes, previousName, currentName, dimensionsLiteral) {
  const previous = findNode(nodes, previousName);
  if (!previous) return { name: previousName, updated: false, missing: true };
  const current = findNode(nodes, currentName);
  const field = requestBodyField(current?.parameters) || "jsonBody";
  const source = field && current?.parameters ? current.parameters[field] : "";
  const nextBody = previousQueryBodyFromCurrent(source, dimensionsLiteral);
  if (!previous.parameters || typeof previous.parameters !== "object") previous.parameters = {};
  previous.parameters.sendBody = true;
  previous.parameters.specifyBody = "json";
  previous.parameters.jsonBody = nextBody;
  return { name: previousName, updated: true, missing: false };
}

function patchSearchBodies(nodes, pairs) {
  return pairs.map(([previousName, currentName, dimensionsLiteral]) =>
    patchSearchBodyPair(nodes, previousName, currentName, dimensionsLiteral),
  );
}

/**
 * Keyword count for the comparison period.
 * Rows without a query key are the property total (one row for the whole site).
 * Those must not be counted as a keyword. If that is all the metrics call
 * returned, unique queries are taken from the query+page rows instead.
 */
export function summarizePreviousKeywords(metricsResponse, urlResponse, totalResponse) {
  const rowsOf = (response) => {
    if (Array.isArray(response)) return response;
    if (response && Array.isArray(response.rows)) return response.rows;
    return [];
  };
  const queryKey = (row) => {
    const key = row && row.keys && row.keys[0];
    return typeof key === "string" && key.trim() ? key.trim() : "";
  };
  const pageOf = (row) => {
    const key = row && row.keys && row.keys[1];
    return typeof key === "string" && key.trim() ? key.trim() : "";
  };
  const group = (rows) => {
    const acc = {};
    for (const row of rows) {
      const keyword = queryKey(row);
      if (!keyword) continue;
      const impressions = Number(row.impressions) || 0;
      const clicks = Number(row.clicks) || 0;
      const position = Number(row.position) || 0;
      if (!acc[keyword]) {
        acc[keyword] = { clicks: 0, impressions: 0, positionWeight: 0, page: "", pageImpressions: -1 };
      }
      acc[keyword].clicks += clicks;
      acc[keyword].impressions += impressions;
      acc[keyword].positionWeight += position * impressions;
      const page = pageOf(row);
      if (page && impressions >= acc[keyword].pageImpressions) {
        acc[keyword].page = page;
        acc[keyword].pageImpressions = impressions;
      }
    }
    return acc;
  };

  const metricGroups = group(rowsOf(metricsResponse));
  const grouped = Object.keys(metricGroups).length > 0 ? metricGroups : group(rowsOf(urlResponse));
  if (Object.keys(metricGroups).length > 0) {
    const pages = group(rowsOf(urlResponse));
    for (const keyword of Object.keys(grouped)) {
      if (!grouped[keyword].page && pages[keyword] && pages[keyword].page) {
        grouped[keyword].page = pages[keyword].page;
      }
    }
  }

  const keywords = Object.keys(grouped).map((keyword) => {
    const item = grouped[keyword];
    const ctrRatio = item.impressions > 0 ? item.clicks / item.impressions : 0;
    const position = item.impressions > 0 ? item.positionWeight / item.impressions : 0;
    return {
      keyword,
      page: item.page || "N/A",
      clicks: item.clicks,
      impressions: item.impressions,
      ctr: Math.round(ctrRatio * 1000) / 10,
      position: Math.round(position * 10) / 10,
    };
  });

  const totalRow = rowsOf(totalResponse)[0] || {};
  const totalClicks = Number(totalRow.clicks) || 0;
  const totalImpressions = Number(totalRow.impressions) || 0;
  const ranked = keywords
    .slice()
    .sort((a, b) => b.clicks * 10 + b.impressions - (a.clicks * 10 + a.impressions));

  return {
    total_keywords: keywords.length,
    total_clicks: totalClicks,
    total_impressions: totalImpressions,
    avg_ctr: totalImpressions > 0 ? Math.round((totalClicks / totalImpressions) * 1000) / 10 : 0,
    top_keywords: ranked.slice(0, 5000),
  };
}

export function previousKeywordAnalysisCode(metricsNode, urlNode, totalNode) {
  return `${summarizePreviousKeywords.toString()}

let metricsResponse = {};
let urlResponse = {};
let totalResponse = {};
try { metricsResponse = $('${metricsNode}').first().json; } catch (e) { metricsResponse = {}; }
try { urlResponse = $('${urlNode}').first().json; } catch (e) { urlResponse = {}; }
try { totalResponse = $('${totalNode}').first().json; } catch (e) { totalResponse = {}; }

return { json: summarizePreviousKeywords(metricsResponse, urlResponse, totalResponse) };
`;
}

function patchPreviousAnalysis(nodes) {
  return PREVIOUS_ANALYSIS_NODES.map(([name, metricsNode, urlNode, totalNode]) => {
    const node = findNode(nodes, name);
    if (!node) return { name, updated: false, missing: true };
    if (!node.parameters || typeof node.parameters !== "object") node.parameters = {};
    node.parameters.mode = node.parameters.mode || "runOnceForAllItems";
    node.parameters.jsCode = previousKeywordAnalysisCode(metricsNode, urlNode, totalNode);
    return { name, updated: true, missing: false };
  });
}

function updatedCount(results) {
  return results.filter((result) => result.updated).length;
}

/**
 * @param {Array<Record<string, unknown>>} nodes
 * @param {{ completeDoneCode?: string }} [options]
 */
export function patchDtV2SeoReportNodes(nodes, options = {}) {
  const ifGsc = patchIfGsc(nodes);
  const formatReport = patchFormatReport(nodes);
  let statusDone = false;
  if (options.completeDoneCode) {
    const node = nodes.find((n) => n.name === "SEO Cache: Status Done");
    if (node) {
      node.type = "n8n-nodes-base.code";
      node.typeVersion = 2;
      node.parameters = {
        mode: "runOnceForAllItems",
        jsCode: options.completeDoneCode,
      };
      delete node.credentials;
      statusDone = true;
    }
  }
  const previousKeywordQueries = patchSearchBodies(nodes, PREVIOUS_QUERY_PAIRS);
  const previousKeywordPages = patchSearchBodies(nodes, PREVIOUS_PAGE_PAIRS);
  const previousKeywordAnalysis = patchPreviousAnalysis(nodes);
  return {
    ifGsc,
    formatReport,
    statusDone,
    previousKeywordQueries: updatedCount(previousKeywordQueries),
    previousKeywordPages: updatedCount(previousKeywordPages),
    previousKeywordAnalysis: updatedCount(previousKeywordAnalysis),
    previousKeywordDetails: {
      queries: previousKeywordQueries,
      pages: previousKeywordPages,
      analysis: previousKeywordAnalysis,
    },
  };
}
