import * as Sentry from "@sentry/nextjs";

import { getRequestStore } from "./request-context";

/**
 * Capture an exception with enriched context from the current request store.
 * Falls back to bare captureException if no store is active.
 */
export function captureExceptionWithContext(error: unknown): void {
  const store = getRequestStore();

  if (!store) {
    Sentry.captureException(error);
    return;
  }

  Sentry.withScope((scope) => {
    scope.setTag("requestId", store.requestId);
    scope.setTag("route", store.path);
    scope.setTag("method", store.method);

    if (store.userId) {
      scope.setUser({ id: store.userId });
    }

    Sentry.captureException(error);
  });
}

/**
 * Thin wrapper around Sentry.addBreadcrumb.
 * @sentry/nextjs v10 scopes breadcrumbs per-request via its internal ALS.
 */
export function addSentryBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  Sentry.addBreadcrumb({ category, message, data, level: "info" });
}
