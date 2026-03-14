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
  ForbiddenError,
  SupabaseEnvError,
} from "@/lib/auth/errors";

class InvalidJsonBodyError extends Error {
  constructor() {
    super("Request body must be valid JSON.");
    this.name = "InvalidJsonBodyError";
  }
}

class PayloadTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes.`);
    this.name = "PayloadTooLargeError";
  }
}

const DEFAULT_MAX_BODY_BYTES = 1_048_576; // 1MB

export async function readJsonBody(
  request: Request,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    throw new PayloadTooLargeError(maxBytes);
  }

  const rawBody = await request.text();

  if (new TextEncoder().encode(rawBody).byteLength > maxBytes) {
    throw new PayloadTooLargeError(maxBytes);
  }

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

  if (error instanceof PayloadTooLargeError) {
    return NextResponse.json({ error: error.message }, { status: 413 });
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: "Request validation failed.",
        issues: error.issues.map((i) => ({ path: i.path, message: i.message })),
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
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  if (error instanceof AuthenticationRequiredError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  if (error instanceof SupabaseEnvError) {
    console.error("[NullSpend] Supabase configuration error:", error.message);
    return NextResponse.json(
      { error: "Server configuration error." },
      { status: 500 },
    );
  }

  console.error("[NullSpend] Unhandled route error:", error);
  return NextResponse.json(
    { error: "Internal server error." },
    { status: 500 },
  );
}
