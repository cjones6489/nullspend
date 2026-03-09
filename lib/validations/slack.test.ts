import { describe, expect, it } from "vitest";

import { slackConfigInputSchema, slackConfigRecordSchema } from "./slack";

describe("slackConfigInputSchema", () => {
  it("accepts a valid Slack webhook URL", () => {
    const result = slackConfigInputSchema.safeParse({
      webhookUrl: "https://hooks.slack.com/services/T00/B00/xxxx",
    });
    expect(result.success).toBe(true);
  });

  it("accepts webhook URL with optional channel name", () => {
    const result = slackConfigInputSchema.safeParse({
      webhookUrl: "https://hooks.slack.com/services/T00/B00/xxxx",
      channelName: "#agent-alerts",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-Slack webhook URL", () => {
    const result = slackConfigInputSchema.safeParse({
      webhookUrl: "https://example.com/webhook",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an HTTP (non-HTTPS) URL", () => {
    const result = slackConfigInputSchema.safeParse({
      webhookUrl: "http://hooks.slack.com/services/T00/B00/xxxx",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-URL string", () => {
    const result = slackConfigInputSchema.safeParse({
      webhookUrl: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty webhook URL", () => {
    const result = slackConfigInputSchema.safeParse({
      webhookUrl: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing webhook URL", () => {
    const result = slackConfigInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("trims channel name whitespace", () => {
    const result = slackConfigInputSchema.safeParse({
      webhookUrl: "https://hooks.slack.com/services/T00/B00/xxxx",
      channelName: "  #alerts  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.channelName).toBe("#alerts");
    }
  });

  it("rejects channel name longer than 80 characters", () => {
    const result = slackConfigInputSchema.safeParse({
      webhookUrl: "https://hooks.slack.com/services/T00/B00/xxxx",
      channelName: "x".repeat(81),
    });
    expect(result.success).toBe(false);
  });

  it("accepts channel name exactly 80 characters", () => {
    const result = slackConfigInputSchema.safeParse({
      webhookUrl: "https://hooks.slack.com/services/T00/B00/xxxx",
      channelName: "x".repeat(80),
    });
    expect(result.success).toBe(true);
  });

  it("treats channelName as optional (absent is ok)", () => {
    const result = slackConfigInputSchema.safeParse({
      webhookUrl: "https://hooks.slack.com/services/T00/B00/xxxx",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.channelName).toBeUndefined();
    }
  });

  it("accepts isActive as true", () => {
    const result = slackConfigInputSchema.safeParse({
      webhookUrl: "https://hooks.slack.com/services/T00/B00/xxxx",
      isActive: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isActive).toBe(true);
    }
  });

  it("accepts isActive as false", () => {
    const result = slackConfigInputSchema.safeParse({
      webhookUrl: "https://hooks.slack.com/services/T00/B00/xxxx",
      isActive: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isActive).toBe(false);
    }
  });

  it("treats isActive as optional (absent is ok)", () => {
    const result = slackConfigInputSchema.safeParse({
      webhookUrl: "https://hooks.slack.com/services/T00/B00/xxxx",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isActive).toBeUndefined();
    }
  });

  it("rejects non-boolean isActive", () => {
    const result = slackConfigInputSchema.safeParse({
      webhookUrl: "https://hooks.slack.com/services/T00/B00/xxxx",
      isActive: "yes",
    });
    expect(result.success).toBe(false);
  });
});

describe("slackConfigRecordSchema", () => {
  it("parses a valid record", () => {
    const result = slackConfigRecordSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      webhookUrl: "https://hooks.slack.com/services/T00/B00/xxxx",
      channelName: "#alerts",
      isActive: true,
      createdAt: "2026-03-07T12:00:00.000Z",
      updatedAt: "2026-03-07T12:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("allows null channelName", () => {
    const result = slackConfigRecordSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      webhookUrl: "https://hooks.slack.com/services/T00/B00/xxxx",
      channelName: null,
      isActive: false,
      createdAt: "2026-03-07T12:00:00.000Z",
      updatedAt: "2026-03-07T12:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid UUID", () => {
    const result = slackConfigRecordSchema.safeParse({
      id: "not-a-uuid",
      webhookUrl: "https://hooks.slack.com/services/T00/B00/xxxx",
      channelName: null,
      isActive: true,
      createdAt: "2026-03-07T12:00:00.000Z",
      updatedAt: "2026-03-07T12:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});
