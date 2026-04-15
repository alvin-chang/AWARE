# AWARE A2 Research — KG Event Routing (Scout)
**For:** Archimedes | **Date:** 2026-04-15
**Questions:** sessions_send from plugin, subscription schema, idempotency

---

## Question 1: sessions_send from Plugin Hook — Security Constraints

**Short answer:** Possible, but with architectural caveats.

**How it would work:**
The plugin runs inside the OpenClaw Node.js process. It could call `sendMessage()` directly from `src/infra/outbound/message.ts` — same function the gateway uses for `sessions_send`. This bypasses the tool layer entirely.

**Security constraints to consider:**

| Concern | Detail | Mitigations |
|---------|--------|-------------|
| Plugin executing arbitrary agents | Plugin could send to any agentId | Whitelist: only send to agents listed in routing rules |
| Message injection | Malicious plugin payload could spoof events | Events come from internal hook context (not user-controlled) |
| No gateway auth in hook | Hook runs in-agent, not via gateway API | Use internal `sendMessage()` not external API; plugin IS part of the trust boundary |
| Blocking I/O | `sendMessage` is async; hook is async but... | Don't await in the hot path; fire-and-forget with retry queue |

**Alternative architecture (more controlled):**
- Plugin writes KG fact only
- Gateway has an event subscriber that reads routed events from KG
- Gateway handles all `sessions_send` delivery
- Plugin never calls `sendMessage` directly

**Recommendation for A2:** The plugin should write to KG + emit an internal event via `emitAgentEvent()` (already in the event registry). The gateway subscribes to those events and handles routing. This keeps routing logic in the gateway, not in the plugin.

---

## Question 2: Subscription Config Schema — Where Do Agents Declare Subscriptions?

**Short answer:** Doesn't exist yet. Needs to be created.

**Two options:**

### Option A: Per-agent config in `openclaw.json`

```json
{
  "agents": {
    "researcher": {
      "subscriptions": {
        "deliverable_ready": "architect",
        "blocker_detected": "orchestrator",
        "phase_complete": "orchestrator"
      }
    },
    "architect": {
      "subscriptions": {
        "deliverable_ready": "coder",
        "phase_complete": "orchestrator"
      }
    }
  }
}
```

**Pros:** Single config file, per-agent, natural fit
**Cons:** Requires config schema change, affects openclaw.json

### Option B: Separate `routing-rules.json` in plugin config

```json
{
  "routing": {
    "researcher": {
      "deliverable_ready": ["architect"],
      "blocker_detected": ["orchestrator"]
    },
    "architect": {
      "deliverable_ready": ["coder"],
      "phase_complete": ["orchestrator"]
    }
  }
}
```

**Pros:** No config schema change, plugin-owned
**Cons:** Separate file, must be loaded by plugin

### Option C: KG-stored routing rules

Store subscriptions as KG triples:
```
(researcher, subscribes_to, deliverable_ready)
(researcher, subscribes_to, blocker_detected)
```

**Pros:** Queryable, dynamic, no config file
**Cons:** Bootstrap problem: how does agent read its subscriptions on startup?

### Recommendation for A2: **Option A (openclaw.json)**

Rationale:
- Consistent with how agents declare other configs (model, tools, workspace)
- No bootstrap problem
- Gateway already reads openclaw.json for agent routing
- Plugin can read via config passed to hook

Schema addition would be:
```typescript
// In schema.base.generated.ts agent config
subscriptions?: Record<PredicateType, AgentId[]>
```

---

## Question 3: Idempotency — Preventing Duplicate Routing

**Short answer:** KB suggestion is correct. Implementation detail: use a deduplication cache with (subject, predicate, object, sessionId) as key + 5-minute TTL.

**Current problem:** `agent_end` can fire multiple times for the same task if:
- Session crashes and restarts
- Gateway retries the event delivery
- Multiple concurrent sessions for same agent

**Deduplication key:** `(subject, predicate, object, sessionId)`

Note: `taskId` may not always be present in the event. Use `sessionId` as the reliable unique identifier for the session that produced the event.

**Implementation (in-memory cache in plugin):**

```typescript
const recentRouted = new Map<string, number>(); // key → timestamp

function isDuplicate(subject: string, predicate: string, object: string, sessionId: string): boolean {
  const key = `${subject}|${predicate}|${object}|${sessionId}`;
  const lastSeen = recentRouted.get(key);
  if (lastSeen && Date.now() - lastSeen < 5 * 60 * 1000) {
    return true; // skip
  }
  recentRouted.set(key, Date.now());
  // Prune old entries periodically
  return false;
}
```

**TTL consideration:** 5 minutes is in the KB. Should this be configurable? Probably — suggest `routingDedupeTTLMs` in plugin config (default 5 min).

**What happens if we route twice:**
- Target agent receives duplicate prependContext
- Non-critical but ugly
- Better to deduplicate than to deal with dupes

**Alternative: Use MemPalace KG itself for deduplication:**
- Before routing, write a "routing marker" triple: `(subject, predicate, object, routed_at)`
- On next `agent_end`, query whether this fact was already routed
- More persistent, survives plugin restart
- But: extra KG write on every event = slower

**Recommendation for A2:** In-memory cache with TTL (Option 1). Simpler, faster, sufficient for the duplicate case. KG persistence is overkill unless the deduplication problem proves real.

---

## A2 Synthesis for Archimedes

| Question | Finding | Recommendation |
|----------|---------|----------------|
| sessions_send from hook | Possible via `sendMessage()` import, but security boundary concern | Prefer: plugin writes KG + emits internal event; gateway subscribes and routes |
| Subscription schema | Doesn't exist yet | Option A: add to openclaw.json per-agent config |
| Idempotency | Use (subject, predicate, object, sessionId) + 5-min TTL in-memory cache | Correct approach; add configurable TTL via plugin config |

**Key architectural decision needed:**
The choice between "plugin does routing" vs "gateway does routing" is fundamental.

- **Plugin routes:** plugin calls `sendMessage` directly → simpler, but plugin has routing responsibility
- **Gateway routes:** plugin emits event → gateway subscribes → gateway calls `sendMessage` → more controlled, gateway is already the message router

Given that `sessions_send` is already gateway-mediated, the gateway-as-router is cleaner. The plugin just emits events and writes KG facts. The gateway handles delivery.

Full research delivered. Ready for A2 design completion.