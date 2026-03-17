import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestStore {
  requestId: string;
  method: string;
  path: string;
  startTime: number;
  userId?: string;
}

const als = new AsyncLocalStorage<RequestStore>();

/**
 * Run a function within a route-scoped request context.
 * Called at the start of each route handler (not in proxy.ts).
 */
export function runWithRequestContext<T>(
  store: Omit<RequestStore, "startTime">,
  fn: () => T,
): T {
  return als.run({ ...store, startTime: Date.now() }, fn);
}

export function getRequestId(): string | undefined {
  return als.getStore()?.requestId;
}

export function getRequestStore(): RequestStore | undefined {
  return als.getStore();
}
