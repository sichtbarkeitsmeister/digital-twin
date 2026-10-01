/**
 * Patches on the live "DT v2 - SEO Report" graph (and on a fresh legacy clone).
 * Does not rebuild the workflow.
 */

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
  return { ifGsc, formatReport, statusDone };
}
