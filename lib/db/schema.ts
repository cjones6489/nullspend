import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { ActionStatus, ActionType } from "@/lib/utils/status";

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull(),
  keyPrefix: text("key_prefix").notNull(),
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
  ownerUserId: text("owner_user_id"),
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
  webhookUrl: text("webhook_url").notNull(),
  channelName: text("channel_name"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SlackConfigRow = typeof slackConfigs.$inferSelect;
