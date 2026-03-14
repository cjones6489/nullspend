/**
 * Semaphore that limits concurrent pg.Client connections from waitUntil tasks.
 *
 * Cloudflare Workers enforces a 6-connection-per-isolate limit. The main
 * request path (budget-lookup) may use 1 connection, so we cap background
 * tasks (cost-logger + budget-spend) to 2 concurrent connections, leaving
 * headroom for the request flow and avoiding deadlocks under load.
 */

const MAX_CONCURRENT = 2;
const MAX_QUEUE_DEPTH = 20;
const QUEUE_TIMEOUT_MS = 10_000;

let active = 0;
const queue: Array<() => void> = [];

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
