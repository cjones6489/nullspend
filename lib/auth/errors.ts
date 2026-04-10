export class SupabaseEnvError extends Error {
  constructor(variableName: string) {
    super(`${variableName} is not set.`);
    this.name = "SupabaseEnvError";
  }
}

export class AuthenticationRequiredError extends Error {
  constructor(message = "Authentication is required for this action.") {
    super(message);
    this.name = "AuthenticationRequiredError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Wraps a raw upstream service error (e.g. Supabase AuthApiError 5xx,
 * AuthRetryableFetchError) so that `handleRouteError` can map it to
 * HTTP 503 + Retry-After instead of a generic 500 with Sentry spam.
 *
 * The original error is preserved as `.cause` for logging.
 */
export class UpstreamServiceError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "UpstreamServiceError";
    this.cause = cause;
  }
}
