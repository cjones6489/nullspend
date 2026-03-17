import pino from "pino";

import { getRequestStore } from "./request-context";

const rootLogger = pino({
  level:
    process.env.LOG_LEVEL ??
    (process.env.NODE_ENV === "production" ? "info" : "debug"),
});

/**
 * Get a logger with optional component name.
 * Automatically includes requestId when called within a request context.
 */
export function getLogger(component?: string): pino.Logger {
  const bindings: Record<string, unknown> = {};
  const store = getRequestStore();
  if (store?.requestId) bindings.requestId = store.requestId;
  if (component) bindings.component = component;
  return Object.keys(bindings).length > 0
    ? rootLogger.child(bindings)
    : rootLogger;
}

export { rootLogger as logger };
