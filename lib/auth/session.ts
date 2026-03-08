import {
  AuthenticationRequiredError,
  SupabaseEnvError,
} from "@/lib/auth/errors";
import { createServerSupabaseClient } from "@/lib/auth/supabase";

function canUseDevelopmentFallback(): boolean {
  return process.env.NODE_ENV === "development";
}

export function getDevActor(): string | undefined {
  return process.env.AGENTSEAM_DEV_ACTOR;
}

export async function getCurrentUserId(): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error) {
    throw new AuthenticationRequiredError(error.message);
  }

  return (data?.claims?.sub as string) ?? null;
}

export async function assertSession(): Promise<void> {
  try {
    const userId = await getCurrentUserId();

    if (userId) {
      return;
    }
  } catch (error) {
    if (!(error instanceof SupabaseEnvError)) {
      throw error;
    }

    if (canUseDevelopmentFallback() && getDevActor()) {
      return;
    }

    throw error;
  }

  if (canUseDevelopmentFallback() && getDevActor()) {
    return;
  }

  throw new AuthenticationRequiredError(
    "A valid session is required.",
  );
}

export async function resolveSessionUserId(): Promise<string> {
  try {
    const userId = await getCurrentUserId();

    if (userId) {
      return userId;
    }
  } catch (error) {
    if (!(error instanceof SupabaseEnvError)) {
      throw error;
    }

    if (canUseDevelopmentFallback()) {
      const devActor = getDevActor();
      if (devActor) {
        return devActor;
      }
    }

    throw error;
  }

  if (canUseDevelopmentFallback()) {
    const devActor = getDevActor();
    if (devActor) {
      return devActor;
    }
  }

  throw new AuthenticationRequiredError(
    "A valid session is required.",
  );
}

export async function resolveApprovalActor(): Promise<string> {
  try {
    const userId = await getCurrentUserId();

    if (userId) {
      return userId;
    }
  } catch (error) {
    if (!(error instanceof SupabaseEnvError)) {
      throw error;
    }

    if (canUseDevelopmentFallback()) {
      const devActor = getDevActor();
      if (devActor) {
        console.warn(
          "[AgentSeam] Using AGENTSEAM_DEV_ACTOR fallback — do not use in production.",
        );
        return devActor;
      }
    }

    throw error;
  }

  if (canUseDevelopmentFallback()) {
    const devActor = getDevActor();
    if (devActor) {
      console.warn(
        "[AgentSeam] Using AGENTSEAM_DEV_ACTOR fallback — do not use in production.",
      );
      return devActor;
    }
  }

  throw new AuthenticationRequiredError(
    "Approval requires an authenticated Supabase user.",
  );
}
