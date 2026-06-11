// AWARE 2.0 coordinator service — entry point
// Per ADR-020 Decision 1: persistent coordinator session + lightweight task workers
//
// This is the v0 stub. Phase 1 of the build replaces it with:
//   - 7-service Docker Compose (gateway, frontend, coordinator, worker, ollama, memory, trainer)
//   - 3-tier model router (minimax → Ollama offline fallback)
//   - task worker pool with bounded concurrency
//   - T0-T4 constraint enforcement (delegated to existing v1.0 policy engine)

import { awareHeavyThink } from './heavyskill-integration.js';

export const COORDINATOR_VERSION = '0.1.0-stub';
export const COORDINATOR_BUILD_PHASE = 'pre-phase-1';

export async function coordinate({ problem, task_type, context, K, client, sessionId, agentId }) {
  return await awareHeavyThink({
    problem,
    task_type: task_type || 'standard',
    context: { ...context, sessionId, agentId },
    K,
    client,
  });
}

export { awareHeavyThink } from './heavyskill-integration.js';
