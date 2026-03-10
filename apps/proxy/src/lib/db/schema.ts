import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const costEvents = pgTable("cost_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  requestId: text("request_id").notNull(),
  apiKeyId: uuid("api_key_id"),
  userId: text("user_id"),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
  reasoningTokens: integer("reasoning_tokens").notNull().default(0),
  costMicrodollars: bigint("cost_microdollars", { mode: "number" }).notNull(),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("cost_events_request_id_idx").on(table.requestId),
  index("cost_events_user_id_created_at_idx").on(table.userId, table.createdAt),
  index("cost_events_api_key_id_created_at_idx").on(table.apiKeyId, table.createdAt),
]);
