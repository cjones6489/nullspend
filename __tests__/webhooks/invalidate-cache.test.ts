import { describe, it, expect } from "vitest";

import { invalidateWebhookCacheForUser } from "@/lib/webhooks/invalidate-cache";

describe("invalidateWebhookCacheForUser", () => {
  it("resolves without error (no-op until active KV invalidation is added)", async () => {
    await expect(
      invalidateWebhookCacheForUser("user-abc-123"),
    ).resolves.toBeUndefined();
  });
});
