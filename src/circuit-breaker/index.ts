/**
 * AWARE Evolution Phase 2 — Circuit Breaker Framework
 * 
 * Sub-phase 2.1: Per-agent circuit breakers for external services
 * 
 * Design: Archimedes (RESULT-design.md section 3)
 * 
 * State Machine:
 *   CLOSED → (5 failures in 60s) → OPEN
 *   OPEN → (30s elapsed) → HALF_OPEN
 *   HALF_OPEN → (success) → CLOSED
 *   HALF_OPEN → (failure) → OPEN
 */

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
  /** Failures before opening circuit */
  failureThreshold: number;
  /** Time window to count failures (ms) */
  failureWindowMs: number;
  /** How long OPEN state lasts before HALF_OPEN (ms) */
  openDurationMs: number;
  /** Test requests allowed in HALF_OPEN state */
  halfOpenRequests: number;
}

export const DEFAULT_BREAKER_CONFIG: Required<CircuitBreakerConfig> = {
  failureThreshold: 5,
  failureWindowMs: 60 * 1000,      // 1 min
  openDurationMs: 30 * 1000,        // 30s
  halfOpenRequests: 1,
};

interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  failureWindowStart: number;
  lastFailureTime: number;
  halfOpenAttempts: number;
  openedAt: number | null;
  consecutiveSuccesses: number;
}

export interface CircuitBreakerStatus {
  agentId: string;
  service: string;
  state: CircuitState;
  failureCount: number;
  failureThreshold: number;
  remainingFailures: number;
  timeUntilHalfOpenMs: number | null;
  timeUntilClosedMs: number | null;
}

export class CircuitBreaker {
  private config: Required<CircuitBreakerConfig>;
  private state: CircuitBreakerState;
  private agentId: string;
  private service: string;
  private key: string;

  constructor(
    agentId: string,
    service: string,
    config: Partial<CircuitBreakerConfig> = {},
  ) {
    this.agentId = agentId;
    this.service = service;
    this.key = `${agentId}:${service}`;
    this.config = { ...DEFAULT_BREAKER_CONFIG, ...config };
    this.state = this.createInitialState();
  }

  private createInitialState(): CircuitBreakerState {
    return {
      state: "CLOSED",
      failureCount: 0,
      failureWindowStart: Date.now(),
      lastFailureTime: 0,
      halfOpenAttempts: 0,
      openedAt: null,
      consecutiveSuccesses: 0,
    };
  }

  /**
   * Get current circuit state.
   */
  getState(): CircuitState {
    this.checkStateTransitions();
    return this.state.state;
  }

  /**
   * Check if a request can be executed.
   */
  canExecute(): boolean {
    this.checkStateTransitions();
    return this.state.state !== "OPEN";
  }

  /**
   * Record a successful request.
   */
  recordSuccess(): void {
    switch (this.state.state) {
      case "CLOSED":
        // Reset failure count on success
        this.state.failureCount = 0;
        this.state.consecutiveSuccesses++;
        break;

      case "HALF_OPEN":
        // Success in HALF_OPEN → close the circuit
        this.state.consecutiveSuccesses++;
        if (this.state.consecutiveSuccesses >= this.config.halfOpenRequests) {
          this.close();
        }
        break;

      case "OPEN":
        // Shouldn't happen — ignore
        break;
    }
  }

  /**
   * Record a failed request.
   */
  recordFailure(error?: unknown): void {
    this.state.lastFailureTime = Date.now();

    switch (this.state.state) {
      case "CLOSED":
        this.recordFailureInClosed();
        break;

      case "HALF_OPEN":
        // Directly set to OPEN - don't call open() which might have issues
        this.state.state = "OPEN";
        this.state.openedAt = Date.now();
        break;

      case "OPEN":
        // Already open, just record
        break;
    }
  }

  /**
   * Execute a function with circuit breaker protection.
   * Returns result on success, throws on circuit open or failure.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      throw new ServiceUnavailableError(
        `Circuit breaker open for ${this.service}`,
        this.key,
        this.state,
        this.timeUntilHalfOpenMs ?? 0,
      );
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure(error);
      throw error;
    }
  }

  /**
   * Get circuit breaker status for monitoring/telemetry.
   */
  getStatus(): CircuitBreakerStatus {
    this.checkStateTransitions();
    
    return {
      agentId: this.agentId,
      service: this.service,
      state: this.state.state,
      failureCount: this.state.failureCount,
      failureThreshold: this.config.failureThreshold,
      remainingFailures: Math.max(0, this.config.failureThreshold - this.state.failureCount),
      timeUntilHalfOpenMs: this.timeUntilHalfOpenMs,
      timeUntilClosedMs: this.timeUntilClosedMs,
    };
  }

  /**
   * Reset the circuit breaker to initial state.
   */
  reset(): void {
    this.state = this.createInitialState();
  }

  /**
   * Get time until circuit transitions from OPEN to HALF_OPEN.
   */
  private get timeUntilHalfOpenMs(): number | null {
    if (this.state.state !== "OPEN" || !this.state.openedAt) {
      return null;
    }
    const elapsed = Date.now() - this.state.openedAt;
    return Math.max(0, this.config.openDurationMs - elapsed);
  }

  /**
   * Get time until circuit transitions from HALF_OPEN to CLOSED (if success).
   */
  private get timeUntilClosedMs(): number | null {
    if (this.state.state !== "HALF_OPEN") {
      return null;
    }
    // Time based on halfOpenRequests - consecutiveSuccesses
    const remaining = this.config.halfOpenRequests - this.state.consecutiveSuccesses;
    return remaining * 1000; // Simplified - in real impl, this would track actual times
  }

  private checkStateTransitions(): void {
    if (this.state.state === "OPEN" && this.state.openedAt) {
      const elapsed = Date.now() - this.state.openedAt;
      if (elapsed >= this.config.openDurationMs) {
        this.halfOpen();
      }
    }

    // Check if failure window has expired (reset count)
    if (
      this.state.state === "CLOSED" &&
      Date.now() - this.state.failureWindowStart > this.config.failureWindowMs
    ) {
      this.state.failureCount = 0;
      this.state.failureWindowStart = Date.now();
    }
  }

  private recordFailureInClosed(): void {
    // Reset consecutive successes on failure
    this.state.consecutiveSuccesses = 0;
    
    // Check if failure window has expired - start new window if so
    if (Date.now() - this.state.failureWindowStart > this.config.failureWindowMs) {
      this.state.failureCount = 0;
      this.state.failureWindowStart = Date.now();
    }

    this.state.failureCount++;

    if (this.state.failureCount >= this.config.failureThreshold) {
      this.open();
    }
  }

  private open(): void {
    this.state = {
      ...this.state,
      state: "OPEN",
      openedAt: Date.now(),
      halfOpenAttempts: 0,
      consecutiveSuccesses: 0,
    };
  }

  private halfOpen(): void {
    this.state = {
      ...this.state,
      state: "HALF_OPEN",
      failureCount: 0, // Reset failure count when entering half-open
      halfOpenAttempts: 0,
      openedAt: null,
      consecutiveSuccesses: 0,
    };
  }

  private close(): void {
    this.state = this.createInitialState();
  }
}

export class ServiceUnavailableError extends Error {
  constructor(
    message: string,
    public readonly circuitKey: string,
    public readonly circuitState: CircuitState,
    public readonly retryAfterMs: number,
  ) {
    super(message);
    this.name = "ServiceUnavailableError";
  }
}

/**
 * Circuit Breaker Registry
 * 
 * Manages circuit breakers for all agents and services.
 * Singleton pattern for global access.
 */
class CircuitBreakerRegistry {
  private circuits: Map<string, CircuitBreaker> = new Map();

  /**
   * Get or create a circuit breaker for an agent/service.
   */
  getCircuitBreaker(
    agentId: string,
    service: string,
    config?: Partial<CircuitBreakerConfig>,
  ): CircuitBreaker {
    const key = `${agentId}:${service}`;
    
    if (!this.circuits.has(key)) {
      this.circuits.set(key, new CircuitBreaker(agentId, service, config));
    }
    
    return this.circuits.get(key)!;
  }

  /**
   * Get all circuit breaker statuses.
   */
  getAllStatuses(): CircuitBreakerStatus[] {
    return Array.from(this.circuits.values()).map((cb) => cb.getStatus());
  }

  /**
   * Get statuses filtered by agent.
   */
  getStatusesForAgent(agentId: string): CircuitBreakerStatus[] {
    return this.getAllStatuses().filter((s) => s.agentId === agentId);
  }

  /**
   * Get statuses filtered by service.
   */
  getStatusesForService(service: string): CircuitBreakerStatus[] {
    return this.getAllStatuses().filter((s) => s.service === service);
  }

  /**
   * Get only circuits that are OPEN.
   */
  getOpenCircuits(): CircuitBreakerStatus[] {
    return this.getAllStatuses().filter((s) => s.state === "OPEN" || s.state === "HALF_OPEN");
  }

  /**
   * Reset all circuit breakers.
   */
  resetAll(): void {
    for (const cb of this.circuits.values()) {
      cb.reset();
    }
  }

  /**
   * Reset circuit breakers for a specific agent.
   */
  resetAgent(agentId: string): void {
    for (const [key, cb] of this.circuits.entries()) {
      if (key.startsWith(`${agentId}:`)) {
        cb.reset();
      }
    }
  }
}

// Singleton instance
export const circuitBreakerRegistry = new CircuitBreakerRegistry();

/**
 * Predefined external services that need circuit breakers.
 * Based on AWARE threat model.
 */
export const AWARE_SERVICES = {
  SESSIONS_SEND: "sessions_send",
  FILE_WRITE: "file_write",
  FILE_READ: "file_read",
  EXTERNAL_API: "external_api",
  WEBHOOK: "webhook",
  DATABASE: "database",
  CACHE: "cache",
  MESSAGE_QUEUE: "message_queue",
} as const;

export type AwareService = typeof AWARE_SERVICES[keyof typeof AWARE_SERVICES];

/**
 * Get default circuit breaker config for a service.
 */
export function getDefaultConfig(service: AwareService): Required<CircuitBreakerConfig> {
  // Most services use standard config
  return { ...DEFAULT_BREAKER_CONFIG };
}
