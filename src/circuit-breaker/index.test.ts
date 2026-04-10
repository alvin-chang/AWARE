/**
 * Circuit Breaker Tests
 * 
 * Tests for AWARE Evolution Phase 2.1 circuit breaker implementation.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  CircuitBreaker,
  CircuitBreakerConfig,
  CircuitState,
  ServiceUnavailableError,
  circuitBreakerRegistry,
  DEFAULT_BREAKER_CONFIG,
} from "./index";

describe("CircuitBreaker", () => {
  const agentId = "test-agent";
  const service = "test-service";

  describe("initial state", () => {
    it("should start in CLOSED state", () => {
      const cb = new CircuitBreaker(agentId, service);
      expect(cb.getState()).toBe("CLOSED");
      expect(cb.canExecute()).toBe(true);
    });

    it("should use default config", () => {
      const cb = new CircuitBreaker(agentId, service);
      const status = cb.getStatus();
      expect(status.failureThreshold).toBe(DEFAULT_BREAKER_CONFIG.failureThreshold);
      expect(status.remainingFailures).toBe(DEFAULT_BREAKER_CONFIG.failureThreshold);
    });
  });

  describe("CLOSED → OPEN transition", () => {
    it("should open after failureThreshold failures", () => {
      const cb = new CircuitBreaker(agentId, service, {
        failureThreshold: 3,
        failureWindowMs: 60000,
        openDurationMs: 30000,
      });

      // Record 2 failures - should still be CLOSED
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState()).toBe("CLOSED");

      // Third failure - should OPEN
      cb.recordFailure();
      expect(cb.getState()).toBe("OPEN");
      expect(cb.canExecute()).toBe(false);
    });

    it("should reset failure count on success in CLOSED", () => {
      const cb = new CircuitBreaker(agentId, service, {
        failureThreshold: 3,
      });

      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getStatus().failureCount).toBe(2);

      cb.recordSuccess();
      expect(cb.getStatus().failureCount).toBe(0);
    });

    it("should reset failure count after window expires", async () => {
      const cb = new CircuitBreaker(agentId, service, {
        failureThreshold: 3,
        failureWindowMs: 100, // 100ms window
      });

      cb.recordFailure();
      expect(cb.getStatus().failureCount).toBe(1);

      // Wait for window to expire
      await new Promise((r) => setTimeout(r, 150));

      // Window should be reset, but only checked on state access
      expect(cb.getState()).toBe("CLOSED");
      expect(cb.getStatus().failureCount).toBe(0);
    });
  });

  describe("OPEN → HALF_OPEN transition", () => {
    it("should transition to HALF_OPEN after openDurationMs", async () => {
      const cb = new CircuitBreaker(agentId, service, {
        openDurationMs: 100, // 100ms
      });

      // Trip the circuit
      for (let i = 0; i < 5; i++) {
        cb.recordFailure();
      }
      expect(cb.getState()).toBe("OPEN");

      // Wait for open duration
      await new Promise((r) => setTimeout(r, 150));

      // Should transition to HALF_OPEN
      expect(cb.getState()).toBe("HALF_OPEN");
      expect(cb.canExecute()).toBe(true);
    });

    it("should allow execution in HALF_OPEN", async () => {
      const cb = new CircuitBreaker(agentId, service, {
        openDurationMs: 20,
      });

      // Trip the circuit
      for (let i = 0; i < 5; i++) {
        cb.recordFailure();
      }

      // Wait for HALF_OPEN transition
      await new Promise((r) => setTimeout(r, 25));

      expect(cb.getState()).toBe("HALF_OPEN");
      expect(cb.canExecute()).toBe(true);
    });
  });

  describe("HALF_OPEN → CLOSED transition", () => {
    it("should close after successful halfOpenRequests", async () => {
      const cb = new CircuitBreaker(agentId, service, {
        failureThreshold: 5,
        openDurationMs: 20,
        halfOpenRequests: 2,
      });

      // Trip the circuit
      for (let i = 0; i < 5; i++) {
        cb.recordFailure();
      }

      // Wait for HALF_OPEN transition
      await new Promise((r) => setTimeout(r, 25));

      const stateAfterWait = cb.getState();
      expect(stateAfterWait).toBe("HALF_OPEN");

      // Record successes in HALF_OPEN
      cb.recordSuccess();
      expect(cb.getState()).toBe("HALF_OPEN"); // Still HALF_OPEN after 1 success

      cb.recordSuccess();
      expect(cb.getState()).toBe("CLOSED"); // CLOSED after 2 successes
    });

    it("should reopen on failure in HALF_OPEN", async () => {
      // Use different instance to avoid state pollution
      const cb2 = new CircuitBreaker(`${agentId}-b`, `${service}-b`, {
        failureThreshold: 5,
        openDurationMs: 20,
        halfOpenRequests: 2,
      });

      // Trip the circuit
      for (let i = 0; i < 5; i++) {
        cb2.recordFailure();
      }
      expect(cb2.getState()).toBe("OPEN");

      // Wait for HALF_OPEN transition
      await new Promise((r) => setTimeout(r, 25));
      expect(cb2.getState()).toBe("HALF_OPEN");

      // Record failure in HALF_OPEN - should transition to OPEN
      cb2.recordFailure();
      expect(cb2.getState()).toBe("OPEN");
    });
  });

  describe("execute()", () => {
    it("should return result on success", async () => {
      const cb = new CircuitBreaker(agentId, service);
      const result = await cb.execute(async () => "success");
      expect(result).toBe("success");
    });

    it("should throw ServiceUnavailableError when OPEN", () => {
      const cb = new CircuitBreaker(agentId, service, {
        failureThreshold: 1, // Single failure opens
        openDurationMs: 10000, // Long open duration
      });

      cb.recordFailure();
      expect(cb.getState()).toBe("OPEN");

      expect(cb.execute(async () => "test")).rejects.toThrow(ServiceUnavailableError);
    });

    it("should propagate errors from wrapped function", async () => {
      const cb = new CircuitBreaker(agentId, service);
      const error = new Error("test error");

      expect(cb.execute(async () => { throw error; })).rejects.toThrow("test error");
    });

    it("should record failure when wrapped function throws", async () => {
      const cb = new CircuitBreaker(`${agentId}-throw`, `${service}-throw`, {
        failureThreshold: 2,
      });

      try {
        await cb.execute(async () => { throw new Error("fail"); });
      } catch {}

      expect(cb.getStatus().failureCount).toBe(1);
    });
  });

  describe("getStatus()", () => {
    it("should return correct status structure", () => {
      const cb = new CircuitBreaker(agentId, service);
      const status = cb.getStatus();

      expect(status).toHaveProperty("agentId");
      expect(status).toHaveProperty("service");
      expect(status).toHaveProperty("state");
      expect(status).toHaveProperty("failureCount");
      expect(status).toHaveProperty("failureThreshold");
      expect(status).toHaveProperty("remainingFailures");
      expect(status).toHaveProperty("timeUntilHalfOpenMs");
      expect(status).toHaveProperty("timeUntilClosedMs");
    });

    it("should show correct remaining failures", () => {
      const cb = new CircuitBreaker(agentId, service, {
        failureThreshold: 5,
      });

      cb.recordFailure();
      cb.recordFailure();

      const status = cb.getStatus();
      expect(status.remainingFailures).toBe(3);
      expect(status.failureCount).toBe(2);
    });
  });

  describe("reset()", () => {
    it("should reset to initial state", () => {
      const cb = new CircuitBreaker(agentId, service, {
        failureThreshold: 2,
      });

      cb.recordFailure();
      cb.recordFailure(); // Now OPEN
      expect(cb.getState()).toBe("OPEN");

      cb.reset();
      expect(cb.getState()).toBe("CLOSED");
      expect(cb.getStatus().failureCount).toBe(0);
    });
  });
});

describe("CircuitBreakerRegistry", () => {
  beforeEach(() => {
    // Reset registry before each test
    const statuses = circuitBreakerRegistry.getAllStatuses();
    for (const status of statuses) {
      circuitBreakerRegistry.getCircuitBreaker(status.agentId, status.service).reset();
    }
  });

  describe("getCircuitBreaker()", () => {
    it("should return same instance for same agent/service", () => {
      const cb1 = circuitBreakerRegistry.getCircuitBreaker("agent1", "service1");
      const cb2 = circuitBreakerRegistry.getCircuitBreaker("agent1", "service1");
      expect(cb1).toBe(cb2);
    });

    it("should return different instances for different agents", () => {
      const cb1 = circuitBreakerRegistry.getCircuitBreaker("agent1", "service1");
      const cb2 = circuitBreakerRegistry.getCircuitBreaker("agent2", "service1");
      expect(cb1).not.toBe(cb2);
    });

    it("should return different instances for different services", () => {
      const cb1 = circuitBreakerRegistry.getCircuitBreaker("agent1", "service1");
      const cb2 = circuitBreakerRegistry.getCircuitBreaker("agent1", "service2");
      expect(cb1).not.toBe(cb2);
    });
  });

  describe("getAllStatuses()", () => {
    it("should return circuits in initial state after reset", () => {
      // Reset all circuits
      circuitBreakerRegistry.resetAll();
      const statuses = circuitBreakerRegistry.getAllStatuses();
      // After reset, all circuits should be CLOSED with 0 failures
      for (const status of statuses) {
        expect(status.state).toBe("CLOSED");
        expect(status.failureCount).toBe(0);
      }
    });
  });

  describe("getOpenCircuits()", () => {
    it("should return only OPEN/HALF_OPEN circuits", () => {
      // Create and trip one circuit
      const cb1 = circuitBreakerRegistry.getCircuitBreaker("agent1", "service1");
      for (let i = 0; i < 5; i++) {
        cb1.recordFailure();
      }

      const openCircuits = circuitBreakerRegistry.getOpenCircuits();
      expect(openCircuits.length).toBeGreaterThanOrEqual(1);
      expect(openCircuits.some((c) => c.service === "service1")).toBe(true);
    });
  });
});

describe("ServiceUnavailableError", () => {
  it("should have correct properties", () => {
    const error = new ServiceUnavailableError("test", "agent:service", "OPEN", 30000);
    expect(error.circuitKey).toBe("agent:service");
    expect(error.circuitState).toBe("OPEN");
    expect(error.retryAfterMs).toBe(30000);
    expect(error.name).toBe("ServiceUnavailableError");
  });
});
