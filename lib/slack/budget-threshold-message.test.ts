import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetDb = vi.fn();
vi.mock("@/lib/db/client", () => ({ getDb: () => mockGetDb() }));
vi.mock("@nullspend/db", () => ({
  slackConfigs: "slackConfigs",
}));

import { buildBudgetThresholdMessage, dispatchBudgetThresholdSlackAlert } from "./budget-threshold-message";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

describe("buildBudgetThresholdMessage", () => {
  const baseData = {
    eventType: "budget.threshold.warning",
    entityType: "customer",
    entityId: "acme-corp",
    thresholdPercent: 80,
    spendMicrodollars: 80_000_000,
    limitMicrodollars: 100_000_000,
  };

  it("builds warning message with correct structure", () => {
    const msg = buildBudgetThresholdMessage(baseData);
    expect(msg.text).toContain("Warning Threshold");
    expect(msg.text).toContain("acme-corp");
    expect(msg.text).toContain("80%");
    expect(msg.text).toContain("$80.00/$100.00");
    expect(msg.blocks).toHaveLength(5); // header, entity+severity, spend+limit, threshold+usage, actions
    expect(msg.blocks[0].type).toBe("header");
    expect(msg.blocks[4].type).toBe("actions");
  });

  it("builds critical message", () => {
    const msg = buildBudgetThresholdMessage({
      ...baseData,
      eventType: "budget.threshold.critical",
      thresholdPercent: 95,
      spendMicrodollars: 95_000_000,
    });
    expect(msg.text).toContain("Critical Threshold");
    expect(msg.text).toContain(":red_circle:");
  });

  it("builds exceeded message", () => {
    const msg = buildBudgetThresholdMessage({
      ...baseData,
      eventType: "budget.exceeded",
      thresholdPercent: 100,
      spendMicrodollars: 105_000_000,
    });
    expect(msg.text).toContain("Budget Exceeded");
    expect(msg.text).toContain(":rotating_light:");
    expect(msg.text).toContain("100%+");
  });

  it("escapes entity ID for mrkdwn injection defense", () => {
    const msg = buildBudgetThresholdMessage({
      ...baseData,
      entityId: "<script>alert(1)</script> & @here",
    });
    const entityBlock = msg.blocks[1] as unknown as { fields: { text: string }[] };
    expect(entityBlock.fields[0].text).toContain("&lt;script&gt;");
    expect(entityBlock.fields[0].text).toContain("&amp;");
    expect(entityBlock.fields[0].text).not.toContain("<script>");
  });

  it("formats spend and limit as dollars", () => {
    const msg = buildBudgetThresholdMessage(baseData);
    const moneyBlock = msg.blocks[2] as unknown as { fields: { text: string }[] };
    expect(moneyBlock.fields[0].text).toContain("$80.00");
    expect(moneyBlock.fields[1].text).toContain("$100.00");
  });

  it("calculates usage percent from spend/limit", () => {
    const msg = buildBudgetThresholdMessage(baseData);
    const thresholdBlock = msg.blocks[3] as unknown as { fields: { text: string }[] };
    expect(thresholdBlock.fields[1].text).toContain("80%");
  });

  it("caps usage display at 999%", () => {
    const msg = buildBudgetThresholdMessage({
      ...baseData,
      spendMicrodollars: 20_000_000_000, // 200x limit
      limitMicrodollars: 1_000_000,
    });
    const thresholdBlock = msg.blocks[3] as unknown as { fields: { text: string }[] };
    expect(thresholdBlock.fields[1].text).toContain("999%");
  });

  it("includes dashboard budgets link", () => {
    const msg = buildBudgetThresholdMessage(baseData);
    const actions = msg.blocks[4] as unknown as { elements: { url: string }[] };
    expect(actions.elements[0].url).toContain("/app/budgets");
  });

  it("handles user entity type", () => {
    const msg = buildBudgetThresholdMessage({
      ...baseData,
      entityType: "user",
      entityId: "usr_123",
    });
    expect(msg.text).toContain("user/usr_123");
  });

  it("handles tag entity type", () => {
    const msg = buildBudgetThresholdMessage({
      ...baseData,
      entityType: "tag",
      entityId: "team=backend",
    });
    expect(msg.text).toContain("tag/team=backend");
  });

  it("handles zero limitMicrodollars without NaN/Infinity", () => {
    const msg = buildBudgetThresholdMessage({
      ...baseData,
      limitMicrodollars: 0,
      spendMicrodollars: 50_000,
    });
    const thresholdBlock = msg.blocks[3] as unknown as { fields: { text: string }[] };
    expect(thresholdBlock.fields[1].text).toContain("0%");
    expect(thresholdBlock.fields[1].text).not.toContain("NaN");
    expect(thresholdBlock.fields[1].text).not.toContain("Infinity");
  });

  it("budget.exceeded event shows 100%+ instead of threshold percent", () => {
    const msg = buildBudgetThresholdMessage({
      ...baseData,
      eventType: "budget.exceeded",
      thresholdPercent: 0, // budget.exceeded events have no threshold_percent field
      spendMicrodollars: 120_000_000,
      limitMicrodollars: 100_000_000,
    });
    const thresholdBlock = msg.blocks[3] as unknown as { fields: { text: string }[] };
    // Should say "100%+" not "0%" — the exceeded path uses a hardcoded label
    expect(thresholdBlock.fields[0].text).toBe("*Threshold:*\n100%+");
  });

  it("escapes entityType for mrkdwn injection defense", () => {
    const msg = buildBudgetThresholdMessage({
      ...baseData,
      entityType: "<b>injected</b>",
    });
    const entityBlock = msg.blocks[1] as unknown as { fields: { text: string }[] };
    expect(entityBlock.fields[0].text).toContain("&lt;b&gt;injected&lt;/b&gt;");
    expect(entityBlock.fields[0].text).not.toContain("<b>");
  });
});

describe("dispatchBudgetThresholdSlackAlert", () => {
  const message = { text: "test", blocks: [] };

  function mockSlackConfig(config: Record<string, unknown> | null) {
    mockGetDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => Promise.resolve(config ? [config] : []),
            }),
          }),
        }),
      }),
    });
  }

  it("sends to webhook when Slack config exists", async () => {
    mockSlackConfig({ orgId: "org-1", isActive: true, webhookUrl: "https://hooks.slack.com/test" });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    await dispatchBudgetThresholdSlackAlert("org-1", message);
    expect(fetch).toHaveBeenCalledWith(
      "https://hooks.slack.com/test",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("skips silently when no Slack config", async () => {
    mockSlackConfig(null);

    await dispatchBudgetThresholdSlackAlert("org-1", message);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("skips silently when config is inactive", async () => {
    mockSlackConfig({ orgId: "org-1", isActive: false, webhookUrl: "https://hooks.slack.com/test" });

    await dispatchBudgetThresholdSlackAlert("org-1", message);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("skips silently when webhookUrl is missing", async () => {
    mockSlackConfig({ orgId: "org-1", isActive: true, webhookUrl: null });

    await dispatchBudgetThresholdSlackAlert("org-1", message);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("logs warning on webhook failure but does not throw", async () => {
    mockSlackConfig({ orgId: "org-1", isActive: true, webhookUrl: "https://hooks.slack.com/test" });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });

    await expect(dispatchBudgetThresholdSlackAlert("org-1", message)).resolves.toBeUndefined();
  });

  it("rejects non-HTTPS webhook URLs (SSRF defense)", async () => {
    mockSlackConfig({ orgId: "org-1", isActive: true, webhookUrl: "http://169.254.169.254/latest/meta-data/" });

    await dispatchBudgetThresholdSlackAlert("org-1", message);
    expect(fetch).not.toHaveBeenCalled();
  });
});
