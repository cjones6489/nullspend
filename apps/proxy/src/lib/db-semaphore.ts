/**
 * Semaphore that limits concurrent pg.Client connections per isolate.
 *
 * ALL pg.Client creation must go through withDbConnection(). Callers:
 *   - api-key-auth.ts    (request path, usually cached — skips DB)
 *   - budget-lookup.ts   (request path, Redis fast-path — rarely hits DB)
 *   - cost-logger.ts     (background via waitUntil)
 *   - budget-spend.ts    (background via waitUntil)
 *   - webhook-cache.ts   (background via waitUntil)
 *
 * Worst case: 3 background tasks fire in parallel after a response is sent
 * while the next request's auth or budget lookup needs a slot. Auth and
 * budget caches prevent most request-path DB lookups, so contention is
 * rare. 5 slots keeps headroom under CF's 6-connection-per-isolate limit.
 */

export const MAX_CONCURRENT = 5;
export const MAX_QUEUE_DEPTH = 20;
export const QUEUE_TIMEOUT_MS = 10_000;

let active = 0;
const queue: Array<() => void> = [];

/** Reset internal state — for testing only. */
export function _resetForTesting(): void {
  active = 0;
  queue.length = 0;
}

export async function withDbConnection<T>(fn: () => Promise<T>): Promise<T> {
  if (active < MAX_CONCURRENT) {
    active++;
  } else {
    if (queue.length >= MAX_QUEUE_DEPTH) {
      throw new Error("[db-semaphore] Queue full — dropping task");
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = queue.indexOf(resolve);
        if (idx !== -1) queue.splice(idx, 1);
        reject(new Error("[db-semaphore] Timed out waiting for connection slot"));
      }, QUEUE_TIMEOUT_MS);

      queue.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  try {
    return await fn();
  } finally {
    active--;
    const next = queue.shift();
    if (next) {
      active++;
      next();
    }
  }
}
