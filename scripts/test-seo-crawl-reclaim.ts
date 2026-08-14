import assert from "node:assert/strict";

import { reclaimStuckCrawlUrls } from "../lib/dt/seo/reclaim-stuck-crawl-urls";

type FakeRow = { id: string; status: string };

function fakeSupabase(rows: FakeRow[]) {
  return {
    from(_table: string) {
      return {
        update(patch: { status: string }) {
          return {
            eq(_col: string, _val: string) {
              return {
                eq(col2: string, val2: string) {
                  return {
                    async select(_cols: string) {
                      const touched = rows.filter((r) => r.status === val2 && col2 === "status");
                      for (const r of touched) r.status = patch.status;
                      return { data: touched.map((r) => ({ id: r.id })), error: null };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

async function main() {
  const rows: FakeRow[] = [
    { id: "a", status: "processing" },
    { id: "b", status: "processing" },
    { id: "c", status: "pending" },
    { id: "d", status: "done" },
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const n = await reclaimStuckCrawlUrls(fakeSupabase(rows) as any, "crawl-1");
  assert.equal(n, 2);
  assert.equal(rows.filter((r) => r.status === "pending").length, 3);
  assert.equal(rows.filter((r) => r.status === "processing").length, 0);
  assert.equal(rows.find((r) => r.id === "d")?.status, "done");
  console.log("seo-crawl reclaim tests: ok");
}

void main();
