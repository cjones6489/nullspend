import {
  API_KEY_HEADER,
  assertApiKeyWithIdentity,
  resolveDevFallbackApiKeyUserId,
} from "@/lib/auth/api-key";
import { resolveSessionUserId } from "@/lib/auth/session";

export async function assertApiKeyOrSession(request: Request): Promise<string> {
  if (request.headers.has(API_KEY_HEADER)) {
    const identity = await assertApiKeyWithIdentity(request);
    return identity?.userId ?? resolveDevFallbackApiKeyUserId();
  }

  return resolveSessionUserId();
}
