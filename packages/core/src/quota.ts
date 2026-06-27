/**
 * VaultEdge Quota & Circuit Breaker
 *
 * Tracks rate-limit headers from provider responses and implements a
 * circuit breaker pattern to avoid hammering dead or exhausted keys.
 *
 * Circuit breaker states:
 *   Closed   → key is healthy, requests go through
 *   Open     → key is tripped, requests are blocked until `until` timestamp
 *   HalfOpen → cooldown expired, next request is allowed as a probe
 */

// ─── Circuit Breaker ─────────────────────────────────────────────────────────

export type CircuitState =
  | { status: "Closed" }
  | { status: "Open"; until: number; failureDuration: number }
  | { status: "HalfOpen"; failureDuration: number };

export class CircuitBreaker {
  private states = new Map<string, CircuitState>();

  trip(keyId: string, durationMs: number): void {
    this.states.set(keyId, {
      status: "Open",
      until: Date.now() + durationMs,
      failureDuration: durationMs,
    });
  }

  isAvailable(keyId: string): boolean {
    const state = this.states.get(keyId);
    if (!state || state.status === "Closed" || state.status === "HalfOpen") return true;
    if (state.status === "Open") {
      if (Date.now() >= state.until) {
        this.states.set(keyId, { status: "HalfOpen", failureDuration: state.failureDuration });
        return true;
      }
      return false;
    }
    return true;
  }

  recordSuccess(keyId: string): void {
    const state = this.states.get(keyId);
    if (state?.status === "HalfOpen") {
      this.states.set(keyId, { status: "Closed" });
    }
  }

  recordFailure(keyId: string, isUnauthorized: boolean): void {
    let state = this.states.get(keyId);
    if (!state || state.status === "Closed") {
      state = { status: "Open", until: 0, failureDuration: 60_000 };
      this.states.set(keyId, state);
    }

    if (isUnauthorized) {
      // 5-minute quarantine for 401 — key is likely invalid
      this.trip(keyId, 300_000);
    } else {
      // Exponential backoff, capped at 5 minutes
      const newDuration = Math.min(state.failureDuration * 2, 300_000);
      this.states.set(keyId, {
        status: "Open",
        until: Date.now() + newDuration,
        failureDuration: newDuration,
      });
    }
  }

  getState(keyId: string): CircuitState {
    return this.states.get(keyId) ?? { status: "Closed" };
  }

  reset(keyId: string): void {
    this.states.delete(keyId);
  }

  resetAll(): void {
    this.states.clear();
  }
}

// ─── Quota Map ────────────────────────────────────────────────────────────────

export interface QuotaState {
  provider: string;
  remainingRequests?: number;
  remainingTokens?: number;
  lastUpdated: number;
}

export class QuotaMap {
  private quotas = new Map<string, QuotaState>();

  update(keyId: string, state: QuotaState): void {
    this.quotas.set(keyId, state);
  }

  get(keyId: string): QuotaState | undefined {
    return this.quotas.get(keyId);
  }

  /**
   * Sort a list of key IDs by remaining quota (most quota first).
   * Keys with 0 remaining requests are deprioritized.
   * Keys with no quota data are treated as fully available.
   */
  sortKeys(candidates: string[]): string[] {
    return [...candidates].sort((a, b) => {
      const qa = this.quotas.get(a);
      const qb = this.quotas.get(b);

      if (qa?.remainingRequests === 0) return 1;
      if (qb?.remainingRequests === 0) return -1;

      const tokA = qa?.remainingTokens ?? Number.MAX_SAFE_INTEGER;
      const tokB = qb?.remainingTokens ?? Number.MAX_SAFE_INTEGER;
      return tokB - tokA; // Descending: most tokens first
    });
  }
}

// ─── Rate-Limit Header Extraction ─────────────────────────────────────────────

/**
 * Parse rate-limit headers from a provider response and update the quota map.
 * Supports Anthropic's custom headers and the standard x-ratelimit-* headers.
 */
export function extractQuotaHeaders(
  headers: Headers,
  provider: string,
  keyId: string,
  quotaMap: QuotaMap
): void {
  let remainingRequests: number | undefined;
  let remainingTokens: number | undefined;

  if (provider === "Anthropic") {
    const reqs = headers.get("anthropic-ratelimit-requests-remaining");
    const toks = headers.get("anthropic-ratelimit-tokens-remaining");
    if (reqs) remainingRequests = parseInt(reqs, 10);
    if (toks) remainingTokens = parseInt(toks, 10);
  } else {
    const reqs =
      headers.get("x-ratelimit-remaining-requests") ?? headers.get("ratelimit-remaining");
    const toks = headers.get("x-ratelimit-remaining-tokens");
    if (reqs) remainingRequests = parseInt(reqs, 10);
    if (toks) remainingTokens = parseInt(toks, 10);
  }

  if (remainingRequests !== undefined || remainingTokens !== undefined) {
    quotaMap.update(keyId, {
      provider,
      remainingRequests: Number.isNaN(remainingRequests) ? undefined : remainingRequests,
      remainingTokens: Number.isNaN(remainingTokens) ? undefined : remainingTokens,
      lastUpdated: Date.now(),
    });
  }
}

// ─── Global Singletons (SDK) ──────────────────────────────────────────────────

export const globalCircuitBreaker = new CircuitBreaker();
export const globalQuotaMap = new QuotaMap();
