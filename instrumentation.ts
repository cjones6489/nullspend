export async function register() {
  if (process.env.NODE_ENV === "production") {
    const warnings: string[] = [];

    if (process.env.NULLSPEND_DEV_ACTOR) {
      warnings.push(
        "NULLSPEND_DEV_ACTOR is set in production. " +
        "This variable enables auth bypass in development mode. " +
        "Remove it from your production environment."
      );
    }

    if (process.env.NULLSPEND_API_KEY) {
      warnings.push(
        "NULLSPEND_API_KEY is set in production. " +
        "This is a development-only fallback key. " +
        "Use managed API keys instead."
      );
    }

    // NULLSPEND_DEV_MODE in production is a hard block — it enables
    // unauthenticated reads via the session fallback. Never allow it.
    if (process.env.NULLSPEND_DEV_MODE === "true") {
      throw new Error(
        "[NullSpend] REFUSING TO START: NULLSPEND_DEV_MODE=true in production. " +
        "This enables unauthenticated access to all session-based API routes. " +
        "Remove NULLSPEND_DEV_MODE from your production environment."
      );
    }

    for (const warning of warnings) {
      console.error(`[NullSpend] SECURITY WARNING: ${warning}`);
    }
  }

  // Sentry server-side initialization
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    await import("./sentry.server.config");
  }
}

// Capture server-side errors automatically (server components, layouts, proxy).
// Next.js calls this hook for uncaught errors in server components and route handlers.
export { captureRequestError as onRequestError } from "@sentry/nextjs";
