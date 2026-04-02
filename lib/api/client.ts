const DEFAULT_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    // Redirect to login on auth failure — session likely expired
    if (response.status === 401 && typeof window !== "undefined") {
      window.location.href = "/login";
      // Return a never-resolving promise so callers don't process further
      return new Promise(() => {});
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    // API error format: { error: { code, message, details } }
    const err = body && typeof body === "object" && "error" in body
      ? (body as { error: unknown }).error
      : null;
    const code =
      err && typeof err === "object" && err !== null && "code" in err
        ? String((err as { code: string }).code)
        : undefined;
    const message =
      err && typeof err === "object" && err !== null && "message" in err
        ? String((err as { message: string }).message)
        : body && typeof body === "object" && "message" in body
          ? String((body as { message: string }).message)
          : `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status, code, body);
  }
  return response.json() as Promise<T>;
}

/** Only retry on server errors (5xx), not on 4xx (not found, bad request). */
export function retryOnServerError(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && error.status < 500) return false;
  return failureCount < 2;
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  return handleResponse<T>(response);
}

export async function apiPost<T>(
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  return handleResponse<T>(response);
}

export async function apiPatch<T>(
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method: "PATCH",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  return handleResponse<T>(response);
}

export async function apiDelete<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    method: "DELETE",
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  return handleResponse<T>(response);
}
