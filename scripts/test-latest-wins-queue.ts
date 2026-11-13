/**
 * The queue behind the „Schritte“ switches: one request at a time, only the newest value after a
 * burst, older answers never win.
 *
 *   npx tsx scripts/test-latest-wins-queue.ts
 */
import assert from "node:assert/strict";

import { createLatestWinsQueue } from "../lib/dt/content/latest-wins-queue";

const tick = () => new Promise((r) => setTimeout(r, 0));

async function main() {
  // A burst while the first request runs: the first and the last value are sent, the ones between are dropped.
  const sent: string[] = [];
  const releases: Array<() => void> = [];
  const queue = createLatestWinsQueue<string, string>(
    (value) =>
      new Promise((resolve) => {
        sent.push(value);
        releases.push(() => resolve(`ok:${value}`));
      }),
  );
  const first = queue.enqueue("a");
  const second = queue.enqueue("b");
  const third = queue.enqueue("c");
  const fourth = queue.enqueue("d");
  await tick();
  assert.deepEqual(sent, ["a"], "one request at a time");
  assert.equal(await second, null, "superseded values resolve with null");
  assert.equal(await third, null);
  releases[0]!();
  assert.equal(await first, "ok:a", "the running request still answers its own caller");
  await tick();
  assert.deepEqual(sent, ["a", "d"], "then only the newest value goes out");
  releases[1]!();
  assert.equal(await fourth, "ok:d");
  await queue.idle();

  // idle: resolves at once when nothing runs, and after the last request otherwise.
  const quick = createLatestWinsQueue<number, number>(async (v) => v * 2);
  await quick.idle();
  const pending = quick.enqueue(21);
  let idleDone = false;
  const idle = quick.idle().then(() => {
    idleDone = true;
  });
  assert.equal(idleDone, false);
  assert.equal(await pending, 42);
  await idle;
  assert.equal(idleDone, true);

  // A request that throws: its waiter gets null, the queue goes on.
  let calls = 0;
  const flaky = createLatestWinsQueue<number, number>(async (v) => {
    calls += 1;
    if (v === 1) throw new Error("boom");
    return v;
  });
  assert.equal(await flaky.enqueue(1), null);
  assert.equal(await flaky.enqueue(2), 2);
  assert.equal(calls, 2);
  console.log("latest-wins queue: one at a time, newest wins, idle, errors: ok");
  console.log("OK: latest-wins queue tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
