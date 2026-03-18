import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDel = vi.fn();
const mockGetResilienceRedis = vi.fn();

vi.mock("@/lib/resilience/redis", () => ({
  getResilienceRedis: () => mockGetResilienceRedis(),
}));

import { invalidateWebhookCacheForUser } from "@/lib/webhooks/invalidate-cache";

describe("invalidateWebhookCacheForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls Redis DEL with correct key format", async () => {
    mockGetResilienceRedis.mockReturnValue({ del: mockDel });
    mockDel.mockResolvedValue(1);

    await invalidateWebhookCacheForUser("user-abc-123");

    expect(mockDel).toHaveBeenCalledWith("webhooks:user:user-abc-123");
  });

  it("gracefully handles no Redis configured", async () => {
    mockGetResilienceRedis.mockReturnValue(null);

    await expect(
      invalidateWebhookCacheForUser("user-abc-123"),
    ).resolves.toBeUndefined();

    expect(mockDel).not.toHaveBeenCalled();
  });

  it("logs error but never throws on Redis failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetResilienceRedis.mockReturnValue({
      del: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    });

    await expect(
      invalidateWebhookCacheForUser("user-abc-123"),
    ).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith(
      "[webhook-cache] Dashboard invalidation failed:",
      expect.any(Error),
    );
  });
});
