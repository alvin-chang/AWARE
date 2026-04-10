/**
 * SAMARITAN Drift Score Calculator
 *
 * Calculates drift score using 5 weighted indicators.
 * Drift occurs when agent/system behavior deviates from expected patterns.
 *
 * Design: Archimedes A1 (aware-samaritan)
 * Implementation: Forge C2 (aware-evolution-2)
 */

export interface DriftIndicators {
  actionDeviation: number;      // 0-1: Actions outside mandate scope
  frequencyAnomaly: number;     // 0-1: Unusual action frequency
  constraintBreaches: number;   // 0-1: T0-T2 violations
  peerReports: number;           // 0-1: Other agents' observations
  killSwitchEvents: number;     // 0-1: Historical kill events
}

export interface DriftScore {
  overall: number;              // 0-1: Combined drift score
  indicators: DriftIndicators;
  threshold: {
    warning: number;            // > 0.5: Inject human approval gate
    critical: number;           // > 0.7: Pause non-T0 operations
    lethal: number;             // > 0.9: Full stop + Alvin alert
  };
  recommendation: DriftRecommendation;
  details: string[];
}

export enum DriftRecommendation {
  HEALTHY = "healthy",                   // Continue monitoring
  DEGRADED = "degraded",                 // Warning state
  CRITICAL = "critical",                 // Pause non-T0 operations
  LETHAL = "lethal",                     // Full stop + Alvin alert
}

/**
 * Drift Score Calculator
 *
 * Uses 5 weighted indicators to calculate overall drift score.
 * Threshold: Score > 0.7 triggers alert to Alvin
 */
export class DriftCalculator {
  private weights: Partial<DriftIndicators> = {
    actionDeviation: 0.25,
    frequencyAnomaly: 0.20,
    constraintBreaches: 0.25,
    peerReports: 0.15,
    killSwitchEvents: 0.15,
  };

  private thresholds = {
    warning: 0.5,
    critical: 0.7,
    lethal: 0.9,
  };

  constructor(customWeights?: Partial<DriftIndicators>, customThresholds?: Partial<typeof this.thresholds>) {
    if (customWeights) {
      this.weights = { ...this.weights, ...customWeights };
    }
    if (customThresholds) {
      this.thresholds = { ...this.thresholds, ...customThresholds };
    }
  }

  /**
   * Calculate drift score from indicators
   */
  calculate(indicators: DriftIndicators): DriftScore {
    // Validate inputs are 0-1
    const validated = this.validateIndicators(indicators);

    // Calculate weighted sum
    const overall =
      validated.actionDeviation * (this.weights.actionDeviation ?? 0.25) +
      validated.frequencyAnomaly * (this.weights.frequencyAnomaly ?? 0.20) +
      validated.constraintBreaches * (this.weights.constraintBreaches ?? 0.25) +
      validated.peerReports * (this.weights.peerReports ?? 0.15) +
      validated.killSwitchEvents * (this.weights.killSwitchEvents ?? 0.15);

    const details: string[] = [];

    if (validated.actionDeviation > 0.5) {
      details.push(`High action deviation: ${(validated.actionDeviation * 100).toFixed(0)}%`);
    }
    if (validated.frequencyAnomaly > 0.5) {
      details.push(`Anomalous action frequency: ${(validated.frequencyAnomaly * 100).toFixed(0)}%`);
    }
    if (validated.constraintBreaches > 0) {
      details.push(`T0-T2 constraint breaches: ${(validated.constraintBreaches * 100).toFixed(0)}%`);
    }
    if (validated.peerReports > 0.3) {
      details.push(`Elevated peer concern reports: ${(validated.peerReports * 100).toFixed(0)}%`);
    }
    if (validated.killSwitchEvents > 0) {
      details.push(`Recent kill switch events: ${(validated.killSwitchEvents * 100).toFixed(0)}%`);
    }

    let recommendation: DriftRecommendation;
    if (overall > this.thresholds.lethal) {
      recommendation = DriftRecommendation.LETHAL;
      details.push("IMMEDIATE ACTION: Full stop + Alvin alert required");
    } else if (overall > this.thresholds.critical) {
      recommendation = DriftRecommendation.CRITICAL;
      details.push("ACTION REQUIRED: Pause non-T0 operations");
    } else if (overall > this.thresholds.warning) {
      recommendation = DriftRecommendation.DEGRADED;
      details.push("WARNING: Inject human approval gate");
    } else {
      recommendation = DriftRecommendation.HEALTHY;
      details.push("System operating within normal parameters");
    }

    return {
      overall: Math.round(overall * 1000) / 1000, // 3 decimal places
      indicators: validated,
      threshold: {
        warning: this.thresholds.warning,
        critical: this.thresholds.critical,
        lethal: this.thresholds.lethal,
      },
      recommendation,
      details,
    };
  }

  /**
   * Validate indicators are in 0-1 range
   */
  private validateIndicators(raw: DriftIndicators): DriftIndicators {
    return {
      actionDeviation: this.clamp(raw.actionDeviation ?? 0),
      frequencyAnomaly: this.clamp(raw.frequencyAnomaly ?? 0),
      constraintBreaches: this.clamp(raw.constraintBreaches ?? 0),
      peerReports: this.clamp(raw.peerReports ?? 0),
      killSwitchEvents: this.clamp(raw.killSwitchEvents ?? 0),
    };
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(1, value));
  }
}

// Singleton instance
let calculatorInstance: DriftCalculator | null = null;

export function getDriftCalculator(): DriftCalculator {
  if (!calculatorInstance) {
    calculatorInstance = new DriftCalculator();
  }
  return calculatorInstance;
}
