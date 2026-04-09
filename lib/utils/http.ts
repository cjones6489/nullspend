import { NextResponse } from "next/server";
import { captureExceptionWithContext } from "@/lib/observability/sentry";
import { ZodError } from "zod";

import {
  ActionExpiredError,
  ActionNotFoundError,
  BudgetEntityNotFoundError,
  InvalidActionTransitionError,
  StaleActionError,
} from "@/lib/actions/errors";
import { ApiKeyError } from "@/lib/auth/api-key";
import {
  AuthenticationRequiredError,
  ForbiddenError,
  SupabaseEnvError,
} from "@/lib/auth/errors";
import { getLogger } from "@/lib/observability";
import { CircuitOpenError } from "@/lib/resilience/circuit-breaker";

class InvalidJsonBodyError extends Error {
  constructor() {
    super("Request body must be valid JSON.");
    this.name = "InvalidJsonBodyError";
  }
}

export class LimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LimitExceededError";
  }
}

export class SpendCapExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpendCapExceededError";
  }
}

class PayloadTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes.`);
    this.name = "PayloadTooLargeError";
  }
}

class UnsupportedMediaTypeError extends Error {
  constructor() {
    super("Content-Type must be application/json.");
    this.name = "UnsupportedMediaTypeError";
  }
}

const DEFAULT_MAX_BODY_BYTES = 1_048_576; // 1MB

export async function readJsonBody(
  request: Request,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new UnsupportedMediaTypeError();
  }

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

function errorJson(code: string, message: string, details?: Record<string, unknown> | null) {
  return { error: { code, message, details: details ?? null } };
}

export function handleRouteError(error: unknown) {
  if (error instanceof InvalidJsonBodyError) {
    return NextResponse.json(errorJson("invalid_json", error.message), { status: 400 });
  }

  if (error instanceof UnsupportedMediaTypeError) {
    return NextResponse.json(errorJson("unsupported_media_type", error.message), { status: 415 });
  }

  if (error instanceof PayloadTooLargeError) {
    return NextResponse.json(errorJson("payload_too_large", error.message), { status: 413 });
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      errorJson("validation_error", "Request validation failed.", {
        issues: error.issues.map((i) => ({ path: i.path, message: i.message })),
      }),
      { status: 400 },
    );
  }

  if (error instanceof ActionNotFoundError) {
    return NextResponse.json(errorJson("not_found", error.message), { status: 404 });
  }

  if (error instanceof BudgetEntityNotFoundError) {
    return NextResponse.json(errorJson("budget_entity_not_found", error.message), { status: 404 });
  }

  if (error instanceof InvalidActionTransitionError) {
    return NextResponse.json(errorJson("invalid_action_transition", error.message), { status: 409 });
  }

  if (error instanceof StaleActionError) {
    return NextResponse.json(errorJson("stale_action", error.message), { status: 409 });
  }

  if (error instanceof ActionExpiredError) {
    return NextResponse.json(errorJson("action_expired", error.message), { status: 409 });
  }

  if (error instanceof ApiKeyError) {
    return NextResponse.json(errorJson("authentication_required", error.message), { status: 401 });
  }

  if (error instanceof AuthenticationRequiredError) {
    return NextResponse.json(errorJson("authentication_required", error.message), { status: 401 });
  }

  if (error instanceof ForbiddenError) {
    return NextResponse.json(errorJson("forbidden", error.message), { status: 403 });
  }

  if (error instanceof LimitExceededError) {
    return NextResponse.json(errorJson("limit_exceeded", error.message), { status: 409 });
  }

  if (error instanceof SpendCapExceededError) {
    return NextResponse.json(errorJson("spend_cap_exceeded", error.message), { status: 400 });
  }

  if (error instanceof CircuitOpenError) {
    getLogger("http").warn({ err: error }, "Circuit breaker open — returning 503");
    return NextResponse.json(
      errorJson("service_unavailable", "Service temporarily unavailable."),
      { status: 503, headers: { "Retry-After": "30" } },
    );
  }

  if (error instanceof SupabaseEnvError) {
    getLogger("http").error({ err: error }, "Supabase configuration error");
    return NextResponse.json(
      errorJson("server_error", "Server configuration error."),
      { status: 500 },
    );
  }

  getLogger("http").error({ err: error }, "Unhandled route error");
  captureExceptionWithContext(error);

  // Temporary P0-E diagnostic: expose error detail in response when the
  // internal debug secret header is present. Gated on INTERNAL_SECRET so
  // it cannot be triggered from public traffic. REMOVE AFTER P0-E TRIAGE.
  const debugDetail = extractErrorForDebug(error);

  return NextResponse.json(
    errorJson("internal_error", "Internal server error.", debugDetail),
    { status: 500 },
  );
}

/**
 * TEMPORARY: P0-E diagnostic that surfaces the underlying error shape
 * directly in the 500 response body. Called unconditionally by
 * handleRouteError — leaks stack + pg error codes to any caller that
 * triggers a 500. ACCEPTABLE FOR LAUNCH-NIGHT TRIAGE ONLY.
 *
 * REMOVE THIS once P0-E is root-caused and fixed. Tracked in task #17.
 */
function extractErrorForDebug(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) {
    return { debug: { raw: String(err) } };
  }
  const e = err as Error & {
    code?: string;
    severity?: string;
    detail?: string;
    hint?: string;
    routine?: string;
    address?: string;
    port?: number;
    syscall?: string;
    errno?: number;
    cause?: unknown;
  };
  const info: Record<string, unknown> = {
    name: e.name,
    message: e.message?.substring(0, 500),
    stack: e.stack?.substring(0, 1500),
  };
  if (e.code) info.code = e.code;
  if (e.severity) info.severity = e.severity;
  if (e.detail) info.detail = e.detail;
  if (e.hint) info.hint = e.hint;
  if (e.routine) info.routine = e.routine;
  if (e.address) info.address = e.address;
  if (e.port) info.port = e.port;
  if (e.syscall) info.syscall = e.syscall;
  if (e.errno) info.errno = e.errno;
  if (e.cause) info.cause = extractErrorForDebug(e.cause);
  return { debug: info };
}
