import { describe, it, expect } from "vitest";
import {
  createWebhookInputSchema,
  updateWebhookInputSchema,
  webhookRecordSchema,
} from "./webhooks";

describe("createWebhookInputSchema", () => {
  const validBase = {
    url: "https://hooks.example.com/webhook",
  };

  it("payloadMode defaults to 'full' when omitted", () => {
    const result = createWebhookInputSchema.parse(validBase);
    expect(result.payloadMode).toBe("full");
  });

  it("accepts payloadMode: 'thin'", () => {
    const result = createWebhookInputSchema.parse({
      ...validBase,
      payloadMode: "thin",
    });
    expect(result.payloadMode).toBe("thin");
  });

  it("accepts payloadMode: 'full' explicitly", () => {
    const result = createWebhookInputSchema.parse({
      ...validBase,
      payloadMode: "full",
    });
    expect(result.payloadMode).toBe("full");
  });

  it("rejects invalid payloadMode value", () => {
    const result = createWebhookInputSchema.safeParse({
      ...validBase,
      payloadMode: "verbose",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain("payloadMode");
    }
  });
});

describe("updateWebhookInputSchema", () => {
  it("accepts payloadMode: 'thin'", () => {
    const result = updateWebhookInputSchema.parse({ payloadMode: "thin" });
    expect(result.payloadMode).toBe("thin");
  });

  it("accepts payloadMode: 'full'", () => {
    const result = updateWebhookInputSchema.parse({ payloadMode: "full" });
    expect(result.payloadMode).toBe("full");
  });

  it("payloadMode is optional (omitting it succeeds)", () => {
    const result = updateWebhookInputSchema.parse({});
    expect(result.payloadMode).toBeUndefined();
  });

  it("rejects invalid payloadMode value", () => {
    const result = updateWebhookInputSchema.safeParse({
      payloadMode: "compact",
    });
    expect(result.success).toBe(false);
  });
});

describe("webhookRecordSchema", () => {
  const validRecord = {
    id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    url: "https://hooks.example.com/webhook",
    description: null,
    eventTypes: ["cost_event.created"],
    enabled: true,
    apiVersion: "2026-04-01",
    payloadMode: "full" as const,
    createdAt: "2026-03-01T00:00:00Z",
    updatedAt: "2026-03-01T00:00:00Z",
  };

  it("requires payloadMode field", () => {
    const { payloadMode: _payloadMode, ...missing } = validRecord;
    const result = webhookRecordSchema.safeParse(missing);
    expect(result.success).toBe(false);
  });

  it("accepts payloadMode: 'full'", () => {
    const result = webhookRecordSchema.parse(validRecord);
    expect(result.payloadMode).toBe("full");
  });

  it("accepts payloadMode: 'thin'", () => {
    const result = webhookRecordSchema.parse({
      ...validRecord,
      payloadMode: "thin",
    });
    expect(result.payloadMode).toBe("thin");
  });

  it("rejects invalid payloadMode value", () => {
    const result = webhookRecordSchema.safeParse({
      ...validRecord,
      payloadMode: "minimal",
    });
    expect(result.success).toBe(false);
  });
});
