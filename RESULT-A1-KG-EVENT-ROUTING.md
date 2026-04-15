# AWARE A1 — KG Event Routing Research
**Task:** Investigate what events to route and how for KG event routing
**Agent:** Scout (Researcher) | **Date:** 2026-04-15
**BMAD Method:** Small/Medium — minimal process, AWARE cycle applies

---

## 1. Current session_start.ts Flow

```
Session starts (every prompt/heartbeat)
  → mempalace-openclaw plugin fires session_start hook
  → Hook reads:
       • Diary entries (last 10) for this agent
       • KG facts for this agent (by agentLabel, e.g. "researcher")
       • Pending/blocked search (top 3 in agent's wing)
  → Builds <mempalace_context> block:
       <mempalace_context>
       Recent Diary: [entries]
       KG Facts: [facts]
       Operations: [pending/blocked search]
       </mempalace_context>
  → Prepends to agent prompt as L0/L1 context
```

**Current behavior:**
- Every prompt/heartbeat triggers the hook (not just session start)
- KG query is shallow: `kg_query(entity=agentLabel)` — no time filter, no event filter
- No routing logic based on event type
- Hook is READ-ONLY at startup — no event-driven routing

---

## 2. What Events Exist (from OpenClaw event registry)

| Event | When Fired | Used by mempalace-openclaw? |
|-------|-----------|----------------------------|
| `agent_end` | Session closes | ✅ YES — KG extraction + diary on close |
| `task_end` | Logical task unit completes | ❌ NOT USED — persistent agents only |
| `task_queued` | New task submitted to queue | ❌ NOT USED |
| `heartbeat_pulse` | Heartbeat cycle completes | ❌ NOT USED |
| `cron_tick` | Cron job fires | ❌ NOT USED |

**Key finding:** `task_end` and `heartbeat_pulse` are currently unused by mempalace-openclaw. These are the natural trigger points for event-driven KG routing.

---

## 3. What Events SHOULD Trigger Routing

### High-Value Events for KG Routing

| Event | Trigger Condition | Routing Value |
|-------|------------------|---------------|
| `task_end` | Agent completes a discrete unit of work | High — tells OTHER agents what was done |
| `cron_tick` | Cron fires for agent X | High — other agents know X is active |
| `heartbeat_pulse` | Agent heartbeat | Low — too frequent, mostly nominal |
| `agent_end` | Session closes | Medium — useful for completion summaries |

### Recommended Triggers (in priority order)

1. **`task_end` (HIGHEST)** — clearest signal of work completion
   - "Agent X completed task Y"
   - Other agents can update their context accordingly
   - Example: "researcher completed R2 research" → `researcher → architect` (handoff)

2. **`cron_tick` (HIGH)** — scheduling signal
   - "Agent X's cron fired for task Y"
   - Useful for coordination and dependency tracking
   - Example: "researcher heartbeat fired" → routing agents know Scout is alive/active

3. **`agent_end` (MEDIUM)** — session completion
   - Already partially handled by mempalace-openclaw (KG extraction)
   - Could also signal handoff completion

4. **`heartbeat_pulse` (LOW)** — too frequent, mostly noise
   - Would spam KG with nominal entries
   - Not recommended unless specifically needed

---

## 4. Who Should Receive Each Event Type

### Routing by Agent Role and Event Type

| Event | Primary Recipient(s) | Routing Reason |
|-------|---------------------|---------------|
| `task_end:researcher` | `orchestrator`, `architect` | R1 completion → next phase gate |
| `task_end:architect` | `orchestrator`, `coder` | Architecture done → implementation starts |
| `task_end:coder` | `reviewer`, `orchestrator` | Code done → review gate |
| `task_end:reviewer` | `orchestrator`, `tester` | Review done → testing gate |
| `task_end:tester` | `orchestrator`, `scribe` | Tests done → docs gate |
| `cron_tick:*` | `orchestrator` | Coordination — knows what's active |
| `agent_end:*` | `orchestrator` | Session tracking |

### Routing by Project Context

| Project | Events | Recipients |
|---------|--------|-----------|
| `aware` | `task_end:researcher` | `architect` (hand off R1 findings) |
| `aware` | `task_end:architect` | `coder` (hand off A2 design) |
| `bug-bounty` | `task_end:researcher` | `orchestrator` (submission ready) |
| `autonomous-revenue` | `cron_tick:researcher` | `orchestrator` (daily brief done) |

---

## 5. Current KG Query Limitations (at session start)

Current query at startup:
```
kg_query(entity=agentLabel)
  — No time filter (gets ALL facts, ever)
  — No event type filter
  — No project context filter
  — Only queries by name string
```

**Problem:** If an agent has done 100 sessions, kg_query returns all 100 sessions of facts. No recency filter. No event-type filtering.

**What should happen instead:**
- Query by `(subject=agentLabel, predicate=completed_task, window=past_24h)` — recent only
- Or: query by `predicate=task_output` to find recent deliverables
- Filter by project/phase context

---

## 6. Proposed Event → Routing Architecture

```
Event fires (task_end / cron_tick / agent_end)
  → mempalace-openclaw extracts:
       - Event type (task_end / cron_tick / agent_end)
       - Agent ID (who fired it)
       - Session/Task ID
       - Timestamp
       - Outcome (success/failure)
       - Project context (from session tags)
  → Query KG: "what does recipient agent need to know?"
  → Write KG triple: (agentId, event_type, targetAgentId)
  → On target agent's next session_start: inject relevant KG facts
```

### Session_start changes needed:
1. Accept event type as parameter
2. Query KG by `(subject=other_agent, predicate=pending_task_for_me)`
3. Include pending tasks in `<mempalace_context>` when relevant

---

## 7. Open Questions for Archimedes (A2)

1. **Event schema** — Does `task_end` include `taskId` and `project` fields? Can we extract project context from the event?
2. **Routing rule storage** — Where do routing rules live? (config file, KG, hardcoded in plugin?)
3. **Recipient resolution** — How do we map event → target agents? (agentId → sessionKey lookup)
4. **KG write on event** — Should we write the event itself to KG as a triple, or only write when routing decision is made?
5. **No new event types** — We cannot add new OpenClaw event types without modifying core. Use existing events.

---

## 8. A1 Summary for Archimedes

**What we have:**
- OpenClaw event registry with 5 event types (`agent_end`, `task_end`, `task_queued`, `heartbeat_pulse`, `cron_tick`)
- mempalace-openclaw hook system that fires on session start
- KG system (`kg_query`, `kg_add`, `kg_invalidate`) accessible from hooks
- Existing `task_end` subscription in mempalace-openclaw (commented out) — just needs enabling

**What we need:**
- Enable `task_end` → KG write (already structurally ready, just commented out)
- Add routing logic: which agent → which event → which other agents get notified
- Session_start hook needs to query KG for "things pending for me" not just "all facts about me"
- Store routing rules somewhere (KG? Config? Plugin code?)

**The simplest version:**
1. On `task_end`: write triple `(agentId, completed_task, taskId)`
2. On `session_start` for agent X: query "what tasks were completed targeting me?"
3. Inject task completions in context block

**Complexity scaling:** If routing rules are simple (agent → specific other agent), hardcode in plugin. If complex (project-aware, conditional), store in KG or config file.

---

**Deliverable:** This document is the A1 research input for Archimedes A2 (routing architecture design).