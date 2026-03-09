import { NextResponse } from "next/server";
import { ZodError } from "zod";

import {
  ActionExpiredError,
  ActionNotFoundError,
  InvalidActionTransitionError,
  StaleActionError,
} from "@/lib/actions/errors";
import { ApiKeyError } from "@/lib/auth/api-key";
import {
  AuthenticationRequiredError,
  SupabaseEnvError,
} from "@/lib/auth/errors";

class InvalidJsonBodyError extends Error {
  constructor() {
    super("Request body must be valid JSON.");
    this.name = "InvalidJsonBodyError";
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  const rawBody = await request.text();

  if (!rawBody.trim()) {
    throw new InvalidJsonBodyError();
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new InvalidJsonBodyError();
  }
}

export async function readRouteParams<T extends Record<string, string>>(
  params: Promise<T> | T,
): Promise<T> {
  return await params;
}

export function handleRouteError(error: unknown) {
  if (error instanceof InvalidJsonBodyError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: "Request validation failed.",
        issues: error.issues,
      },
      { status: 400 },
    );
  }

  if (error instanceof ActionNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  if (error instanceof InvalidActionTransitionError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  if (error instanceof StaleActionError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  if (error instanceof ActionExpiredError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  if (error instanceof ApiKeyError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  if (error instanceof AuthenticationRequiredError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  if (error instanceof SupabaseEnvError) {
    console.error("[AgentSeam] Supabase configuration error:", error.message);
    return NextResponse.json(
      { error: "Server configuration error." },
      { status: 500 },
    );
  }

  console.error("[AgentSeam] Unhandled route error:", error);
  return NextResponse.json(
    { error: "Internal server error." },
    { status: 500 },
  );
}
