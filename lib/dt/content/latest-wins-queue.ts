/**
 * Saves a value one request at a time and only ever the newest one: while a request is in flight,
 * newer values replace each other, so a quick series of switches costs at most two requests (the
 * one running and the last value), and an older answer can never overwrite a newer choice.
 * `enqueue` resolves with the answer to the request that carried that value, or with `null` when
 * a newer value took its place. `idle` resolves when nothing is running or waiting any more.
 * `send` must not throw (`contentApi` never does); if it does, the waiters get `null`.
 */
export function createLatestWinsQueue<V, R>(send: (value: V) => Promise<R>) {
  let running = false;
  let next: { value: V; resolvers: Array<(result: R | null) => void> } | null = null;
  let idleWaiters: Array<() => void> = [];

  async function pump(): Promise<void> {
    if (running) return;
    running = true;
    while (next) {
      const job = next;
      next = null;
      let result: R | null = null;
      try {
        result = await send(job.value);
      } catch {
        result = null;
      }
      for (const resolve of job.resolvers) resolve(result);
    }
    running = false;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  return {
    enqueue(value: V): Promise<R | null> {
      return new Promise((resolve) => {
        // The waiting value is replaced: whoever waited for it learns that a newer one took over.
        if (next) for (const superseded of next.resolvers) superseded(null);
        next = { value, resolvers: [resolve] };
        void pump();
      });
    },
    idle(): Promise<void> {
      if (!running && !next) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
  };
}
