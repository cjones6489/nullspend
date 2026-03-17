import { API_KEY_HEADER } from "@/lib/auth/api-key";
import { authenticateApiKey } from "@/lib/auth/with-api-key-auth";
import { resolveSessionUserId } from "@/lib/auth/session";

export async function assertApiKeyOrSession(
  request: Request,
): Promise<string | Response> {
  if (request.headers.has(API_KEY_HEADER)) {
    const result = await authenticateApiKey(request);
    if (result instanceof Response) return result; // 429
    return result.userId;
  }
  return resolveSessionUserId();
}
