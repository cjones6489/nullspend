/**
 * Semaphore that limits concurrent pg.Client connections from waitUntil tasks.
 *
 * Cloudflare Workers enforces a 6-connection-per-isolate limit. The main
 * request path (budget-lookup) may use 1 connection, so we cap background
 * tasks (cost-logger + budget-spend) to 2 concurrent connections, leaving
 * headroom for the request flow and avoiding deadlocks under load.
 */

const MAX_CONCURRENT = 2;
let active = 0;
const queue: Array<() => void> = [];

export async function withDbConnection<T>(fn: () => Promise<T>): Promise<T> {
  if (active < MAX_CONCURRENT) {
    active++;
  } else {
    await new Promise<void>((resolve) => queue.push(resolve));
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
