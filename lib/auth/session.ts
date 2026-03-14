import {
  AuthenticationRequiredError,
  SupabaseEnvError,
} from "@/lib/auth/errors";
import { createServerSupabaseClient } from "@/lib/auth/supabase";

function canUseDevelopmentFallback(): boolean {
  return process.env.NULLSPEND_DEV_MODE === "true";
}

export function getDevActor(): string | undefined {
  return process.env.NULLSPEND_DEV_ACTOR;
}

export async function getCurrentUserId(): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error) {
    throw new AuthenticationRequiredError(error.message);
  }

  return user?.id ?? null;
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
    if (userId) return userId;
  } catch (error) {
    if (!(error instanceof SupabaseEnvError)) throw error;
    const fallback = tryDevFallback(options?.warnOnFallback);
    if (fallback) return fallback;
    throw error;
  }

  const fallback = tryDevFallback(options?.warnOnFallback);
  if (fallback) return fallback;

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
