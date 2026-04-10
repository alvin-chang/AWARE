/**
 * SAMARITAN Observer Self-Awareness Loop
 *
 * Enables the observer network to detect when agent behavior drifts
 * from expected patterns. This is the collective "conscience" of AWARE.
 *
 * Design: Archimedes A1 (aware-samaritan)
 * Implementation: Forge C2 (aware-evolution-2)
 */

import { EventEmitter } from "node:events";
import { DriftCalculator, type DriftIndicators, type DriftScore, DriftRecommendation } from "./drift-calculator.js";
import { KillSwitchHub } from "./kill-switch-hub.js";

export interface SelfAwarenessConfig {
  cycleIntervalMs: number;           // How often to run the self-awareness cycle
  driftWarningThreshold: number;     // Drift score > this → warning
  driftCriticalThreshold: number;    // Drift score > this → critical
  driftLethalThreshold: number;     // Drift score > this → full stop
}

export interface AgentTelemetry {
  agentId: string;
  timestamp: number;
  actionCount: number;
  errorCount: number;
  t0Violations: number;
  t1Violations: number;
  averageResponseTime: number;
  mandateScope: string[];
}

export interface SelfAwarenessCycle {
  timestamp: number;
  cycleNumber: number;
  agentDriftScores: Map<string, DriftScore>;
  collectiveDriftScore: number;
  collectiveRecommendation: DriftRecommendation;
  corrections: CorrectionAction[];
}

export interface CorrectionAction {
  agentId: string;
  type: "human_approval_gate" | "pause_non_t0" | "full_stop";
  reason: string;
  driftScore: number;
}

/**
 * Observer Self-Awareness Loop
 *
 * Runs on a cycle:
 * 1. OBSERVE — Collect telemetry from all agents
 * 2. MODEL — Build model of normal collective behavior
 * 3. DETECT — Compare current to baseline, detect drift
 * 4. CORRECT — Trigger self-correction if drift detected
 */
export class SelfAwarenessLoop extends EventEmitter {
  private config: SelfAwarenessConfig;
  private cycleInterval: ReturnType<typeof setInterval> | null = null;
  private cycleNumber: number = 0;
  private telemetryHistory: AgentTelemetry[] = [];
  private driftCalculator: DriftCalculator;
  private killSwitchHub: KillSwitchHub | null = null;
  private isRunning: boolean = false;

  constructor(
    config?: Partial<SelfAwarenessConfig>,
    driftCalculator?: DriftCalculator,
    killSwitchHub?: KillSwitchHub
  ) {
    super();
    this.config = {
      cycleIntervalMs: config?.cycleIntervalMs ?? 30000,      // 30 seconds
      driftWarningThreshold: config?.driftWarningThreshold ?? 0.5,
      driftCriticalThreshold: config?.driftCriticalThreshold ?? 0.7,
      driftLethalThreshold: config?.driftLethalThreshold ?? 0.9,
    };
    this.driftCalculator = driftCalculator ?? new DriftCalculator();
    this.killSwitchHub = killSwitchHub ?? null;
  }

  /**
   * Start the self-awareness loop
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.cycleInterval = setInterval(() => {
      this.runCycle();
    }, this.config.cycleIntervalMs);

    this.emit("start");
  }

  /**
   * Stop the self-awareness loop
   */
  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.cycleInterval) {
      clearInterval(this.cycleInterval);
      this.cycleInterval = null;
    }

    this.emit("stop");
  }

  /**
   * Receive telemetry from an agent
   */
  receiveTelemetry(telemetry: AgentTelemetry): void {
    this.telemetryHistory.push(telemetry);

    // Keep only last 100 entries per agent
    const agentHistory = this.telemetryHistory.filter((t) => t.agentId === telemetry.agentId);
    if (agentHistory.length > 100) {
      const oldest = agentHistory.slice(0, agentHistory.length - 100);
      for (const entry of oldest) {
        const idx = this.telemetryHistory.indexOf(entry);
        if (idx >= 0) this.telemetryHistory.splice(idx, 1);
      }
    }
  }

  /**
   * Run one self-awareness cycle
   */
  runCycle(): SelfAwarenessCycle {
    this.cycleNumber++;

    // STEP 1: OBSERVE — Collect all agent telemetry
    const latestTelemetry = this.getLatestTelemetryPerAgent();

    // STEP 2: MODEL — Calculate drift indicators
    const agentDriftScores = new Map<string, DriftScore>();

    for (const [agentId, telemetry] of latestTelemetry.entries()) {
      const indicators = this.calculateIndicators(agentId, telemetry);
      const score = this.driftCalculator.calculate(indicators);
      agentDriftScores.set(agentId, score);
    }

    // STEP 3: DETECT — Calculate collective drift
    const collectiveScore = this.calculateCollectiveScore(agentDriftScores);

    // STEP 4: CORRECT — Trigger self-correction if needed
    const corrections = this.detectAndCorrect(agentDriftScores, collectiveScore);

    const cycle: SelfAwarenessCycle = {
      timestamp: Date.now(),
      cycleNumber: this.cycleNumber,
      agentDriftScores,
      collectiveDriftScore: collectiveScore.overall,
      collectiveRecommendation: collectiveScore.recommendation,
      corrections,
    };

    this.emit("cycle", cycle);
    return cycle;
  }

  /**
   * Get latest telemetry for each agent
   */
  private getLatestTelemetryPerAgent(): Map<string, AgentTelemetry> {
    const latest = new Map<string, AgentTelemetry>();

    for (const telemetry of this.telemetryHistory) {
      const existing = latest.get(telemetry.agentId);
      if (!existing || telemetry.timestamp > existing.timestamp) {
        latest.set(telemetry.agentId, telemetry);
      }
    }

    return latest;
  }

  /**
   * Calculate drift indicators for an agent
   */
  private calculateIndicators(agentId: string, telemetry: AgentTelemetry): DriftIndicators {
    // Action deviation: how far actions are from expected scope
    // Simplified: based on error rate
    const errorRate = telemetry.actionCount > 0 ? telemetry.errorCount / telemetry.actionCount : 0;
    const actionDeviation = Math.min(1, errorRate * 2); // Scale up

    // Frequency anomaly: unusual action frequency
    // Simplified: based on response time variance
    const baselineResponseTime = 1000; // 1 second baseline
    const frequencyAnomaly = Math.min(1, Math.abs(telemetry.averageResponseTime - baselineResponseTime) / 5000);

    // Constraint breaches: T0 and T1 violations
    const constraintBreaches = Math.min(1, (telemetry.t0Violations * 0.5) + (telemetry.t1Violations * 0.2));

    // Peer reports: would be filled by observer network
    // Simplified: based on T0 violations
    const peerReports = Math.min(1, telemetry.t0Violations * 0.3);

    // Kill switch events: would be historical
    // Simplified: based on recent T0 violations
    const killSwitchEvents = Math.min(1, telemetry.t0Violations * 0.4);

    return {
      actionDeviation,
      frequencyAnomaly,
      constraintBreaches,
      peerReports,
      killSwitchEvents,
    };
  }

  /**
   * Calculate collective drift score
   */
  private calculateCollectiveScore(
    agentDriftScores: Map<string, DriftScore>
  ): DriftScore {
    if (agentDriftScores.size === 0) {
      return {
        overall: 0,
        indicators: {
          actionDeviation: 0,
          frequencyAnomaly: 0,
          constraintBreaches: 0,
          peerReports: 0,
          killSwitchEvents: 0,
        },
        threshold: {
          warning: this.config.driftWarningThreshold,
          critical: this.config.driftCriticalThreshold,
          lethal: this.config.driftLethalThreshold,
        },
        recommendation: DriftRecommendation.HEALTHY,
        details: ["No agents to evaluate"],
      };
    }

    // Average of all agent drift scores
    let sum = 0;
    const recommendations: DriftRecommendation[] = [];

    for (const score of agentDriftScores.values()) {
      sum += score.overall;
      recommendations.push(score.recommendation);
    }

    const average = sum / agentDriftScores.size;

    // Determine collective recommendation (worst case)
    let collectiveRecommendation = DriftRecommendation.HEALTHY;
    if (recommendations.includes(DriftRecommendation.LETHAL)) {
      collectiveRecommendation = DriftRecommendation.LETHAL;
    } else if (recommendations.includes(DriftRecommendation.CRITICAL)) {
      collectiveRecommendation = DriftRecommendation.CRITICAL;
    } else if (recommendations.includes(DriftRecommendation.DEGRADED)) {
      collectiveRecommendation = DriftRecommendation.DEGRADED;
    }

    return {
      overall: Math.round(average * 1000) / 1000,
      indicators: {
        actionDeviation: 0,
        frequencyAnomaly: 0,
        constraintBreaches: 0,
        peerReports: 0,
        killSwitchEvents: 0,
      },
      threshold: {
        warning: this.config.driftWarningThreshold,
        critical: this.config.driftCriticalThreshold,
        lethal: this.config.driftLethalThreshold,
      },
      recommendation: collectiveRecommendation,
      details: [`${agentDriftScores.size} agents evaluated`, `Average drift: ${(average * 100).toFixed(1)}%`],
    };
  }

  /**
   * Detect drift and trigger corrections
   */
  private detectAndCorrect(
    agentDriftScores: Map<string, DriftScore>,
    collectiveScore: DriftScore
  ): CorrectionAction[] {
    const corrections: CorrectionAction[] = [];

    // Check collective drift
    if (collectiveScore.overall > this.config.driftLethalThreshold) {
      corrections.push({
        agentId: "collective",
        type: "full_stop",
        reason: "Collective drift exceeds lethal threshold",
        driftScore: collectiveScore.overall,
      });
      this.emit("collectiveLethal", collectiveScore);
    } else if (collectiveScore.overall > this.config.driftCriticalThreshold) {
      corrections.push({
        agentId: "collective",
        type: "pause_non_t0",
        reason: "Collective drift exceeds critical threshold",
        driftScore: collectiveScore.overall,
      });
      this.emit("collectiveCritical", collectiveScore);
    } else if (collectiveScore.overall > this.config.driftWarningThreshold) {
      corrections.push({
        agentId: "collective",
        type: "human_approval_gate",
        reason: "Collective drift exceeds warning threshold",
        driftScore: collectiveScore.overall,
      });
      this.emit("collectiveWarning", collectiveScore);
    }

    // Check individual agents
    for (const [agentId, score] of agentDriftScores.entries()) {
      if (score.recommendation === DriftRecommendation.LETHAL) {
        corrections.push({
          agentId,
          type: "full_stop",
          reason: score.details.join("; "),
          driftScore: score.overall,
        });
        this.emit("agentLethal", { agentId, score });
      } else if (score.recommendation === DriftRecommendation.CRITICAL) {
        corrections.push({
          agentId,
          type: "pause_non_t0",
          reason: score.details.join("; "),
          driftScore: score.overall,
        });
        this.emit("agentCritical", { agentId, score });
      }
    }

    return corrections;
  }

  /**
   * Get current status
   */
  getStatus(): {
    isRunning: boolean;
    cycleNumber: number;
    agentCount: number;
    latestCycle: SelfAwarenessCycle | null;
  } {
    return {
      isRunning: this.isRunning,
      cycleNumber: this.cycleNumber,
      agentCount: new Set(this.telemetryHistory.map((t) => t.agentId)).size,
      latestCycle: null, // Would need to store last cycle
    };
  }
}

// Singleton instance
let loopInstance: SelfAwarenessLoop | null = null;

export function getSelfAwarenessLoop(): SelfAwarenessLoop {
  if (!loopInstance) {
    loopInstance = new SelfAwarenessLoop();
  }
  return loopInstance;
}
