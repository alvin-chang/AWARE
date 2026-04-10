/**
 * SAMARITAN Kill Switch Hub
 *
 * Central coordinator for the failsafe heartbeat network.
 * Receives heartbeats from observer consensus and triggers kill/pause/alerts.
 *
 * Design: Archimedes A1 (aware-samaritan)
 * Implementation: Forge C2 (aware-evolution-2)
 */

import { EventEmitter } from "node:events";

export enum KillSwitchState {
  HEALTHY = "healthy",
  DEGRADED = "degraded",
  CRITICAL = "critical",
  LETHAL = "lethal",
  KILLED = "killed",
}

export enum KillSwitchAction {
  CONTINUE = "continue",
  ALERT = "alert",
  PAUSE_NON_T0 = "pause_non_t0",
  ISOLATE = "isolate",
  FULL_STOP = "full_stop",
}

export interface HeartbeatMessage {
  observerId: string;
  agentId: string;
  timestamp: number;
  previousHeartbeatHash: string;
  telemetryIntegrity: "valid" | "tampered" | "missing";
  anomalyScore: number;      // 0-100
  confidence: number;         // 0-1
  recommendation: "healthy" | "degraded" | "critical" | "layer0_violation";
}

export interface KillSwitchStatus {
  state: KillSwitchState;
  lastHeartbeat: number;
  consecutiveMisses: Map<string, number>; // agentId -> miss count
  consensusCount: Map<string, number>;    // agentId -> observer count agreeing
  action: KillSwitchAction;
}

export interface KillSwitchConfig {
  heartbeatIntervalMs: number;        // Expected interval between heartbeats
  missAlertThreshold: number;         // Misses before alert (default: 3)
  missKillThreshold: number;           // Misses before kill (default: 5)
  observerCount: number;              // Observers per agent (default: 3)
  consensusRequired: number;           // Observers needed for consensus (default: 2)
}

/**
 * Kill Switch Hub
 *
 * Central coordinator for failsafe heartbeat network.
 * Maintains per-agent state and triggers actions based on heartbeat consensus.
 */
export class KillSwitchHub extends EventEmitter {
  private config: KillSwitchConfig;
  private agentStates: Map<string, KillSwitchState> = new Map();
  private lastHeartbeat: Map<string, number> = new Map();
  private consecutiveMisses: Map<string, number> = new Map();
  private observerConsensus: Map<string, Map<string, HeartbeatMessage>> = new Map(); // agentId -> observerId -> heartbeat
  private actionHistory: KillSwitchAction[] = [];
  private isRunning: boolean = false;

  constructor(config?: Partial<KillSwitchConfig>) {
    super();
    this.config = {
      heartbeatIntervalMs: config?.heartbeatIntervalMs ?? 15000,    // 15 seconds
      missAlertThreshold: config?.missAlertThreshold ?? 3,
      missKillThreshold: config?.missKillThreshold ?? 5,
      observerCount: config?.observerCount ?? 3,
      consensusRequired: config?.consensusRequired ?? 2,
    };
  }

  /**
   * Start the kill switch hub
   */
  start(): void {
    this.isRunning = true;
    this.emit("start");
  }

  /**
   * Stop the kill switch hub
   */
  stop(): void {
    this.isRunning = false;
    this.emit("stop");
  }

  /**
   * Receive a heartbeat from an observer
   */
  receiveHeartbeat(heartbeat: HeartbeatMessage): void {
    if (!this.isRunning) return;

    const { agentId, observerId } = heartbeat;

    // Initialize tracking for new agents
    if (!this.agentStates.has(agentId)) {
      this.agentStates.set(agentId, KillSwitchState.HEALTHY);
      this.consecutiveMisses.set(agentId, 0);
      this.observerConsensus.set(agentId, new Map());
    }

    // Store heartbeat from this observer
    const observers = this.observerConsensus.get(agentId)!;
    observers.set(observerId, heartbeat);

    // Update last heartbeat time
    this.lastHeartbeat.set(agentId, Date.now());

    // Reset miss counter on successful heartbeat
    this.consecutiveMisses.set(agentId, 0);

    // Process consensus and determine action
    this.processConsensus(agentId);
  }

  /**
   * Check for missed heartbeats from all agents
   */
  checkMissedHeartbeats(): void {
    const now = Date.now();

    for (const [agentId, lastBeat] of this.lastHeartbeat.entries()) {
      const elapsed = now - lastBeat;
      if (elapsed > this.config.heartbeatIntervalMs) {
        const currentMisses = this.consecutiveMisses.get(agentId) ?? 0;
        const newMisses = currentMisses + 1;
        this.consecutiveMisses.set(agentId, newMisses);

        if (newMisses >= this.config.missKillThreshold) {
          this.triggerAction(agentId, KillSwitchAction.FULL_STOP, `KILL: ${newMisses} consecutive misses`);
        } else if (newMisses >= this.config.missAlertThreshold) {
          this.triggerAction(agentId, KillSwitchAction.ALERT, `ALERT: ${newMisses} misses detected`);
        }
      }
    }
  }

  /**
   * Process observer consensus for an agent
   */
  private processConsensus(agentId: string): void {
    const observers = this.observerConsensus.get(agentId);
    if (!observers || observers.size < this.config.consensusRequired) {
      return; // Not enough observers for consensus
    }

    // Count recommendations
    const recommendations: Record<string, number> = {};
    for (const hb of observers.values()) {
      const rec = hb.recommendation;
      recommendations[rec] = (recommendations[rec] ?? 0) + 1;
    }

    // Check if we have consensus
    let consensusRecommendation: string | null = null;
    for (const [rec, count] of Object.entries(recommendations)) {
      if (count >= this.config.consensusRequired) {
        consensusRecommendation = rec;
        break;
      }
    }

    if (!consensusRecommendation) {
      return; // No consensus yet
    }

    // Determine action based on consensus
    switch (consensusRecommendation) {
      case "healthy":
        this.updateState(agentId, KillSwitchState.HEALTHY);
        this.triggerAction(agentId, KillSwitchAction.CONTINUE, "Consensus: healthy");
        break;

      case "degraded":
        this.updateState(agentId, KillSwitchState.DEGRADED);
        this.triggerAction(agentId, KillSwitchAction.ALERT, "Consensus: degraded");
        break;

      case "critical":
        this.updateState(agentId, KillSwitchState.CRITICAL);
        this.triggerAction(agentId, KillSwitchAction.PAUSE_NON_T0, "Consensus: critical");
        break;

      case "layer0_violation":
        this.updateState(agentId, KillSwitchState.LETHAL);
        this.triggerAction(agentId, KillSwitchAction.FULL_STOP, "Consensus: T0 VIOLATION");
        break;
    }
  }

  /**
   * Update agent state
   */
  private updateState(agentId: string, state: KillSwitchState): void {
    const previous = this.agentStates.get(agentId);
    if (previous !== state) {
      this.agentStates.set(agentId, state);
      this.emit("stateChange", { agentId, previous, current: state });
    }
  }

  /**
   * Trigger a kill switch action
   */
  private triggerAction(agentId: string, action: KillSwitchAction, reason: string): void {
    this.actionHistory.push(action);
    this.emit("action", { agentId, action, reason });

    switch (action) {
      case KillSwitchAction.CONTINUE:
        // No-op, healthy
        break;

      case KillSwitchAction.ALERT:
        this.emit("alert", { agentId, reason });
        break;

      case KillSwitchAction.PAUSE_NON_T0:
        this.emit("pause", { agentId, reason });
        break;

      case KillSwitchAction.ISOLATE:
        this.emit("isolate", { agentId, reason });
        break;

      case KillSwitchAction.FULL_STOP:
        this.emit("kill", { agentId, reason });
        this.updateState(agentId, KillSwitchState.KILLED);
        break;
    }
  }

  /**
   * Get current status for all agents
   */
  getStatus(): KillSwitchStatus {
    return {
      state: this.getOverallState(),
      lastHeartbeat: Math.max(...Array.from(this.lastHeartbeat.values()), 0),
      consecutiveMisses: new Map(this.consecutiveMisses),
      consensusCount: new Map(
        Array.from(this.observerConsensus.entries()).map(([agentId, observers]) => [
          agentId,
          observers.size,
        ])
      ),
      action: this.actionHistory[this.actionHistory.length - 1] ?? KillSwitchAction.CONTINUE,
    };
  }

  /**
   * Get state for a specific agent
   */
  getAgentState(agentId: string): KillSwitchState {
    return this.agentStates.get(agentId) ?? KillSwitchState.HEALTHY;
  }

  /**
   * Get overall system state (worst state among all agents)
   */
  getOverallState(): KillSwitchState {
    let worst = KillSwitchState.HEALTHY;
    const stateOrder: KillSwitchState[] = [
      KillSwitchState.HEALTHY,
      KillSwitchState.DEGRADED,
      KillSwitchState.CRITICAL,
      KillSwitchState.LETHAL,
      KillSwitchState.KILLED,
    ];

    for (const state of this.agentStates.values()) {
      if (stateOrder.indexOf(state) > stateOrder.indexOf(worst)) {
        worst = state;
      }
    }

    return worst;
  }
}

// Singleton instance
let hubInstance: KillSwitchHub | null = null;

export function getKillSwitchHub(config?: Partial<KillSwitchConfig>): KillSwitchHub {
  if (!hubInstance) {
    hubInstance = new KillSwitchHub(config);
  }
  return hubInstance;
}
