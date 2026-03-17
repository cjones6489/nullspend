import {
  AuthenticationRequiredError,
  SupabaseEnvError,
} from "@/lib/auth/errors";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { setRequestUserId } from "@/lib/observability/request-context";
import { addSentryBreadcrumb } from "@/lib/observability/sentry";
import {
  CircuitBreaker,
  CircuitOpenError,
} from "@/lib/resilience/circuit-breaker";

const supabaseCircuit = new CircuitBreaker({
  name: "supabase-auth",
  failureThreshold: Number(process.env.NULLSPEND_CB_FAILURE_THRESHOLD) || 5,
  resetTimeoutMs: Number(process.env.NULLSPEND_CB_RESET_TIMEOUT_MS) || 30_000,
  requestTimeoutMs: 5_000,
});

/** @internal Expose circuit breaker for testing only. */
export const _supabaseCircuitForTesting = supabaseCircuit;

function canUseDevelopmentFallback(): boolean {
  return process.env.NULLSPEND_DEV_MODE === "true";
}

export function getDevActor(): string | undefined {
  return process.env.NULLSPEND_DEV_ACTOR;
}

export async function getCurrentUserId(): Promise<string | null> {
  // createServerSupabaseClient() may throw SupabaseEnvError (missing env vars).
  // This is a config error that will never self-heal, so it must NOT trip the
  // circuit breaker. Only the actual auth call goes inside the circuit.
  const supabase = await createServerSupabaseClient();

  return supabaseCircuit.call(async () => {
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error) {
      throw new AuthenticationRequiredError(error.message);
    }

    return user?.id ?? null;
  });
}

function tryDevFallback(warn?: boolean): string | undefined {
  if (!canUseDevelopmentFallback()) return undefined;
  const devActor = getDevActor();
  if (!devActor) return undefined;
  if (warn) {
    console.warn(
      "[NullSpend] Using NULLSPEND_DEV_ACTOR fallback — do not use in production.",
    );
  }
  return devActor;
}

async function resolveUserId(options?: {
  warnOnFallback?: boolean;
  errorMessage?: string;
}): Promise<string> {
  try {
    const userId = await getCurrentUserId();
    if (userId) {
      setRequestUserId(userId);
      addSentryBreadcrumb("auth", "Session authenticated", { userId });
      return userId;
    }
  } catch (error) {
    // Fall back to dev actor for missing Supabase config, auth failures, and circuit breaker open.
    if (
      error instanceof SupabaseEnvError ||
      error instanceof AuthenticationRequiredError ||
      error instanceof CircuitOpenError
    ) {
      const fallback = tryDevFallback(options?.warnOnFallback);
      if (fallback) {
        setRequestUserId(fallback);
        addSentryBreadcrumb("auth", "Dev fallback authenticated", { userId: fallback });
        return fallback;
      }
    }
    throw error;
  }

  const fallback = tryDevFallback(options?.warnOnFallback);
  if (fallback) {
    setRequestUserId(fallback);
    addSentryBreadcrumb("auth", "Dev fallback authenticated", { userId: fallback });
    return fallback;
  }

  throw new AuthenticationRequiredError(
    options?.errorMessage ?? "A valid session is required.",
  );
}

export async function assertSession(): Promise<void> {
  await resolveUserId();
}

export async function resolveSessionUserId(): Promise<string> {
  return resolveUserId();
}

export async function resolveApprovalActor(): Promise<string> {
  return resolveUserId({
    warnOnFallback: true,
    errorMessage: "Approval requires an authenticated Supabase user.",
  });
}

export async function resolveSessionContext(): Promise<{ userId: string }> {
  return { userId: await resolveUserId({ warnOnFallback: true }) };
}
