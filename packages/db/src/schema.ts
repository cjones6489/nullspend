import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const ACTION_TYPES = [
  "send_email",
  "http_post",
  "http_delete",
  "shell_command",
  "db_write",
  "file_write",
  "file_delete",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

export const ACTION_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "executing",
  "executed",
  "failed",
] as const;

export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  orgId: uuid("org_id"),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  apiVersion: text("api_version").notNull().default("2026-04-01"),
  environment: text("environment").notNull().default("live"),
  defaultTags: jsonb("default_tags").$type<Record<string, string>>().notNull().default(sql`'{}'`),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("api_keys_key_hash_idx").on(table.keyHash),
  index("api_keys_user_id_idx").on(table.userId),
]);

export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type NewApiKeyRow = typeof apiKeys.$inferInsert;

export const actions = pgTable("actions", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerUserId: text("owner_user_id").notNull(),
  orgId: uuid("org_id"),
  agentId: text("agent_id").notNull(),
  actionType: text("action_type").$type<ActionType>().notNull(),
  status: text("status").$type<ActionStatus>().notNull().default("pending"),
  payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull(),
  metadataJson: jsonb("metadata_json").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  executedAt: timestamp("executed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  expiredAt: timestamp("expired_at", { withTimezone: true }),
  approvedBy: text("approved_by"),
  rejectedBy: text("rejected_by"),
  resultJson: jsonb("result_json").$type<Record<string, unknown> | null>(),
  errorMessage: text("error_message"),
  environment: text("environment"),
  sourceFramework: text("source_framework"),
}, (table) => [
  index("actions_owner_status_created_idx").on(table.ownerUserId, table.status, table.createdAt),
  index("actions_owner_created_idx").on(table.ownerUserId, table.createdAt),
]);

export type ActionRow = typeof actions.$inferSelect;
export type NewActionRow = typeof actions.$inferInsert;

export const slackConfigs = pgTable("slack_configs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull().unique(),
  orgId: uuid("org_id"),
  webhookUrl: text("webhook_url").notNull(),
  channelName: text("channel_name"),
  slackUserId: text("slack_user_id"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SlackConfigRow = typeof slackConfigs.$inferSelect;

export const budgets = pgTable("budgets", {
  id: uuid("id").defaultRandom().primaryKey(),
  entityType: text("entity_type").$type<"user" | "agent" | "api_key" | "team" | "tag">().notNull(),
  entityId: text("entity_id").notNull(),
  maxBudgetMicrodollars: bigint("max_budget_microdollars", { mode: "number" }).notNull(),
  spendMicrodollars: bigint("spend_microdollars", { mode: "number" }).notNull().default(0),
  policy: text("policy").$type<"strict_block" | "soft_block" | "warn">().notNull().default("strict_block"),
  resetInterval: text("reset_interval").$type<"daily" | "weekly" | "monthly" | "yearly" | null>(),
  thresholdPercentages: integer("threshold_percentages").array().notNull().default([50, 80, 90, 95]),
  velocityLimitMicrodollars: bigint("velocity_limit_microdollars", { mode: "number" }),
  velocityWindowSeconds: integer("velocity_window_seconds").default(60),
  velocityCooldownSeconds: integer("velocity_cooldown_seconds").default(60),
  sessionLimitMicrodollars: bigint("session_limit_microdollars", { mode: "number" }),
  userId: text("user_id").notNull(),
  orgId: uuid("org_id"),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("budgets_user_entity_idx").on(table.userId, table.entityType, table.entityId),
  index("budgets_user_id_idx").on(table.userId),
]);

export type BudgetRow = typeof budgets.$inferSelect;
export type NewBudgetRow = typeof budgets.$inferInsert;

export const costEvents = pgTable("cost_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  requestId: text("request_id").notNull(),
  apiKeyId: uuid("api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
  userId: text("user_id").notNull(),
  orgId: uuid("org_id"),
  parentRequestId: text("parent_request_id"),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
  reasoningTokens: integer("reasoning_tokens").notNull().default(0),
  costMicrodollars: bigint("cost_microdollars", { mode: "number" }).notNull(),
  durationMs: integer("duration_ms"),
  actionId: uuid("action_id").references(() => actions.id, { onDelete: "set null" }),
  eventType: text("event_type").$type<"llm" | "tool" | "custom">().notNull().default("llm"),
  toolName: text("tool_name"),
  toolServer: text("tool_server"),
  toolCallsRequested: jsonb("tool_calls_requested").$type<{ name: string; id: string }[] | null>(),
  toolDefinitionTokens: integer("tool_definition_tokens").default(0),
  upstreamDurationMs: integer("upstream_duration_ms"),
  sessionId: text("session_id"),
  traceId: text("trace_id"),
  source: text("source").$type<CostEventSource>().notNull().default("proxy"),
  costBreakdown: jsonb("cost_breakdown").$type<{ input?: number; output?: number; cached?: number; reasoning?: number; toolDefinition?: number } | null>(),
  tags: jsonb("tags").$type<Record<string, string>>().notNull().default(sql`'{}'`),
  budgetStatus: text("budget_status").$type<"skipped" | "approved" | "denied">(),
  stopReason: text("stop_reason"),
  estimatedCostMicrodollars: bigint("estimated_cost_microdollars", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("cost_events_request_id_provider_idx").on(table.requestId, table.provider),
  index("cost_events_user_id_created_at_idx").on(table.userId, table.createdAt),
  index("cost_events_api_key_id_created_at_idx").on(table.apiKeyId, table.createdAt),
  index("cost_events_provider_model_created_at_idx").on(table.provider, table.model, table.createdAt),
  index("cost_events_action_id_idx").on(table.actionId),
  index("cost_events_event_type_idx").on(table.eventType),
  index("cost_events_session_id_idx").on(table.sessionId),
  index("cost_events_trace_id_idx").on(table.traceId).where(sql`trace_id IS NOT NULL`),
  index("cost_events_tags_idx").using("gin", table.tags),
]);

export type CostEventRow = typeof costEvents.$inferSelect;
export type NewCostEventRow = typeof costEvents.$inferInsert;

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull().unique(),
  orgId: uuid("org_id"),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  stripeSubscriptionId: text("stripe_subscription_id").notNull(),
  tier: text("tier").notNull(),
  status: text("status").notNull(),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("subscriptions_stripe_customer_id_idx").on(table.stripeCustomerId),
]);

export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type NewSubscriptionRow = typeof subscriptions.$inferInsert;

export const COST_EVENT_SOURCES = ["proxy", "api", "mcp"] as const;
export type CostEventSource = (typeof COST_EVENT_SOURCES)[number];

export const TOOL_COST_SOURCES = ["discovered", "manual"] as const;

export type ToolCostSource = (typeof TOOL_COST_SOURCES)[number];

export const toolCosts = pgTable("tool_costs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  orgId: uuid("org_id"),
  serverName: text("server_name").notNull(),
  toolName: text("tool_name").notNull(),
  costMicrodollars: bigint("cost_microdollars", { mode: "number" }).notNull().default(0),
  suggestedCost: bigint("suggested_cost", { mode: "number" }).notNull().default(0),
  source: text("source").$type<ToolCostSource>().notNull().default("discovered"),
  description: text("description"),
  annotations: jsonb("annotations").$type<Record<string, unknown> | null>(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("tool_costs_user_server_tool_idx").on(table.userId, table.serverName, table.toolName),
  index("tool_costs_user_id_idx").on(table.userId),
]);

export type ToolCostRow = typeof toolCosts.$inferSelect;
export type NewToolCostRow = typeof toolCosts.$inferInsert;

export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  orgId: uuid("org_id"),
  url: text("url").notNull(),
  description: text("description"),
  signingSecret: text("signing_secret").notNull(),
  previousSigningSecret: text("previous_signing_secret"),
  secretRotatedAt: timestamp("secret_rotated_at", { withTimezone: true }),
  eventTypes: text("event_types").array().notNull().default([]),
  enabled: boolean("enabled").notNull().default(true),
  apiVersion: text("api_version").notNull().default("2026-04-01"),
  payloadMode: text("payload_mode").$type<"full" | "thin">().notNull().default("full"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("webhook_endpoints_user_id_idx").on(table.userId),
]);

export type WebhookEndpointRow = typeof webhookEndpoints.$inferSelect;
export type NewWebhookEndpointRow = typeof webhookEndpoints.$inferInsert;

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  endpointId: uuid("endpoint_id").notNull()
    .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  eventId: text("event_id").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  responseStatus: integer("response_status"),
  responseBodyPreview: text("response_body_preview"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("webhook_deliveries_endpoint_id_idx").on(table.endpointId, table.createdAt),
  index("webhook_deliveries_event_id_idx").on(table.eventId),
]);

export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDeliveryRow = typeof webhookDeliveries.$inferInsert;
