// src/agents/registry.js
// Agent Registry Service - Central registry for all Non-Human Identities (NHIs)
// Phase 1.1: Agent Identity Layer

const { Agent, AgentState } = require('../api/models/Agent');
const crypto = require('crypto');

class AgentRegistry {
  constructor(config = {}) {
    this.config = {
      defaultClearance: config.defaultClearance || 'internal_only',
      defaultCapabilities: config.defaultCapabilities || [],
      ...config
    };
  }

  // Register a new agent (onboarding)
  register(agentData) {
    const agent = Agent.create({
      agentId: agentData.agentId,
      name: agentData.name,
      type: agentData.type,
      model: agentData.model,
      version: agentData.version,
      capabilities: agentData.capabilities || this.config.defaultCapabilities,
      clearance: agentData.clearance || this.config.defaultClearance,
      metadata: {
        ...agentData.metadata,
        registeredBy: agentData.registeredBy || 'system',
        registrationSource: agentData.registrationSource || 'api'
      },
      state: AgentState.ACTIVE
    });

    return agent;
  }

  // Look up agent by agentId
  lookup(agentId) {
    return Agent.findByAgentId(agentId);
  }

  // Look up agent by internal ID
  lookupById(id) {
    return Agent.findById(id);
  }

  // List all agents (optionally filtered)
  list(filter = {}) {
    let agents = Agent.findAll(filter.state);
    
    if (filter.type) {
      agents = agents.filter(a => a.type === filter.type);
    }
    
    if (filter.clearance) {
      agents = agents.filter(a => a.clearance === filter.clearance);
    }
    
    return agents;
  }

  // Update agent capabilities
  updateCapabilities(id, capabilities) {
    const agent = Agent.findById(id);
    if (!agent) {
      return null;
    }
    
    return Agent.update(id, { capabilities });
  }

  // Update trust score
  updateTrustScore(id, newScore) {
    const agent = Agent.findById(id);
    if (!agent) {
      return null;
    }
    
    agent.updateTrustScore(newScore);
    Agent.saveAgent(agent);
    return agent;
  }

  // Record heartbeat for agent
  heartbeat(agentId) {
    const agent = Agent.findByAgentId(agentId);
    if (!agent) {
      return { success: false, error: 'Agent not found' };
    }
    
    if (agent.state !== AgentState.ACTIVE) {
      return { success: false, error: `Agent not operational (state: ${agent.state})` };
    }
    
    agent.touch();
    Agent.saveAgent(agent);
    
    return { success: true, lastSeenAt: agent.lastSeenAt, trustScore: agent.trustScore };
  }

  // Revoke agent (kill switch)
  revoke(agentId, reason = 'manual') {
    const agent = Agent.findByAgentId(agentId);
    if (!agent) {
      return { success: false, error: 'Agent not found' };
    }
    
    try {
      const revoked = Agent.revoke(agent.id, reason);
      return { success: true, agent: revoked };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Suspend agent
  suspend(agentId) {
    const agent = Agent.findByAgentId(agentId);
    if (!agent) {
      return { success: false, error: 'Agent not found' };
    }
    
    try {
      agent.transitionTo(AgentState.SUSPENDED);
      Agent.saveAgent(agent);
      return { success: true, agent };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Activate/reinstate agent
  activate(agentId) {
    const agent = Agent.findByAgentId(agentId);
    if (!agent) {
      return { success: false, error: 'Agent not found' };
    }
    
    try {
      agent.transitionTo(AgentState.ACTIVE);
      Agent.saveAgent(agent);
      return { success: true, agent };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Decommission agent
  decommission(agentId) {
    const agent = Agent.findByAgentId(agentId);
    if (!agent) {
      return { success: false, error: 'Agent not found' };
    }
    
    const decommissioned = Agent.decommission(agent.id);
    return { success: true, agent: decommissioned };
  }

  // Verify agent credentials
  verify(agentId, credential) {
    const agent = Agent.findByAgentId(agentId);
    if (!agent) {
      return { valid: false, error: 'Agent not found' };
    }
    
    const isValid = agent.credentials.current === credential;
    
    return {
      valid: isValid && agent.state === AgentState.ACTIVE,
      agentId: agent.agentId,
      state: agent.state,
      clearance: agent.clearance,
      capabilities: agent.capabilities
    };
  }

  // Rotate agent credentials
  rotateCredentials(agentId) {
    const agent = Agent.findByAgentId(agentId);
    if (!agent) {
      return { success: false, error: 'Agent not found' };
    }
    
    if (agent.state !== AgentState.ACTIVE) {
      return { success: false, error: `Cannot rotate credentials for agent in ${agent.state} state` };
    }
    
    const newCredential = agent.rotateCredentials();
    Agent.saveAgent(agent);
    
    return {
      success: true,
      agentId: agent.agentId,
      rotatedAt: agent.credentials.rotatedAt
    };
  }

  // Get operational agents (ACTIVE state only)
  getOperationalAgents() {
    return Agent.findAll(AgentState.ACTIVE);
  }

  // Get agents by type
  getAgentsByType(type) {
    return Agent.findAll().filter(a => a.type === type && a.state === AgentState.ACTIVE);
  }

  // Get trust scores for all agents
  getTrustScores() {
    const agents = Agent.findAll();
    return agents.map(a => ({
      agentId: a.agentId,
      type: a.type,
      trustScore: a.trustScore,
      state: a.state,
      lastSeenAt: a.lastSeenAt
    }));
  }
}

module.exports = AgentRegistry;
