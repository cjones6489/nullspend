export async function register() {
  if (process.env.NODE_ENV === "production") {
    const warnings: string[] = [];

    if (process.env.AGENTSEAM_DEV_ACTOR) {
      warnings.push(
        "AGENTSEAM_DEV_ACTOR is set in production. " +
        "This variable enables auth bypass in development mode. " +
        "Remove it from your production environment."
      );
    }

    if (process.env.AGENTSEAM_API_KEY) {
      warnings.push(
        "AGENTSEAM_API_KEY is set in production. " +
        "This is a development-only fallback key. " +
        "Use managed API keys instead."
      );
    }

    for (const warning of warnings) {
      console.error(`[AgentSeam] SECURITY WARNING: ${warning}`);
    }

    if (warnings.length > 0 && process.env.AGENTSEAM_STRICT_BOOT === "true") {
      throw new Error(
        "[AgentSeam] Refusing to start: dev-only env vars detected in production. " +
        "Unset AGENTSEAM_DEV_ACTOR and AGENTSEAM_API_KEY, or remove AGENTSEAM_STRICT_BOOT."
      );
    }
  }
}
