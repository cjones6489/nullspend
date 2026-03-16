export interface NullSpendError {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}

export function errorResponse(
  error: string,
  message: string,
  status: number,
  details?: Record<string, unknown>,
): Response {
  const body: NullSpendError = { error, message };
  if (details) body.details = details;
  return Response.json(body, { status });
}
