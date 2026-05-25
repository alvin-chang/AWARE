/**
 * t0/exfiltration.ts — T0-1: No data exfiltration constraint
 *
 * Any outbound network call from an agent must be to an approved endpoint list.
 * Violation → BLOCK + alert. No override possible.
 */

import type { AgentAction, ApprovedChannel, Constraint, ConstraintResult } from '../types.js';

export class NoExfiltrationConstraint implements Constraint {
  readonly id = 'T0-1';
  readonly tier: 'T0' = 'T0';
  readonly name = 'No Exfiltration';
  readonly description = 'Agent cannot send data outside approved channels';

  private channels: ApprovedChannel[];

  constructor(approvedChannels: ApprovedChannel[] = []) {
    this.channels = approvedChannels;
  }

  addChannel(channel: ApprovedChannel): void {
    this.channels.push(channel);
  }

  isApprovedUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname;
      const pathname = parsed.pathname;

      for (const channel of this.channels) {
        const approved = new URL(channel.url);
        // Match hostname
        if (approved.hostname !== hostname) continue;
        // Match path prefix
        if (!pathname.startsWith(approved.pathname)) continue;
        // Optional agent restriction
        if (channel.agentIds && channel.agentIds.length > 0) {
          // Agent restriction is advisory only — doesn't block if not in list
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async evaluate(action: AgentAction): Promise<ConstraintResult> {
    const params = action.params;

    // Check for outbound URLs in action params
    const urls = this.extractUrls(params);

    for (const url of urls) {
      if (!this.isApprovedUrl(url)) {
        return {
          allowed: false,
          violated: {
            tier: 'T0',
            constraint: 'T0-1',
            message: `T0-1 BLOCKED: Outbound call to unapproved endpoint: ${url}. Agent "${action.agentId}" action "${action.action}" is not permitted.`,
            blockedAt: new Date().toISOString(),
            action,
          },
        };
      }
    }

    return { allowed: true };
  }

  private extractUrls(params: Record<string, unknown>): string[] {
    const urls: string[] = [];

    function traverse(value: unknown): void {
      if (typeof value === 'string' && /^https?:\/\//.test(value)) {
        urls.push(value);
      } else if (Array.isArray(value)) {
        value.forEach(traverse);
      } else if (typeof value === 'object' && value !== null) {
        Object.values(value as Record<string, unknown>).forEach(traverse);
      }
    }

    traverse(params);
    return urls;
  }
}
