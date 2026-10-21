/**
 * Crawl as the second input of the text tools SEO, GEO and Hormozi: the page list (same rules
 * as Texte), loading a chosen page (live HTML first, stored crawl text as fallback, only URLs
 * of the organisation's crawl), and the import rules for web pages (H1 first, more than 40
 * sections folded instead of refused). Fake database and fetch; no network.
 * Run: npx tsx scripts/test-text-tools-crawl-source.ts
 */
import assert from "node:assert/strict";

import { planCrawlContentPages, type CrawledSitePage } from "../lib/dt/content/crawl-pages";
import {
  crawlSourcePagesFrom,
  loadCrawledPageInput,
  mainContentHtml,
  storedCrawlText,
} from "../lib/dt/text-tools/crawl-source";
import { TEXT_TOOL_MAX_BLOCKS, blocksFromDocument, fitSectionsToLimit, h1First } from "../lib/dt/text-tools/ingest";
import { readTextToolInput } from "../lib/dt/text-tools/tool-input";

const ORG = "11111111-1111-4111-8111-111111111111";
const at = "2026-10-20T10:00:00Z";
const page = (url: string, extra: Partial<CrawledSitePage> = {}): CrawledSitePage => ({
  url, title: null, h1: null, text_content: null, is_excluded: false, crawled_at: at, final_url: null, ...extra,
});

function testPageList() {
  const rows = [
    page("https://praxis.de/leistungen/implantate", { h1: "Implantate in Krefeld" }),
    page("https://praxis.de/", { title: "Zahnarzt Krefeld | Praxis" }),
    page("https://www.praxis.de/", { title: "Zahnarzt Krefeld | Praxis" }),
    page("https://praxis.de/leistungen", { h1: "Leistungen" }),
    page("https://praxis.de/agb", { h1: "AGB", is_excluded: true }),
    page("https://praxis.de/alt", { h1: "Alt", final_url: "https://praxis.de/neu" }),
    page("https://praxis.de/leer"),
    page("https://praxis.de/ratgeber/zahnreinigung", { h1: "Wie oft zur Zahnreinigung?" }),
  ];
  const { pages, skipped } = crawlSourcePagesFrom(planCrawlContentPages([], rows));
  assert.deepEqual(pages.map((p) => [p.path, p.name, p.level]), [
    ["/", "Zahnarzt Krefeld", 0],
    ["/leistungen", "Leistungen", 1],
    ["/leistungen/implantate", "Implantate in Krefeld", 2],
    ["/ratgeber/zahnreinigung", "Wie oft zur Zahnreinigung?", 2],
  ]);
  assert.equal(pages[0]!.page_type, "startseite");
  assert.equal(pages[2]!.pillar_name, "Leistungen");
  assert.equal(pages[0]!.url, "https://praxis.de/");
  assert.deepEqual(skipped, { excluded: 1, empty: 1, redirected: 1, duplicate: 1, over_limit: 0 });
  console.log("page list (Texte rules): ok");
}

function testMainContent() {
  const head = "<head><title>Implantate | Praxis</title><meta name=\"description\" content=\"Feste Zähne.\"></head>";
  const withMain = `<html>${head}<body><nav>Menü</nav><div class="cookie">Cookies?</div><main><h1>Implantate</h1><p>Text.</p></main></body></html>`;
  const narrowed = mainContentHtml(withMain);
  assert.match(narrowed, /<main><h1>Implantate<\/h1>/);
  assert.doesNotMatch(narrowed, /Cookies/);
  assert.match(narrowed, /<title>Implantate \| Praxis<\/title>/, "the head stays for title and meta description");

  // A blog teaser <article> without the H1 must not replace the page.
  const teaser = `<html>${head}<body><article><h3>Neu im Blog</h3><p>Kurz.</p></article><h1>Startseite</h1><p>Viel Text.</p></body></html>`;
  assert.equal(mainContentHtml(teaser), teaser);
  const articleH1 = `<html>${head}<body><aside>Werbung</aside><article><h1>Ratgeber</h1><p>Text.</p></article></body></html>`;
  assert.doesNotMatch(mainContentHtml(articleH1), /Werbung/);
  console.log("main content narrowing: ok");
}

function testWebImportRules() {
  // H1 first: teaser text before the H1 stays, but after it.
  assert.deepEqual(
    h1First([{ heading: null, level: 2 as const }, { heading: "Titel", level: 1 as const }, { heading: "A", level: 2 as const }]).map((s) => s.heading),
    ["Titel", null, "A"],
  );
  const html = `<body><p>Teaser vor der H1.</p><h1>Implantate</h1><p>Einleitung.</p><h2>Ablauf</h2><p>Schritte.</p></body>`;
  const web = blocksFromDocument({ kind: "html", content: html }, { fitToLimit: true });
  assert.ok(web.ok);
  assert.deepEqual(web.value.blocks.map((b) => [b.heading, b.level]), [["Implantate", 1], [null, 2], ["Ablauf", 2]]);
  const upload = blocksFromDocument({ kind: "html", content: html });
  assert.ok(upload.ok && upload.value.blocks[0]!.heading === null, "uploads keep their order");

  // More than 40 sections: refused for an upload, folded for a crawled page (H3 first, no text lost).
  const many = `<body><h1>Seite</h1>${Array.from({ length: 30 }, (_, i) => `<h2>Teil ${i}</h2><p>Absatz ${i}.</p><h3>Detail ${i}</h3><p>Mehr ${i}.</p>`).join("")}</body>`;
  const strict = blocksFromDocument({ kind: "html", content: many });
  assert.ok(!strict.ok && /höchstens 40/.test(strict.message));
  const fitted = blocksFromDocument({ kind: "html", content: many }, { fitToLimit: true });
  assert.ok(fitted.ok);
  assert.ok(fitted.value.blocks.length <= TEXT_TOOL_MAX_BLOCKS);
  assert.equal(fitted.value.blocks[0]!.heading, "Seite");
  const all = fitted.value.blocks.map((b) => `${b.heading ?? ""} ${b.html}`).join(" ");
  for (let i = 0; i < 30; i += 1) assert.ok(all.includes(`Mehr ${i}.`) && all.includes(`Detail ${i}`), `section ${i} kept`);
  // Only as many H3 as needed are folded, from the end: the last ones become bold lines, the first stay headings.
  assert.match(all, /<p><strong>Detail 29<\/strong><\/p>/, "a folded H3 becomes a bold line");
  assert.ok(fitted.value.blocks.some((b) => b.heading === "Detail 0" && b.level === 3), "early H3 keep their heading");

  // Without H3 left, the shortest sections fold into their predecessor; ids are renumbered.
  const flat = Array.from({ length: 45 }, (_, i) => ({ id: `x${i}`, heading: `H${i}`, level: (i === 0 ? 1 : 2) as 1 | 2, html: `<p>${"t".repeat(i)}</p>` }));
  const out = fitSectionsToLimit(flat, 40);
  assert.equal(out.length, 40);
  assert.equal(out[0]!.heading, "H0");
  assert.deepEqual(out.map((s) => s.id), Array.from({ length: 40 }, (_, i) => `abschnitt-${i + 1}`));
  console.log("web import rules: ok");
}

function testStoredText() {
  const text = storedCrawlText({ h1: "Implantate", title: "Implantate | Praxis", text_content: "Implantate\nFeste Zähne.\nAblauf\nIn drei Schritten." });
  assert.equal(text, "# Implantate\n\nFeste Zähne.\nAblauf\nIn drei Schritten.");
  const blocks = blocksFromDocument({ kind: "text", content: text }, { fitToLimit: true });
  assert.ok(blocks.ok && blocks.value.blocks.length === 1 && blocks.value.blocks[0]!.heading === "Implantate");
  console.log("stored crawl text: ok");
}

/** A fake service that knows one crawled page. */
function fakeService(rows: Record<string, { url: string; title: string | null; h1: string | null; text_content: string | null; is_excluded: boolean }>) {
  const calls: string[] = [];
  const service = {
    from(table: string) {
      assert.equal(table, "dt_site_pages");
      const filters: Record<string, string> = {};
      const q = {
        select: () => q,
        eq: (col: string, val: string) => {
          filters[col] = val;
          return q;
        },
        maybeSingle: async () => {
          calls.push(filters.url!);
          const row = filters.organisation_id === ORG ? rows[filters.url!] : undefined;
          return { data: row ?? null, error: null };
        },
      };
      return q;
    },
  };
  return { service: service as never, calls };
}

const LIVE_HTML = `<html><head><title>Implantate | Praxis</title></head><body><header>Logo</header><main><p>Teaser.</p><h1>Implantate in Krefeld</h1><p>Feste Zähne.</p><h2>Ablauf</h2><p>Drei Schritte.</p></main><footer>Impressum</footer></body></html>`;
const ROW = { url: "https://praxis.de/implantate", title: "Implantate | Praxis", h1: "Implantate in Krefeld", text_content: "Implantate in Krefeld\nFeste Zähne.", is_excluded: false };

async function testLoadPage() {
  const { service } = fakeService({ [ROW.url]: ROW });
  const okFetch = async () => new Response(LIVE_HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  const live = await loadCrawledPageInput(service, ORG, ROW.url, { fetchImpl: okFetch });
  assert.ok(live.ok);
  assert.equal(live.value.source, "live");
  assert.equal(live.value.document.format, "web");
  assert.equal(live.value.fileName, "implantate.html");
  assert.equal(live.value.pageName, "Implantate in Krefeld");
  assert.deepEqual(live.value.ingested.blocks.map((b) => [b.heading, b.level]), [["Implantate in Krefeld", 1], [null, 2], ["Ablauf", 2]]);
  assert.equal(live.value.ingested.title, "Implantate | Praxis");
  assert.doesNotMatch(live.value.ingested.blocks.map((b) => b.html).join(""), /Logo|Impressum/);

  // Live fetch fails (down, 404, not HTML): the stored crawl text is used.
  for (const failing of [
    async () => { throw new Error("ECONNRESET"); },
    async () => new Response("nope", { status: 404, headers: { "content-type": "text/html" } }),
    async () => new Response("%PDF", { status: 200, headers: { "content-type": "application/pdf" } }),
  ]) {
    const fallback = await loadCrawledPageInput(service, ORG, ROW.url, { fetchImpl: failing as never });
    assert.ok(fallback.ok && fallback.value.source === "crawl" && fallback.value.ingested.blocks[0]!.heading === "Implantate in Krefeld");
  }

  // A URL outside the organisation's crawl is refused before any fetch.
  let fetched = false;
  const spy = async () => {
    fetched = true;
    return new Response(LIVE_HTML, { status: 200, headers: { "content-type": "text/html" } });
  };
  const foreign = await loadCrawledPageInput(service, ORG, "https://evil.example/", { fetchImpl: spy });
  assert.ok(!foreign.ok && /gehört nicht/.test(foreign.message));
  const otherOrg = await loadCrawledPageInput(service, "22222222-2222-4222-8222-222222222222", ROW.url, { fetchImpl: spy });
  assert.ok(!otherOrg.ok);
  assert.equal(fetched, false);

  // A crawled row pointing at a private address is never fetched live (stored text only).
  const { service: internal } = fakeService({ "http://127.0.0.1/admin": { ...ROW, url: "http://127.0.0.1/admin" } });
  const local = await loadCrawledPageInput(internal, ORG, "http://127.0.0.1/admin", { fetchImpl: spy });
  assert.ok(local.ok && local.value.source === "crawl");
  assert.equal(fetched, false);
  console.log("load crawled page: ok");
}

async function testReadToolInput() {
  const { service } = fakeService({});
  const none = await readTextToolInput(new FormData(), service, ORG);
  assert.deepEqual(none, { ok: true, value: null });

  const form = new FormData();
  form.set("file", new File(["# Titel\n\nText des Absatzes."], "seite.txt", { type: "text/plain" }));
  const file = await readTextToolInput(form, service, ORG);
  assert.ok(file.ok && file.value?.source === "file" && file.value.fileName === "seite.txt" && file.value.crawledPageName === null);

  const crawl = new FormData();
  crawl.set("crawlUrl", "https://nicht-im-crawl.de/");
  crawl.set("file", new File(["x"], "x.txt"));
  const refused = await readTextToolInput(crawl, service, ORG);
  assert.ok(!refused.ok && /gehört nicht/.test(refused.message), "crawlUrl wins over a file and is checked");
  console.log("read tool input: ok");
}

async function main() {
  testPageList();
  testMainContent();
  testWebImportRules();
  testStoredText();
  await testLoadPage();
  await testReadToolInput();
  console.log("ok: text-tools crawl source");
}

void main();
