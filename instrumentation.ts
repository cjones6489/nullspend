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

    if (process.env.NULLSPEND_DEV_MODE === "true") {
      warnings.push(
        "NULLSPEND_DEV_MODE is enabled in production. " +
        "This enables auth bypass and dev fallbacks. " +
        "Remove it from your production environment."
      );
    }

    for (const warning of warnings) {
      console.error(`[NullSpend] SECURITY WARNING: ${warning}`);
    }

    if (warnings.length > 0 && process.env.NULLSPEND_STRICT_BOOT === "true") {
      throw new Error(
        "[NullSpend] Refusing to start: dev-only env vars detected in production. " +
        "Unset NULLSPEND_DEV_ACTOR and NULLSPEND_API_KEY, or remove NULLSPEND_STRICT_BOOT."
      );
    }
  }
}
