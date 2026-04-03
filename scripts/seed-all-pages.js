/* eslint-disable @typescript-eslint/no-require-imports */
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { prepare: false });

const userId = "edbb20db-261f-450d-83a1-ce191950373d";
const orgId = "052f5cc2-63e6-41db-ace7-ea20364851ab";

async function main() {
  const keys = await sql`SELECT id, name FROM api_keys WHERE user_id = ${userId} AND revoked_at IS NULL ORDER BY created_at`;
  console.log("Keys: " + keys.map((k) => k.name).join(", "));

  // ── 1. SESSIONS: Add session_ids to existing cost_events ──
  const sessionIds = [
    "ses_support_conv_1",
    "ses_support_conv_2",
    "ses_code_review_pr_47",
    "ses_code_review_pr_51",
    "ses_pipeline_nightly",
    "ses_pipeline_backfill",
  ];
  const events = await sql`SELECT id FROM cost_events WHERE user_id = ${userId} AND org_id = ${orgId} ORDER BY created_at DESC`;
  console.log("Total cost events: " + events.length);

  let sessionUpdated = 0;
  for (let i = 0; i < events.length; i++) {
    if (Math.random() < 0.6) {
      const sid = sessionIds[Math.floor(Math.random() * sessionIds.length)];
      await sql`UPDATE cost_events SET session_id = ${sid} WHERE id = ${events[i].id}`;
      sessionUpdated++;
    }
  }
  console.log("Updated " + sessionUpdated + " cost events with session_id");

  // Backfill sessions table (trigger only fires on INSERT, not UPDATE)
  await sql`
    INSERT INTO sessions (org_id, session_id, event_count, total_cost_microdollars, total_input_tokens, total_output_tokens, total_duration_ms, first_event_at, last_event_at)
    SELECT
      org_id, session_id,
      count(*)::int,
      coalesce(sum(cost_microdollars), 0)::bigint,
      coalesce(sum(input_tokens), 0)::bigint,
      coalesce(sum(output_tokens), 0)::bigint,
      coalesce(sum(duration_ms), 0)::bigint,
      min(created_at), max(created_at)
    FROM cost_events
    WHERE org_id = ${orgId} AND session_id IS NOT NULL
    GROUP BY org_id, session_id
    ON CONFLICT (org_id, session_id) DO UPDATE SET
      event_count = EXCLUDED.event_count,
      total_cost_microdollars = EXCLUDED.total_cost_microdollars,
      total_input_tokens = EXCLUDED.total_input_tokens,
      total_output_tokens = EXCLUDED.total_output_tokens,
      total_duration_ms = EXCLUDED.total_duration_ms,
      first_event_at = EXCLUDED.first_event_at,
      last_event_at = EXCLUDED.last_event_at,
      updated_at = NOW()
  `;
  const sesCount = await sql`SELECT count(*)::int as n FROM sessions WHERE org_id = ${orgId}`;
  console.log("Sessions materialized: " + sesCount[0].n);

  // ── 2. TOOL COSTS ──
  const tools = [
    { server: "weather-service", tool: "get_forecast", cost: 5000 },
    { server: "weather-service", tool: "get_alerts", cost: 3000 },
    { server: "database-mcp", tool: "run_query", cost: 15000 },
    { server: "database-mcp", tool: "list_tables", cost: 2000 },
    { server: "slack-mcp", tool: "send_message", cost: 1000 },
    { server: "slack-mcp", tool: "search_messages", cost: 8000 },
    { server: "github-mcp", tool: "create_issue", cost: 5000 },
    { server: "github-mcp", tool: "list_pull_requests", cost: 3000 },
  ];
  for (const t of tools) {
    await sql`INSERT INTO tool_costs (user_id, org_id, server_name, tool_name, cost_microdollars, source)
              VALUES (${userId}, ${orgId}, ${t.server}, ${t.tool}, ${t.cost}, 'discovered')
              ON CONFLICT (user_id, server_name, tool_name) DO UPDATE SET
              cost_microdollars = ${t.cost}, updated_at = NOW()`;
  }
  console.log("Seeded " + tools.length + " tool costs");

  // ── 3. INBOX: Pending actions ──
  const pending = [
    {
      agentId: "support-bot",
      type: "send_email",
      payload: { to: "customer@acme.com", subject: "Your ticket #4521 update", body: "We have resolved your issue regarding the billing discrepancy..." },
      meta: { environment: "production", sourceFramework: "claude-agent" },
      expiresMin: 60,
    },
    {
      agentId: "support-bot",
      type: "http_post",
      payload: { url: "https://api.intercom.io/conversations/reply", body: { message: "Escalating to engineering team" } },
      meta: { environment: "production" },
      expiresMin: 30,
    },
    {
      agentId: "data-pipeline",
      type: "db_write",
      payload: { table: "customer_segments", operation: "INSERT", rows: 247 },
      meta: { environment: "production", sourceFramework: "custom" },
      expiresMin: 120,
    },
  ];
  for (const a of pending) {
    const expiresAt = new Date(Date.now() + a.expiresMin * 60000);
    await sql`INSERT INTO actions (owner_user_id, org_id, agent_id, action_type, status, payload_json, metadata_json, expires_at)
              VALUES (${userId}, ${orgId}, ${a.agentId}, ${a.type}, 'pending', ${JSON.stringify(a.payload)}, ${JSON.stringify(a.meta)}, ${expiresAt})`;
  }
  console.log("Seeded " + pending.length + " pending actions (Inbox)");

  // ── 4. HISTORY: Completed actions ──
  const history = [
    { agentId: "code-review-agent", type: "http_post", status: "executed", payload: { url: "https://api.github.com/repos/acme/app/pulls/47/reviews", body: { event: "APPROVE" } }, daysAgo: 1 },
    { agentId: "code-review-agent", type: "http_post", status: "rejected", payload: { url: "https://api.github.com/repos/acme/app/pulls/51/reviews", body: { event: "REQUEST_CHANGES" } }, daysAgo: 2 },
    { agentId: "support-bot", type: "send_email", status: "executed", payload: { to: "vip@bigcorp.com", subject: "Account review complete" }, daysAgo: 3 },
    { agentId: "support-bot", type: "send_email", status: "approved", payload: { to: "team@startup.io", subject: "Welcome aboard!" }, daysAgo: 4 },
    { agentId: "data-pipeline", type: "db_write", status: "failed", payload: { table: "analytics_rollup", operation: "MERGE", rows: 15000 }, daysAgo: 5 },
    { agentId: "data-pipeline", type: "shell_command", status: "executed", payload: { command: "python etl/nightly_summary.py --date=2026-03-25" }, daysAgo: 3 },
    { agentId: "support-bot", type: "http_post", status: "expired", payload: { url: "https://hooks.slack.com/services/T0/B0/xxx", body: { text: "Escalation timeout" } }, daysAgo: 6 },
  ];
  for (const a of history) {
    const createdAt = new Date(Date.now() - a.daysAgo * 86400000);
    const approvedAt = (a.status === "approved" || a.status === "executed") ? new Date(createdAt.getTime() + 300000) : null;
    const rejectedAt = a.status === "rejected" ? new Date(createdAt.getTime() + 600000) : null;
    const executedAt = a.status === "executed" ? new Date(createdAt.getTime() + 360000) : null;
    const failedAt = a.status === "failed" ? new Date(createdAt.getTime() + 120000) : null;
    await sql`INSERT INTO actions (owner_user_id, org_id, agent_id, action_type, status, payload_json, metadata_json, created_at, approved_at, rejected_at, executed_at, failed_at)
              VALUES (${userId}, ${orgId}, ${a.agentId}, ${a.type}, ${a.status}, ${JSON.stringify(a.payload)}, ${JSON.stringify(a.meta || {})}, ${createdAt}, ${approvedAt}, ${rejectedAt}, ${executedAt}, ${failedAt})`;
  }
  console.log("Seeded " + history.length + " completed actions (History)");

  console.log("\nDone. All 4 pages should now have data.");
  await sql.end();
}
main().catch((e) => { console.error("Error:", e.message); sql.end(); });
