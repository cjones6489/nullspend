import { vi } from "vitest";

/**
 * Creates a fake Redis object with all methods that the proxy code may call.
 * Replaces `{} as any` casts so that code paths calling `redis.pipeline().exec()`
 * etc. won't silently get `undefined`.
 */
export function makeFakeRedis(overrides: Record<string, unknown> = {}) {
  const fakePipeline = {
    hgetall: vi.fn().mockReturnThis(),
    get: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    del: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    incrbyfloat: vi.fn().mockReturnThis(),
    eval: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([]),
  };

  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
    hgetall: vi.fn().mockResolvedValue(null),
    eval: vi.fn().mockResolvedValue(null),
    incrbyfloat: vi.fn().mockResolvedValue(0),
    pipeline: vi.fn().mockReturnValue(fakePipeline),
    ...overrides,
  } as any;
}
