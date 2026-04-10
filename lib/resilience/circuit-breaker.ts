import { getLogger } from "@/lib/observability";

export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`Circuit breaker "${name}" is open — failing fast.`);
    this.name = "CircuitOpenError";
  }
}

export class CircuitTimeoutError extends Error {
  constructor(name: string, timeoutMs: number) {
    super(`Circuit breaker "${name}" timed out after ${timeoutMs}ms`);
    this.name = "CircuitTimeoutError";
  }
}

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold?: number;
  resetTimeoutMs?: number;
  requestTimeoutMs?: number;
}

export class CircuitBreaker {
  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly requestTimeoutMs: number;

  private state: CircuitState = "CLOSED";
  private consecutiveFailures = 0;
  private lastFailureTime = 0;
  private halfOpenInFlight = false;

  constructor(opts: CircuitBreakerOptions) {
    this.name = opts.name;
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.resetTimeoutMs = opts.resetTimeoutMs ?? 30_000;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 5_000;
  }

  getState(): CircuitState {
    return this.state;
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = "HALF_OPEN";
      } else {
        throw new CircuitOpenError(this.name);
      }
    }

    if (this.state === "HALF_OPEN" && this.halfOpenInFlight) {
      throw new CircuitOpenError(this.name);
    }

    if (this.state === "HALF_OPEN") {
      this.halfOpenInFlight = true;
    }

    try {
      const result = await this.withTimeout(fn);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private async withTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new CircuitTimeoutError(this.name, this.requestTimeoutMs));
        }
      }, this.requestTimeoutMs);

      fn().then(
        (result) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(result);
          }
        },
        (error) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(error);
          }
        },
      );
    });
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    if (this.state === "HALF_OPEN") {
      this.halfOpenInFlight = false;
      this.state = "CLOSED";
      getLogger("circuit-breaker").info({ name: this.name }, "Circuit breaker closed — service recovered");
    }
  }

  private onFailure(): void {
    if (this.state === "HALF_OPEN") {
      this.halfOpenInFlight = false;
      this.state = "OPEN";
      this.lastFailureTime = Date.now();
      getLogger("circuit-breaker").warn({ name: this.name }, "Circuit breaker re-opened — half-open probe failed");
      return;
    }

    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = "OPEN";
      this.lastFailureTime = Date.now();
      getLogger("circuit-breaker").warn(
        { name: this.name, failures: this.consecutiveFailures },
        "Circuit breaker opened — failure threshold reached",
      );
    }
  }

  /** @internal Reset all state for testing only. */
  _resetForTesting(): void {
    this.state = "CLOSED";
    this.consecutiveFailures = 0;
    this.lastFailureTime = 0;
    this.halfOpenInFlight = false;
  }
}
