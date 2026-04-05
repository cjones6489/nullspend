import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetDb = vi.fn();
vi.mock("@/lib/db/client", () => ({ getDb: () => mockGetDb() }));
vi.mock("@nullspend/db", () => ({
  slackConfigs: "slackConfigs",
}));

import { buildMarginAlertMessage, dispatchMarginSlackAlert } from "./margin-slack-message";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

describe("buildMarginAlertMessage", () => {
  const baseData = {
    customerName: "Acme Corp",
    tagValue: "acme",
    previousMarginPercent: 25,
    currentMarginPercent: -5,
    previousTier: "moderate" as const,
    currentTier: "critical" as const,
    revenueMicrodollars: 100_000_000,
    costMicrodollars: 105_000_000,
    period: "2026-04",
  };

  it("builds message with correct structure", () => {
    const msg = buildMarginAlertMessage(baseData);
    expect(msg.text).toContain("Acme Corp");
    expect(msg.text).toContain("critical");
    expect(msg.blocks).toHaveLength(5); // header, customer+period, tiers, revenue+cost, actions
    expect(msg.blocks[0].type).toBe("header");
    expect(msg.blocks[4].type).toBe("actions");
  });

  it("includes deep link URLs in action buttons", () => {
    const msg = buildMarginAlertMessage(baseData);
    const actions = msg.blocks[4] as unknown as { elements: { url: string }[] };
    expect(actions.elements[0].url).toContain("/app/margins/acme");
    expect(actions.elements[1].url).toContain("/app/budgets/new");
    expect(actions.elements[1].url).toContain("entity=tag:customer=acme");
  });

  it("maps tier to correct emoji", () => {
    const msg = buildMarginAlertMessage(baseData);
    const tierBlock = msg.blocks[2] as unknown as { fields: { text: string }[] };
    expect(tierBlock.fields[0].text).toContain(":large_blue_circle:"); // moderate
    expect(tierBlock.fields[1].text).toContain(":red_circle:"); // critical
  });

  it("falls back to tagValue when customerName is null", () => {
    const msg = buildMarginAlertMessage({ ...baseData, customerName: null });
    expect(msg.text).toContain("acme");
    const customerBlock = msg.blocks[1] as unknown as { fields: { text: string }[] };
    expect(customerBlock.fields[0].text).toContain("acme");
  });

  it("escapes Slack mrkdwn special characters in customer name", () => {
    const msg = buildMarginAlertMessage({
      ...baseData,
      customerName: "Acme <Corp> & Sons",
    });
    const customerBlock = msg.blocks[1] as unknown as { fields: { text: string }[] };
    expect(customerBlock.fields[0].text).toContain("Acme &lt;Corp&gt; &amp; Sons");
  });

  it("formats revenue and cost as dollars", () => {
    const msg = buildMarginAlertMessage(baseData);
    const moneyBlock = msg.blocks[3] as unknown as { fields: { text: string }[] };
    expect(moneyBlock.fields[0].text).toContain("$100.00");
    expect(moneyBlock.fields[1].text).toContain("$105.00");
  });

  it("URL-encodes tagValue with special characters", () => {
    const msg = buildMarginAlertMessage({ ...baseData, tagValue: "acme corp" });
    const actions = msg.blocks[4] as unknown as { elements: { url: string }[] };
    expect(actions.elements[0].url).toContain("/app/margins/acme%20corp");
  });
});

describe("dispatchMarginSlackAlert", () => {
  const message = { text: "test", blocks: [] };

  it("sends to webhook when Slack config exists", async () => {
    mockGetDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{
              orgId: "org-1",
              isActive: true,
              webhookUrl: "https://hooks.slack.com/test",
            }]),
          }),
        }),
      }),
    });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    await dispatchMarginSlackAlert("org-1", message);
    expect(fetch).toHaveBeenCalledWith(
      "https://hooks.slack.com/test",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("skips silently when no Slack config", async () => {
    mockGetDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([]),
          }),
        }),
      }),
    });

    await dispatchMarginSlackAlert("org-1", message);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("skips silently when config is inactive", async () => {
    mockGetDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{
              orgId: "org-1",
              isActive: false,
              webhookUrl: "https://hooks.slack.com/test",
            }]),
          }),
        }),
      }),
    });

    await dispatchMarginSlackAlert("org-1", message);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("logs warning on webhook failure but does not throw", async () => {
    mockGetDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{
              orgId: "org-1",
              isActive: true,
              webhookUrl: "https://hooks.slack.com/test",
            }]),
          }),
        }),
      }),
    });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });

    // Should not throw
    await expect(dispatchMarginSlackAlert("org-1", message)).resolves.toBeUndefined();
  });

  it("rejects non-HTTPS webhook URLs (SSRF defense)", async () => {
    mockGetDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{
              orgId: "org-1",
              isActive: true,
              webhookUrl: "http://169.254.169.254/latest/meta-data/",
            }]),
          }),
        }),
      }),
    });

    await dispatchMarginSlackAlert("org-1", message);
    expect(fetch).not.toHaveBeenCalled();
  });
});
