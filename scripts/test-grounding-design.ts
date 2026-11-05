/**
 * Grounding Page design: detection from website CSS (WordPress theme.json, Elementor, plain
 * CSS, Bootstrap, Google Fonts, self-hosted @font-face, low contrast), manual values vs.
 * detection, the CSS builder and its limits, the validator, design-only changes, the CMS
 * snippet and the agent's HTML. No network.
 * Run: npx tsx scripts/test-grounding-design.ts
 */
import assert from "node:assert/strict";

import { decideGroundingCheck } from "../lib/dt/seo/grounding-check/decision";
import { computeGroundingDiff } from "../lib/dt/seo/grounding-check/diff";
import { checkExistingPageStructure, parseExistingGroundingPage } from "../lib/dt/seo/grounding-check/existing-page";
import { renderGroundingHtml } from "../lib/dt/seo/grounding-check/render-html";
import { applyReviewToHtml } from "../lib/dt/seo/grounding-check/review-stamp";
import { draftHtmlWithDesign, serializeRunDetail } from "../lib/dt/seo/grounding-check/store";
import { validateCmsSnippet, validateDesignLimits, validateGroundingDraft, validateGroundingHtml } from "../lib/dt/seo/grounding-check/validate";
import { contrastRatio, ensureContrast, normalizeHex, parseColor } from "../lib/dt/seo/grounding-design/color";
import {
  DESIGN_STYLE_ID,
  GROUNDING_CSS_BUDGET,
  NEUTRAL_CSS,
  buildDesignCss,
  byteLength,
  designStyleBlock,
  injectDesign,
  replaceDesignStyle,
  snippetCss,
} from "../lib/dt/seo/grounding-design/css";
import { parseCss } from "../lib/dt/seo/grounding-design/css-parse";
import { extractDesign, fontStylesheetsToFetch, isFontStylesheet, stylesheetLinks, stylesheetsToFetch } from "../lib/dt/seo/grounding-design/extract";
import { SYSTEM_STACKS, parseFontFamilyList } from "../lib/dt/seo/grounding-design/fonts";
import {
  EMPTY_DESIGN_VALUES,
  type DetectedDesign,
  type GroundingDesignRecord,
  type ResolvedDesign,
  applyDetection,
  applyManualEdit,
  designContrastWarnings,
  designProfileView,
  manualFont,
  resetDesign,
  resolveDesignValues,
  resolveGroundingDesign,
} from "../lib/dt/seo/grounding-design/profile";
import { buildCmsSnippet, cmsFieldsFromHtml } from "../lib/dt/seo/grounding-design/snippet";
import type { DtGroundingRunRow } from "../lib/dt/types";
import {
  AGENT_HTML,
  BOOTSTRAP_SITE,
  type DesignFixture,
  ELEMENTOR_SITE,
  GOOGLE_FONTS_SITE,
  LOW_CONTRAST_SITE,
  PLAIN_CSS_SITE,
  SELF_HOSTED_SITE,
  WORDPRESS_SITE,
} from "./grounding-design-fixtures";
import { websiteModel } from "./grounding-check-fixtures";

const errors = <T extends { severity: string }>(issues: T[]) => issues.filter((i) => i.severity === "error");
const codes = <T extends { code: string }>(issues: T[]) => [...new Set(issues.map((i) => i.code))].sort();
const detect = (fx: DesignFixture) => extractDesign(fx).design;
const record = (detected: DetectedDesign | null, manual = EMPTY_DESIGN_VALUES): GroundingDesignRecord => ({
  enabled: true,
  detected,
  manual,
  detectedAt: "2026-11-05T10:00:00.000Z",
  detectedFromUrl: "https://www.beispiel-bau.de/",
});
const resolved = (fx: DesignFixture): ResolvedDesign => resolveGroundingDesign(record(detect(fx)))!;
/** Nothing in the CSS may point anywhere but the client's own fonts. */
const externalRefs = (css: string, site: string) =>
  [...css.matchAll(/url\(\s*["']?([^"')]+)/g)].map((m) => m[1]!).filter((u) => !u.startsWith(new URL(site).origin));

// --- colour helpers ------------------------------------------------------------------------------
assert.equal(normalizeHex("#ABC"), "#aabbcc");
assert.equal(normalizeHex("rgb(13 110 253)"), "#0d6efd");
assert.equal(normalizeHex("hsl(0, 100%, 50%)"), "#ff0000");
assert.deepEqual(parseColor("222.2 47.4% 11.2%", { bareHsl: true }) !== null, true, "shadcn triplet");
assert.equal(parseColor("linear-gradient(red, blue)"), null);
assert.equal(Math.round(contrastRatio("#000", "#fff")), 21);
assert.ok(ensureContrast("#ffd400", "#ffffff", 4.5).after >= 4.5);
assert.deepEqual(parseFontFamilyList(`"Open Sans", 'Segoe UI', Arial, sans-serif !important`), ["Open Sans", "Segoe UI", "Arial", "sans-serif"]);

// --- CSS reader ------------------------------------------------------------------------------------
{
  const parsed = parseCss(`/* c { } */ @import url("x.css"); @media (min-width:600px){h1{color:red}} a{color:blue;--x: "}"} @font-face{font-family:A;src:url(a.woff2)} @keyframes k{from{color:red}}`);
  assert.deepEqual(parsed.imports, ["x.css"]);
  assert.equal(parsed.fontFaces.length, 1);
  assert.deepEqual(parsed.rules.map((r) => r.selectors.join(",")), ["h1", "a"], "keyframes skipped, media kept");
  assert.deepEqual(parsed.rules[0]!.media, ["(min-width:600px)"]);
}

// --- WordPress theme.json -----------------------------------------------------------------------
{
  const d = detect(WORDPRESS_SITE);
  assert.equal(d.colors.text, "#2b2522", "body color from var(--wp--preset--color--contrast)");
  assert.equal(d.colors.background, "#fbf8f3");
  assert.equal(d.colors.link, "#8a4b1f", ":root :where(a:where(:not(.wp-element-button))) is the link rule");
  assert.equal(d.colors.accent, "#8a4b1f", "button background, not WordPress' default palette (vivid red/amber)");
  assert.equal(d.colors.heading, "#2b2522");
  assert.ok(d.colors.muted && contrastRatio(d.colors.muted, "#fbf8f3") >= 4.5, "derived muted passes AA");
  assert.equal(d.fonts.body?.source, "self-hosted");
  assert.equal(d.fonts.body?.name, "Inter");
  assert.deepEqual(
    d.fonts.body?.font_face_urls?.map((f) => `${f.weight} ${f.format} ${f.url}`),
    [
      "400 woff2 https://www.tischlerei-holz.example/wp-content/themes/holz/assets/fonts/inter-v13-latin-regular.woff2",
      "700 woff2 https://www.tischlerei-holz.example/wp-content/themes/holz/assets/fonts/inter-v13-latin-700.woff2",
    ],
    "woff2 preferred, relative to the stylesheet",
  );
  assert.equal(d.fonts.heading?.source, "external", "Montserrat comes from Google Fonts");
  assert.equal(d.fonts.heading?.css_stack, SYSTEM_STACKS.sans.stack);
  assert.ok(d.notes.some((n) => /Montserrat.*externen Dienst/.test(n)));
  assert.equal(d.typography.headingWeight, 600);
  assert.equal(d.typography.headingLetterSpacing, "-0.01em");
  assert.ok(extractDesign(WORDPRESS_SITE).report.themes.includes("WordPress (theme.json)"));
  // Only same-origin sheets are fetched, at most five.
  const links = stylesheetLinks(WORDPRESS_SITE.html, WORDPRESS_SITE.pageUrl);
  assert.deepEqual(stylesheetsToFetch(links), ["https://www.tischlerei-holz.example/wp-content/themes/holz/style.css?ver=1.2"]);
}

// --- Elementor -----------------------------------------------------------------------------------
{
  const d = detect(ELEMENTOR_SITE);
  assert.equal(d.colors.text, "#3a3a3a", "--e-global-color-text via the kit");
  assert.equal(d.colors.heading, "#1f3a5f", "--e-global-color-primary on h1–h3");
  assert.equal(d.colors.accent, "#e07a1f", "kit button colour beats Elementor's default grey button");
  assert.ok(d.colors.link && d.colors.link !== "#e07a1f" && contrastRatio(d.colors.link, "#ffffff") >= 4.5, "orange link darkened for AA");
  assert.ok(d.notes.some((n) => /Linkfarbe für die Lesbarkeit angepasst/.test(n)));
  assert.equal(d.colors.background, undefined, "no background on the kit: neutral white");
  assert.equal(d.fonts.body?.source, "self-hosted", "Elementor's local Google Fonts live on the own domain");
  assert.deepEqual(d.fonts.body?.font_face_urls?.map((f) => f.weight), ["400", "700"]);
  assert.ok(d.fonts.body?.font_face_urls?.every((f) => !/swipgqh|wxgh\./.test(f.url)), "latin subset, not latin-ext");
  assert.equal(d.fonts.heading?.source, "external");
  assert.equal(d.fonts.heading?.css_stack, SYSTEM_STACKS.serif.stack, "Playfair Display → serif stack");
  assert.equal(d.typography.headingWeight, 700);
  assert.ok(extractDesign(ELEMENTOR_SITE).report.themes.includes("Elementor"));
}

// --- Elementor on Hello theme: the theme's system-font body rule loses to the kit's brand font -----
{
  const fx: DesignFixture = {
    ...ELEMENTOR_SITE,
    html: ELEMENTOR_SITE.html.replace("<link rel=\"stylesheet\" id=\"elementor-frontend-css\"", '<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#333}</style><link rel="stylesheet" id="elementor-frontend-css"'),
  };
  assert.equal(detect(fx).fonts.body?.name, "Lato", "kit text font, not the theme's system stack");
  assert.equal(detect(fx).fonts.body?.source, "self-hosted");
}

// --- fetch order: theme sheets first, then the font sheets of the fonts they name -----------------
{
  const page = "https://www.kunde.example/";
  const links = [
    "/wp-content/plugins/a/a.css",
    "/wp-content/plugins/b/b.css",
    "/wp-content/themes/hello/reset.css",
    "/wp-content/themes/hello/theme.css",
    "/wp-content/uploads/elementor/css/custom-apple-webkit.min.css",
    "/wp-content/uploads/elementor/css/post-9.css",
    "/wp-content/uploads/elementor/google-fonts/css/roboto.css",
    "/wp-content/uploads/elementor/google-fonts/css/poppins.css",
    "https://fonts.googleapis.com/css2?family=Lato",
  ].map((href) => ({ url: new URL(href, page).toString(), sameOrigin: !href.startsWith("https://fonts"), media: null }));
  assert.ok(isFontStylesheet(links[7]!.url) && !isFontStylesheet(links[5]!.url));
  const phase1 = stylesheetsToFetch(links, 3);
  assert.deepEqual(phase1.map((u) => u.replace(page, "/")), ["/wp-content/uploads/elementor/css/post-9.css", "/wp-content/themes/hello/reset.css", "/wp-content/themes/hello/theme.css"]);
  assert.deepEqual(
    fontStylesheetsToFetch(links, ["Poppins", "sans-serif"], 2).map((u) => u.replace(page, "/")),
    ["/wp-content/uploads/elementor/google-fonts/css/poppins.css", "/wp-content/uploads/elementor/google-fonts/css/roboto.css"],
    "the sheet of a detected family first; never an external one",
  );
}

// --- no link colour on the site: links take the accent, readable as text --------------------------
{
  const fx: DesignFixture = { pageUrl: "https://www.ohne-links.example/", html: "<html><head><style>body{color:#222;background:#fff}.btn{background:#64fdc2}</style></head><body></body></html>", stylesheets: {} };
  const d = detect(fx);
  assert.ok(d.colors.link && contrastRatio(d.colors.link, "#ffffff") >= 4.5, d.colors.link);
  assert.equal(d.colors.accent, "#64fdc2", "the accent stays the brand colour (decorative lines only)");
  const manualAccentOnly = resolveDesignValues({ ...EMPTY_DESIGN_VALUES, colors: { accent: "#64fdc2" } });
  assert.ok(contrastRatio(manualAccentOnly.colors.link, "#ffffff") >= 4.5, "the resolver derives a readable link too");
  assert.equal(manualAccentOnly.colors.accent, "#64fdc2", "a manual accent itself stays as set");
}

// --- plain CSS -----------------------------------------------------------------------------------
{
  const d = detect(PLAIN_CSS_SITE);
  assert.equal(d.colors.text, "#333333");
  assert.equal(d.colors.background, "#ffffff", "colour token of the background shorthand, not the image");
  assert.equal(d.colors.heading, "#0b3d91", "the white .hero h1 is not the heading colour");
  assert.equal(d.colors.link, "#0b3d91", "footer links do not count");
  assert.equal(d.colors.accent, "#c8102e", "most used button colour; the cookie button does not count");
  assert.equal(d.fonts.body?.source, "system");
  assert.equal(d.fonts.body?.css_stack, 'Georgia,"Times New Roman",serif');
  assert.deepEqual(d.typography, { headingWeight: 600, headingLetterSpacing: "0.05em", headingUppercase: true, baseFontSize: 17 });
}

// --- Bootstrap -----------------------------------------------------------------------------------
{
  const d = detect(BOOTSTRAP_SITE);
  assert.equal(d.colors.text, "#212529");
  assert.equal(d.colors.background, "#ffffff", "the dark theme variant is ignored");
  assert.equal(d.colors.link, "#6f42c1", "rgba(var(--bs-link-color-rgb), …) resolved");
  assert.equal(d.colors.accent, "#6f42c1", "--bs-primary");
  assert.equal(d.colors.muted, "#595c5f", "--bs-secondary-color painted over white");
  assert.equal(d.colors.heading, undefined, "--bs-heading-color: inherit → text colour");
  assert.equal(d.fonts.body?.source, "system");
  assert.ok(!/Noto Sans|Roboto/.test(d.fonts.body!.css_stack), "only fonts installed on the device stay in a system stack");
  assert.equal(d.typography.baseFontSize, 16);
  assert.ok(extractDesign(BOOTSTRAP_SITE).report.themes.includes("Bootstrap"));
}

// --- Google Fonts: nothing external is loaded ----------------------------------------------------
{
  const d = detect(GOOGLE_FONTS_SITE);
  assert.equal(d.fonts.body?.source, "external");
  assert.equal(d.fonts.heading?.source, "external");
  assert.equal(d.fonts.body?.font_face_urls, undefined);
  assert.equal(d.fonts.heading?.css_stack, SYSTEM_STACKS.serif.stack, "Merriweather → serif");
  assert.equal(d.notes.filter((n) => /externen Dienst/.test(n)).length, 2);
  const design = resolved(GOOGLE_FONTS_SITE);
  const css = buildDesignCss(design).css;
  assert.ok(!/@font-face|googleapis|gstatic|@import/.test(css), "no font file, no Google host in the CSS");
  const html = renderGroundingHtml({ model: websiteModel(), createdDay: "2026-10-01", modifiedDay: "2026-11-05", design });
  assert.ok(!/googleapis|gstatic/.test(html));
  assert.deepEqual(errors(validateGroundingHtml(html, { reviewed: false })), []);
}

// --- self-hosted @font-face --------------------------------------------------------------------
{
  const d = detect(SELF_HOSTED_SITE);
  assert.equal(d.fonts.body?.source, "self-hosted");
  assert.deepEqual(d.fonts.body?.font_face_urls?.map((f) => f.url), [
    "https://www.beispiel-bau.de/fonts/source-sans-3-v15-latin-regular.woff2",
    "https://www.beispiel-bau.de/fonts/source-sans-3-v15-latin-700.woff2",
  ]);
  assert.equal(d.fonts.heading?.source, "self-hosted");
  assert.equal(d.fonts.heading?.name, "Bitter");
  assert.ok(d.fonts.heading!.css_stack.startsWith("Bitter,"), "own font first, slab stack behind it");
  assert.ok(d.fonts.heading!.css_stack.includes("Rockwell"));
  const design = resolved(SELF_HOSTED_SITE);
  const { css, bytes } = buildDesignCss(design);
  assert.ok(bytes <= GROUNDING_CSS_BUDGET, `CSS ${bytes} B within budget`);
  assert.equal((css.match(/@font-face/g) ?? []).length, 3, "body 400, heading 700, body 700");
  assert.ok((css.match(/font-display:swap/g) ?? []).length === 3);
  assert.deepEqual(externalRefs(css, "https://www.beispiel-bau.de/"), []);
  const html = renderGroundingHtml({ model: websiteModel(), createdDay: "2026-10-01", modifiedDay: "2026-11-05", design });
  assert.deepEqual(errors(validateGroundingHtml(html, { reviewed: false })), [], "own-origin fonts pass the validator");
}

// --- low contrast → neutral ------------------------------------------------------------------------
{
  const d = detect(LOW_CONTRAST_SITE);
  assert.equal(d.colors.text, undefined, "#b5b5b5 on white (2.0:1) falls back to neutral");
  assert.equal(d.colors.background, undefined);
  assert.equal(d.colors.heading, undefined);
  assert.ok(d.notes.some((n) => /Kontrast von 2,0:1.*neutralen Farben/.test(n)));
  assert.ok(d.colors.link && contrastRatio(d.colors.link, "#ffffff") >= 4.5);
  const design = resolved(LOW_CONTRAST_SITE);
  assert.equal(design.colors.text, "#1b1f24");
  assert.equal(design.colors.background, "#ffffff");
  assert.deepEqual(designContrastWarnings(design), []);
  // A manual value is kept even when it fails – the UI warns instead.
  const manual = resolveGroundingDesign(applyManualEdit(record(d), { colors: { text: "#cccccc" } }))!;
  assert.equal(manual.colors.text, "#cccccc");
  assert.deepEqual(designContrastWarnings(manual).map((w) => w.pair), ["text", "heading"], "headings inherit the text colour");
}

// --- manual values win; detection only updates auto fields -----------------------------------------
{
  let rec = applyDetection(null, detect(PLAIN_CSS_SITE), { url: PLAIN_CSS_SITE.pageUrl, at: "2026-11-01T00:00:00.000Z" });
  rec = applyManualEdit(rec, { colors: { accent: "#123456" }, fonts: { heading: { name: "Arial", stack: "sans" } }, typography: { headingUppercase: false } });
  const before = designProfileView(rec);
  assert.deepEqual(before.colors.accent, { value: "#123456", source: "manuell" });
  assert.deepEqual(before.colors.text, { value: "#333333", source: "auto" });
  assert.equal(before.fonts.heading?.source, "manuell");
  assert.equal(before.fonts.heading?.value.css_stack, `Arial,${SYSTEM_STACKS.sans.stack}`);

  const next = applyDetection(rec, detect(BOOTSTRAP_SITE), { url: BOOTSTRAP_SITE.pageUrl, at: "2026-11-05T00:00:00.000Z" });
  const view = designProfileView(next);
  assert.deepEqual(view.colors.accent, { value: "#123456", source: "manuell" }, "manual accent survives a new detection");
  assert.deepEqual(view.typography.headingUppercase, { value: false, source: "manuell" });
  assert.deepEqual(view.colors.text, { value: "#212529", source: "auto" }, "auto fields follow the new detection");
  assert.equal(view.colors.heading, undefined, "an auto field the new detection did not find is gone");
  assert.equal(view.fonts.heading?.value.name, "Arial");
  assert.equal(view.detected_at, "2026-11-05T00:00:00.000Z");
  assert.deepEqual(next.manual, rec.manual, "the manual layer is untouched");
  assert.equal(resolveGroundingDesign(next)!.colors.accent, "#123456");

  // null returns a field to auto.
  const back = applyManualEdit(next, { colors: { accent: null } });
  assert.deepEqual(designProfileView(back).colors.accent, { value: "#6f42c1", source: "auto" });

  // „Auf Standard zurücksetzen“: neutral until saved or detected again with enable.
  const reset = resetDesign(next);
  assert.equal(resolveGroundingDesign(reset), null);
  assert.equal(resolveGroundingDesign(applyDetection(reset, detect(BOOTSTRAP_SITE), { url: "x", at: "y" })), null, "the automatic run keeps it neutral");
  assert.ok(resolveGroundingDesign(applyDetection(reset, detect(BOOTSTRAP_SITE), { url: "x", at: "y", enable: true })), "„Design neu erkennen“ switches it back on");
  assert.equal(resolveGroundingDesign(null), null);
  assert.equal(resolveGroundingDesign(record({ ...EMPTY_DESIGN_VALUES, notes: [] })), null, "nothing detected → neutral");

  // CSS injection through a font name or a colour is impossible.
  const evil = manualFont({ name: 'Evil"}body{display:none}', stack: "serif" })!;
  assert.ok(!/[{}"]/.test(evil.css_stack.replace(/"[^"]*"/g, "")), evil.css_stack);
  assert.ok(!/display:none/.test(buildDesignCss(resolveDesignValues({ ...EMPTY_DESIGN_VALUES, fonts: { body: evil } })).css));
  assert.equal(applyManualEdit(null, { colors: { text: "red;}body{display:none" } }).manual.colors.text, undefined);
}

// --- renderer: neutral unchanged, design via :root variables, budget ------------------------------
const model = websiteModel();
const render = (design: ResolvedDesign | null) => renderGroundingHtml({ model, createdDay: "2026-10-01", modifiedDay: "2026-11-05", design });
const LEGACY_CSS = `body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.6;color:#1b1f24;background:#fff}
main{max-width:46rem;margin:0 auto;padding:2rem 1rem 3rem}
.breadcrumb{display:flex;flex-wrap:wrap;gap:.5rem;list-style:none;margin:0 0 1.5rem;padding:0;font-size:.875rem}
.breadcrumb li+li::before{content:"›";margin-right:.5rem;color:#6b7280}
.lead-definition{font-size:1.125rem}
.data-grid{display:grid;grid-template-columns:minmax(8rem,max-content) 1fr;gap:.35rem 1.25rem;margin:1rem 0}
.data-grid dt{font-weight:600}.data-grid dd{margin:0;grid-column:2}
.source,.page-meta{font-size:.875rem;color:#4b5563}
section{margin-top:2rem}`;
const neutralHtml = render(null);
assert.equal(NEUTRAL_CSS, LEGACY_CSS, "the neutral template is today's CSS");
assert.ok(neutralHtml.includes(`<style>\n${LEGACY_CSS}\n</style>`));
assert.equal(neutralHtml, renderGroundingHtml({ model, createdDay: "2026-10-01", modifiedDay: "2026-11-05" }), "no profile = no change");
assert.ok(!neutralHtml.includes(DESIGN_STYLE_ID));

/** The WordPress fixture on the model's own domain (fonts must come from the page's origin). */
const onModelSite = (fx: DesignFixture): DesignFixture => JSON.parse(JSON.stringify(fx).replaceAll("www.tischlerei-holz.example", "www.beispiel-bau.de"));
const wpDesign = resolved(onModelSite(WORDPRESS_SITE));
const designedHtml = render(wpDesign);
assert.ok(designedHtml.includes(`<style id="${DESIGN_STYLE_ID}">`));
assert.match(designedHtml, /:root\{--gp-text:#2b2522;--gp-bg:#fbf8f3;/);
assert.match(designedHtml, /a\{color:var\(--gp-link\)\}/);
assert.match(designedHtml, /main\{max-width:46rem;margin:0 auto;padding:2rem 1rem 3rem\}/, "layout kept");
assert.match(designedHtml, /\.data-grid\{display:grid;grid-template-columns:minmax\(8rem,max-content\) 1fr/);
assert.match(designedHtml, /\.breadcrumb li\+li::before\{content:"›"/);
assert.ok(!/<script(?![^>]*ld\+json)/.test(designedHtml), "no JavaScript");
assert.ok(!/<link\b[^>]*stylesheet/i.test(designedHtml), "no external stylesheet");
assert.deepEqual(errors(validateGroundingHtml(designedHtml, { reviewed: false })), []);
assert.deepEqual(errors(validateGroundingHtml(applyReviewToHtml(designedHtml, { day: "2026-11-05" }), { reviewed: true })), []);
const styleText = /<style[^>]*>([\s\S]*?)<\/style>/.exec(designedHtml)![1]!;
assert.ok(byteLength(styleText.trim()) <= GROUNDING_CSS_BUDGET);
for (const fx of [WORDPRESS_SITE, ELEMENTOR_SITE, PLAIN_CSS_SITE, BOOTSTRAP_SITE, GOOGLE_FONTS_SITE, SELF_HOSTED_SITE, LOW_CONTRAST_SITE]) {
  const { bytes } = buildDesignCss(resolved(fx));
  assert.ok(bytes <= GROUNDING_CSS_BUDGET, `${fx.pageUrl}: ${bytes} B`);
  assert.ok(byteLength(snippetCss(resolved(fx))) <= GROUNDING_CSS_BUDGET + 400, `${fx.pageUrl}: scoped CSS stays small`);
}
{
  // Many long font URLs: faces are dropped, never the budget.
  const face = (n: number) => ({ url: `https://www.beispiel-bau.de/wp-content/uploads/a-very-long-folder-name-for-fonts/${"x".repeat(80)}-${n}.woff2`, format: "woff2" as const, weight: n % 2 ? "700" : "400", style: "normal" as const });
  const heavy = resolveDesignValues({
    ...EMPTY_DESIGN_VALUES,
    fonts: {
      body: { name: "Long Sans", css_stack: '"Long Sans",sans-serif', source: "self-hosted", font_face_urls: [face(1), face(2), face(3), face(4)] },
      heading: { name: "Long Serif", css_stack: '"Long Serif",serif', source: "self-hosted", font_face_urls: [face(5), face(6), face(7), face(8)] },
    },
  });
  const built = buildDesignCss(heavy);
  assert.ok(built.bytes <= GROUNDING_CSS_BUDGET, `${built.bytes}`);
  assert.ok(built.droppedFaces > 0);
  assert.ok(/@font-face/.test(built.css), "the most important face still fits");
}

// --- a page on another host than the website loads no font files -----------------------------------------
{
  const foreign = renderGroundingHtml({ model: { ...model, pageUrl: "https://fakten.anderer-host.example/grounding/" }, createdDay: "2026-10-01", modifiedDay: "2026-11-05", design: wpDesign });
  assert.ok(!/@font-face/.test(foreign), "fonts of www.beispiel-bau.de are not loaded on another host");
  assert.match(foreign, /--gp-font:Inter,system-ui/, "the name stays in the stack (a locally installed font only)");
  assert.deepEqual(errors(validateGroundingHtml(foreign, { reviewed: false })).filter((i) => i.code === "font_external"), []);
}

// --- validator rejects violations ---------------------------------------------------------------------
{
  const inject = (html: string, head: string, body = "") => html.replace("</head>", `${head}\n</head>`).replace("</main>", `${body}\n</main>`);
  const strict = (html: string) => codes(errors(validateGroundingHtml(html, { reviewed: false })));
  assert.deepEqual(strict(inject(designedHtml, '<link rel="stylesheet" href="https://cdn.example.com/x.css">')), ["stylesheet_link"]);
  assert.deepEqual(strict(inject(designedHtml, "<style>@import url(https://fonts.googleapis.com/css2?family=Roboto);</style>")), ["stylesheet_link"]);
  assert.deepEqual(
    strict(inject(designedHtml, "<style>@font-face{font-family:R;src:url(https://fonts.gstatic.com/r.woff2) format('woff2')}</style>")),
    ["font_external"],
  );
  assert.deepEqual(strict(inject(designedHtml, "<style>.x{background:url(https://cdn.example.com/bg.png)}</style>")), ["external_resource"]);
  assert.deepEqual(strict(inject(designedHtml, "", '<img src="https://www.beispiel-bau.de/logo.png" alt="">')), ["external_resource"]);
  assert.deepEqual(strict(inject(designedHtml, '<link rel="preconnect" href="https://fonts.gstatic.com">')), ["external_resource"]);
  assert.deepEqual(strict(inject(designedHtml, "", '<p onclick="alert(1)">x</p>')), ["javascript_inline"]);
  assert.deepEqual(strict(inject(designedHtml, "", '<a href="javascript:alert(1)">x</a>')), ["javascript_inline"]);
  assert.deepEqual(strict(inject(designedHtml, "<script>alert(1)</script>")), ["javascript"]);
  assert.deepEqual(strict(inject(designedHtml, `<style>.pad{${"margin:0;".repeat(200)}}</style>`)), ["css_budget"]);
  assert.deepEqual(
    errors(validateDesignLimits(designedHtml, { siteUrl: "https://beispiel-bau.de/grounding/" })),
    [],
    "own fonts on the client's origin are allowed",
  );
  assert.deepEqual(
    codes(errors(validateDesignLimits(designedHtml, { siteUrl: "https://www.anderer-kunde.de/grounding/" }))),
    ["font_external"],
    "fonts of another domain are not",
  );
  // A CMS page refreshed in place keeps its theme assets: not checked there.
  const cmsPage = inject(neutralHtml, '<link rel="stylesheet" href="https://cdn.example.com/theme.css"><script src="/wp.js"></script>');
  assert.deepEqual(codes(errors(validateGroundingHtml(cmsPage, { reviewed: false, strict: false }))), []);
  assert.deepEqual(
    errors(validateGroundingDraft({ html: designedHtml, llmsTxt: "# x\n\nentity: x\n\n## METADATEN\n", model, reviewed: false, generated: true }).issues).filter((i) => /css|font|resource|javascript|stylesheet/.test(i.code)),
    [],
  );
}

// --- design-only change → no update_required ------------------------------------------------------------
{
  const live = (html: string) => applyReviewToHtml(html, { day: "2026-08-01" });
  const pageUrl = model.pageUrl;
  const parse = (html: string) => parseExistingGroundingPage({ pageUrl, html, llmsUrl: null, llmsTxt: null, organisationName: model.organisationName, websiteUrl: model.websiteUrl });
  const neutralLive = live(neutralHtml);
  const variants = [live(designedHtml), live(render(resolved(SELF_HOSTED_SITE))), live(render(resolved(PLAIN_CSS_SITE))), replaceDesignStyle(neutralLive, resolved(ELEMENTOR_SITE)).html];
  const neutralModel = parse(neutralLive);
  const neutralStructure = checkExistingPageStructure(neutralLive, { pageUrl, websiteUrl: model.websiteUrl });
  const neutralDiff = computeGroundingDiff(model, neutralModel, undefined, neutralStructure);
  const neutralDecision = decideGroundingCheck({ pageExists: true, diff: neutralDiff, scheduleStatus: "ok" });
  assert.equal(neutralDecision.decision, "up_to_date", JSON.stringify(neutralDecision.reasons));
  for (const variant of variants) {
    assert.notEqual(variant, neutralLive);
    assert.deepEqual(parse(variant), neutralModel, "existing-page.ts reads the designed page like the neutral one");
    const structure = checkExistingPageStructure(variant, { pageUrl, websiteUrl: model.websiteUrl });
    assert.deepEqual(structure, neutralStructure);
    const diff = computeGroundingDiff(model, parse(variant), undefined, structure);
    assert.deepEqual(diff.counts, neutralDiff.counts);
    assert.equal(decideGroundingCheck({ pageExists: true, diff, scheduleStatus: "ok" }).decision, "up_to_date", "a design change alone is no update");
  }
}

// --- swapping the design of a stored draft ----------------------------------------------------------
{
  const swapped = replaceDesignStyle(neutralHtml, wpDesign);
  assert.ok(swapped.replaced);
  assert.equal(swapped.html, designedHtml, "neutral draft → current design, content byte for byte");
  assert.equal(replaceDesignStyle(designedHtml, null).html, neutralHtml, "and back");
  const handEdited = neutralHtml.replace("section{margin-top:2rem}", "section{margin-top:3rem}");
  assert.equal(replaceDesignStyle(handEdited, wpDesign).replaced, false, "a hand-edited style block stays");
  const row = { draft_html: neutralHtml, decision: "create" } as Pick<DtGroundingRunRow, "draft_html" | "decision">;
  assert.equal(draftHtmlWithDesign(row, wpDesign), designedHtml);
  assert.equal(draftHtmlWithDesign({ ...row, decision: "refresh_only" }, wpDesign), neutralHtml, "a CMS page refreshed in place keeps its look");
  assert.equal(draftHtmlWithDesign(row, undefined), neutralHtml);
  const detail = serializeRunDetail(
    { id: "r", organisation_id: "o", trigger: "manual", status: "approved", step: "done", decision: "create", draft_html: neutralHtml, draft_llms_txt: "x", hints: null } as unknown as DtGroundingRunRow,
    { design: wpDesign },
  );
  assert.equal(detail.draftHtml, designedHtml);
  assert.equal(detail.cmsFields.canonicalUrl, model.pageUrl);
}

// --- CMS snippet ------------------------------------------------------------------------------------------
{
  const approved = applyReviewToHtml(designedHtml, { day: "2026-11-05" });
  const site = model.pageUrl;
  const plain = buildCmsSnippet(approved);
  assert.ok(!/<!doctype|<html|<head|<body/i.test(plain), "no document shell");
  assert.match(plain, /^<!-- Grounding Page Standard v1\.7/, "standard comment kept (stamped at approval)");
  assert.match(plain, /<div class="grounding-page">\n<nav aria-label="Brotkrumen">/);
  assert.ok(!/<style/.test(plain), "no CSS by default: the CMS theme styles it");
  assert.match(plain, /<p class="review-notice">Fakten geprüft von Sichtbarkeitsmeister GmbH · Zuletzt von einem Menschen geprüft: <time datetime="2026-11-05">/);
  assert.match(plain, /<\/div>\n<script type="application\/ld\+json">/);
  assert.equal((plain.match(/application\/ld\+json/g) ?? []).length, 1);
  const jsonLd = /<script type="application\/ld\+json">[\s\S]*?<\/script>/.exec(approved)![0];
  assert.ok(plain.includes(jsonLd), "JSON-LD byte for byte, with reviewedBy/lastReviewed");
  assert.deepEqual(errors(validateCmsSnippet(plain, { siteUrl: site })), []);

  const styled = buildCmsSnippet(approved, { css: snippetCss(wpDesign) });
  assert.match(styled, /<div class="grounding-page">\n<style>\n/);
  assert.match(styled, /\.grounding-page\{--gp-text:#2b2522;/, "variables on the wrapper, not :root");
  assert.ok(!/:root|(^|\n)body\{|(^|\n)main\{/.test(styled), "nothing outside the wrapper is styled");
  assert.match(styled, /\.grounding-page a\{color:var\(--gp-link\)\}/);
  assert.match(styled, /@font-face\{font-family:Inter;src:url\("https:\/\/www\.beispiel-bau\.de\//);
  assert.deepEqual(errors(validateCmsSnippet(styled, { siteUrl: site })), []);
  assert.ok(/\.grounding-page\{--gp-text:#1b1f24/.test(snippetCss(null)), "neutral design scoped when there is no profile");

  // Validator of the snippet rejects a document, unscoped CSS and JavaScript.
  assert.deepEqual(codes(errors(validateCmsSnippet(approved, { siteUrl: site }))).includes("snippet_document"), true);
  assert.deepEqual(codes(errors(validateCmsSnippet(plain.replace('<div class="grounding-page">', '<div class="grounding-page"><style>h1{color:red}</style>'), { siteUrl: site }))), ["snippet_css_scope"]);
  assert.deepEqual(codes(errors(validateCmsSnippet(`${plain}<script>alert(1)</script>`, { siteUrl: site }))), ["javascript"]);

  // Pasted into a CMS page, the live page reads like the standalone file.
  const cmsPage = `<!doctype html><html lang="de"><head><title>Fakten – Beispiel Bau</title><link rel="stylesheet" href="/wp-content/themes/x/style.css"></head><body><header><nav><a href="/">Start</a></nav></header><main id="main"><article class="page">${styled}</article></main><footer><a href="/impressum/">Impressum</a></footer></body></html>`;
  const parse = (html: string) => parseExistingGroundingPage({ pageUrl: model.pageUrl, html, llmsUrl: null, llmsTxt: null, organisationName: model.organisationName, websiteUrl: model.websiteUrl });
  assert.deepEqual(parse(cmsPage).entities, parse(approved).entities);
  assert.deepEqual(parse(cmsPage).faq, parse(approved).faq);

  const fields = cmsFieldsFromHtml(approved);
  assert.equal(fields.title, "Beispiel Bau GmbH: Fakten");
  assert.equal(fields.canonicalUrl, "https://www.beispiel-bau.de/grounding/");
  assert.equal(fields.slug, "grounding");
  assert.equal(fields.path, "/grounding/");
  assert.equal(fields.h1, "Beispiel Bau GmbH");
  assert.ok(fields.metaDescription && fields.metaDescription.length > 20);
}

// --- the agent's HTML: no styles of its own -----------------------------------------------------------
{
  const injected = injectDesign(AGENT_HTML, wpDesign);
  assert.equal((injected.match(/<style\b/g) ?? []).length, 1, "only the design block");
  assert.ok(injected.includes(`<style id="${DESIGN_STYLE_ID}">`));
  assert.ok(!/style="|onclick|javascript:|console\.log|googleapis|gstatic/.test(injected), injected);
  assert.match(injected, /<link rel="canonical" href="https:\/\/www\.beispiel-bau\.de\/grounding\/">/);
  assert.ok(injected.includes('{"@context":"https://schema.org","@type":"WebPage","@id":"https://www.beispiel-bau.de/grounding/","name":"Beispiel Bau <GmbH>"}'), "JSON-LD untouched");
  assert.equal(injectDesign(injected, wpDesign), injected, "idempotent");
  assert.equal(injectDesign(injected, null).includes(`<style>\n${NEUTRAL_CSS}\n</style>`), true, "neutral without a profile");
  assert.deepEqual(errors(validateDesignLimits(injectDesign(AGENT_HTML, resolved(SELF_HOSTED_SITE)), { siteUrl: "https://www.beispiel-bau.de/grounding/" })), []);
  const snippet = buildCmsSnippet(injected);
  assert.ok(!/<style|console\.log/.test(snippet));
  assert.match(snippet, /<h1>Beispiel Bau GmbH<\/h1>/);
  assert.equal(designStyleBlock(null), `<style>\n${NEUTRAL_CSS}\n</style>`);
}

console.log("grounding-design tests: ok");
