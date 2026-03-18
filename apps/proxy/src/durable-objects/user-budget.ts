import { DurableObject } from "cloudflare:workers";

// ── Types ──────────────────────────────────────────────────────────

export interface BudgetRow {
  entity_type: string;
  entity_id: string;
  max_budget: number;
  spend: number;
  reserved: number;
  policy: string;
  reset_interval: string | null;
  period_start: number;
}

export interface CheckResult {
  status: "approved" | "denied";
  reservationId?: string;
  deniedEntity?: string;
  remaining?: number;
  maxBudget?: number;
  spend?: number;
  periodResets?: Array<{ entityType: string; entityId: string; newPeriodStart: number }>;
}

export interface ReconcileResult {
  status: "reconciled" | "not_found";
  spends?: Record<string, number>;
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Compute the start of the current budget period. */
export function currentPeriodStart(
  interval: string,
  periodStart: number,
  now: number,
): number {
  let start = periodStart;
  const msPerDay = 86_400_000;

  // Fast path for daily/weekly (fixed intervals)
  if (interval === "daily" || interval === "weekly") {
    const step = interval === "daily" ? msPerDay : 7 * msPerDay;
    while (start + step <= now) {
      start += step;
    }
    return start;
  }

  // Month-accurate for monthly
  if (interval === "monthly") {
    const d = new Date(start);
    while (true) {
      const next = new Date(d);
      next.setUTCMonth(next.getUTCMonth() + 1);
      if (next.getTime() > now) break;
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
    return d.getTime();
  }

  // Year-accurate for yearly
  if (interval === "yearly") {
    const d = new Date(start);
    while (true) {
      const next = new Date(d);
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      if (next.getTime() > now) break;
      d.setUTCFullYear(d.getUTCFullYear() + 1);
    }
    return d.getTime();
  }

  return start;
}

/** Parse an entity key safely (handles IDs containing colons). */
function parseEntityKey(key: string): [string, string] {
  const sep = key.indexOf(":");
  return [key.slice(0, sep), key.slice(sep + 1)];
}

// ── Durable Object ──────────────────────────────────────────────────

export class UserBudgetDO extends DurableObject {
  private budgets = new Map<string, BudgetRow>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.initSchema();
      this.loadBudgets();
      console.log(
        `[UserBudgetDO] initialized, ${this.budgets.size} budgets loaded`,
      );
    });
  }

  private initSchema(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS budgets (
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        max_budget INTEGER NOT NULL DEFAULT 0,
        spend INTEGER NOT NULL DEFAULT 0,
        reserved INTEGER NOT NULL DEFAULT 0,
        policy TEXT NOT NULL DEFAULT 'strict_block',
        reset_interval TEXT,
        period_start INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (entity_type, entity_id)
      );
      CREATE TABLE IF NOT EXISTS reservations (
        id TEXT PRIMARY KEY,
        amount INTEGER NOT NULL,
        entity_keys TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO _schema_version(version) VALUES (1);
    `);
  }

  private loadBudgets(): void {
    this.budgets.clear();
    const rows = this.ctx.storage.sql.exec<BudgetRow>(
      "SELECT entity_type, entity_id, max_budget, spend, reserved, policy, reset_interval, period_start FROM budgets",
    );
    for (const row of rows) {
      this.budgets.set(`${row.entity_type}:${row.entity_id}`, row);
    }
  }

  // ── RPC Methods ────────────────────────────────────────────────────

  /**
   * Atomic budget check + reservation across all entity budgets.
   * Handles inline period resets. Only strict_block denies.
   */
  async checkAndReserve(
    entities: Array<{ type: string; id: string }>,
    estimateMicrodollars: number,
    reservationTtlMs: number = 30_000,
  ): Promise<CheckResult> {
    const reservationId = crypto.randomUUID();
    const now = Date.now();

    let result: CheckResult = { status: "approved" };
    let reserved = false;
    const periodResets: Array<{ entityType: string; entityId: string; newPeriodStart: number }> = [];

    this.ctx.storage.transactionSync(() => {
      // Phase 1: Check all entities (with inline period reset)
      const budgetedEntities: Array<{ type: string; id: string }> = [];

      for (const entity of entities) {
        const row = this.ctx.storage.sql
          .exec<BudgetRow>(
            "SELECT * FROM budgets WHERE entity_type = ? AND entity_id = ?",
            entity.type,
            entity.id,
          )
          .toArray()[0];

        if (!row) continue; // No budget configured = no limit

        budgetedEntities.push(entity);

        // Inline budget period reset
        if (row.reset_interval && row.period_start > 0) {
          const newPeriodStart = currentPeriodStart(
            row.reset_interval,
            row.period_start,
            now,
          );
          if (newPeriodStart > row.period_start) {
            this.ctx.storage.sql.exec(
              `UPDATE budgets SET spend = 0, reserved = 0, period_start = ?
               WHERE entity_type = ? AND entity_id = ?`,
              newPeriodStart,
              entity.type,
              entity.id,
            );
            row.spend = 0;
            row.reserved = 0;
            row.period_start = newPeriodStart;
            periodResets.push({ entityType: entity.type, entityId: entity.id, newPeriodStart });
          }
        }

        const remaining = row.max_budget - row.spend - row.reserved;

        if (
          row.policy === "strict_block" &&
          estimateMicrodollars > remaining
        ) {
          result = {
            status: "denied",
            deniedEntity: `${entity.type}:${entity.id}`,
            remaining,
            maxBudget: row.max_budget,
            spend: row.spend,
          };
          console.log(
            `[UserBudgetDO] denied: entity=${entity.type}:${entity.id} remaining=${remaining} estimate=${estimateMicrodollars}`,
          );
          return; // Exit transactionSync — no reservation made
        }
      }

      // Phase 2: Reserve across all entities that have budgets
      if (budgetedEntities.length === 0) return;

      const entityKeys: string[] = [];
      for (const entity of budgetedEntities) {
        const key = `${entity.type}:${entity.id}`;
        this.ctx.storage.sql.exec(
          "UPDATE budgets SET reserved = reserved + ? WHERE entity_type = ? AND entity_id = ?",
          estimateMicrodollars,
          entity.type,
          entity.id,
        );
        entityKeys.push(key);
      }

      // Store reservation for crash recovery
      this.ctx.storage.sql.exec(
        `INSERT INTO reservations (id, amount, entity_keys, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
        reservationId,
        estimateMicrodollars,
        JSON.stringify(entityKeys),
        now,
        now + reservationTtlMs,
      );

      result = { status: "approved", reservationId };
      reserved = true;
    });

    // Attach period resets to result (declared outside transactionSync to survive early returns)
    if (periodResets.length > 0) {
      result.periodResets = periodResets;
    }

    // Update in-memory cache
    this.loadBudgets();

    // Schedule alarm for reservation expiry (only when a reservation was stored)
    if (reserved) {
      const nextExpiry = now + reservationTtlMs;
      const currentAlarm = await this.ctx.storage.getAlarm();
      if (!currentAlarm || currentAlarm > nextExpiry) {
        await this.ctx.storage.setAlarm(nextExpiry);
      }
    }

    return result;
  }

  /**
   * Settle a reservation after actual cost is known.
   * Skips spend update when actualCost is 0 (matches Redis behavior).
   */
  async reconcile(
    reservationId: string,
    actualCostMicrodollars: number,
  ): Promise<ReconcileResult> {
    const row = this.ctx.storage.sql
      .exec<{ amount: number; entity_keys: string }>(
        "SELECT amount, entity_keys FROM reservations WHERE id = ?",
        reservationId,
      )
      .toArray()[0];

    if (!row) {
      console.log(`[UserBudgetDO] reconcile not_found: reservationId=${reservationId}`);
      return { status: "not_found" };
    }

    const entityKeys: string[] = JSON.parse(row.entity_keys);
    const spends: Record<string, number> = {};

    this.ctx.storage.transactionSync(() => {
      for (const key of entityKeys) {
        const [entityType, entityId] = parseEntityKey(key);

        if (actualCostMicrodollars > 0) {
          this.ctx.storage.sql.exec(
            `UPDATE budgets SET
              spend = spend + ?,
              reserved = MAX(0, reserved - ?)
             WHERE entity_type = ? AND entity_id = ?`,
            actualCostMicrodollars,
            row.amount,
            entityType,
            entityId,
          );
        } else {
          this.ctx.storage.sql.exec(
            `UPDATE budgets SET
              reserved = MAX(0, reserved - ?)
             WHERE entity_type = ? AND entity_id = ?`,
            row.amount,
            entityType,
            entityId,
          );
        }

        const updated = this.ctx.storage.sql
          .exec<{ spend: number }>(
            "SELECT spend FROM budgets WHERE entity_type = ? AND entity_id = ?",
            entityType,
            entityId,
          )
          .toArray()[0];
        if (updated) spends[key] = updated.spend;
      }

      this.ctx.storage.sql.exec(
        "DELETE FROM reservations WHERE id = ?",
        reservationId,
      );
    });

    this.loadBudgets();
    return { status: "reconciled", spends };
  }

  /**
   * Seed or refresh a budget entity from Postgres.
   * On first insert: uses all provided values.
   * On conflict: updates max_budget, policy, reset_interval from Postgres
   * but preserves the DO's authoritative spend, reserved, and period_start.
   *
   * Note: method name is an RPC method on the DO stub — do NOT rename
   * (would break rolling deploys).
   */
  async populateIfEmpty(
    entityType: string,
    entityId: string,
    maxBudget: number,
    spend: number,
    policy: string,
    resetInterval: string | null,
    periodStart: number,
  ): Promise<boolean> {
    const key = `${entityType}:${entityId}`;
    const existed = this.budgets.has(key);

    this.ctx.storage.sql.exec(
      `INSERT INTO budgets
       (entity_type, entity_id, max_budget, spend, reserved, policy, reset_interval, period_start)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?)
       ON CONFLICT(entity_type, entity_id) DO UPDATE SET
         max_budget = excluded.max_budget,
         policy = excluded.policy,
         reset_interval = excluded.reset_interval`,
      entityType,
      entityId,
      maxBudget,
      spend,
      policy,
      resetInterval,
      periodStart,
    );

    this.loadBudgets();
    return !existed;
  }

  /** Read-only budget state (for dashboard queries or debugging). */
  async getBudgetState(): Promise<BudgetRow[]> {
    return Array.from(this.budgets.values());
  }

  /**
   * Alarm handler: clean up expired reservations.
   * Replaces Redis TTL-based reservation expiry.
   */
  async alarm(): Promise<void> {
    const now = Date.now();
    const expired = this.ctx.storage.sql
      .exec<{ id: string; amount: number; entity_keys: string }>(
        "SELECT id, amount, entity_keys FROM reservations WHERE expires_at <= ?",
        now,
      )
      .toArray();

    if (expired.length === 0) return;

    console.log(`[UserBudgetDO] alarm: cleaning up ${expired.length} expired reservation(s)`);

    this.ctx.storage.transactionSync(() => {
      for (const rsv of expired) {
        const keys: string[] = JSON.parse(rsv.entity_keys);
        for (const key of keys) {
          const [entityType, entityId] = parseEntityKey(key);
          this.ctx.storage.sql.exec(
            "UPDATE budgets SET reserved = MAX(0, reserved - ?) WHERE entity_type = ? AND entity_id = ?",
            rsv.amount,
            entityType,
            entityId,
          );
        }
        this.ctx.storage.sql.exec(
          "DELETE FROM reservations WHERE id = ?",
          rsv.id,
        );
      }
    });

    this.loadBudgets();

    // Reschedule for next expiring reservation
    const next = this.ctx.storage.sql
      .exec<{ next_exp: number | null }>(
        "SELECT MIN(expires_at) as next_exp FROM reservations",
      )
      .toArray()[0];
    if (next?.next_exp) {
      await this.ctx.storage.setAlarm(next.next_exp);
    }
  }
}
