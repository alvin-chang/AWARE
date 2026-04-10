// src/agents/session-manager.js
// Session Manager — Agent Identity & Authentication Framework
// Phase 3.1: Session lifecycle management, heartbeat, execution context
// Dependencies: IdentityProviderV2

const crypto = require('crypto');

/**
 * Session Manager
 * Manages agent session lifecycle including:
 * - Session creation and expiration
 * - Heartbeat tracking
 * - Execution context management
 * - Tool access control
 */
class SessionManager {
  constructor(config = {}) {
    this.config = {
      sessionTtlMs: config.sessionTtlMs || 15 * 60 * 1000, // 15 minutes default
      heartbeatIntervalMs: config.heartbeatIntervalMs || 60 * 1000, // 1 minute default
      maxMissedHeartbeats: config.maxMissedHeartbeats || 3,
      ...config
    };
    
    // Active sessions: sessionId -> session data
    this.activeSessions = new Map();
    
    // Session heartbeat tracking: sessionId -> last heartbeat timestamp
    this.heartbeatTracker = new Map();
    
    // Event handlers
    this.eventHandlers = {
      onSessionExpired: [],
      onSessionHeartbeatMissed: [],
      onSessionRevoked: []
    };
    
    // Cleanup interval for expired sessions
    this.cleanupInterval = setInterval(() => this._cleanupExpiredSessions(), 30 * 1000);
  }

  /**
   * Create a new session for an agent
   * @param {string} agentId - The agent's unique identifier
   * @param {object} executionContext - Execution context to bind
   * @param {object} metadata - Additional session metadata
   * @returns {object} Session data
   */
  createSession(agentId, executionContext = {}, metadata = {}) {
    const sessionId = this._generateSessionId();
    const now = Date.now();
    
    const session = {
      sessionId,
      agentId,
      executionContext: {
        workspace: executionContext.workspace || '/workspace/default',
        browserProfile: executionContext.browserProfile || 'default',
        maxConcurrentTasks: executionContext.maxConcurrentTasks || 3,
        allowedTools: executionContext.allowedTools || ['*'],
        deniedTools: executionContext.deniedTools || [],
        environment: executionContext.environment || 'production',
        ...executionContext
      },
      createdAt: now,
      expiresAt: now + this.config.sessionTtlMs,
      lastHeartbeat: now,
      heartbeatCount: 0,
      status: 'active',
      metadata
    };
    
    this.activeSessions.set(sessionId, session);
    this.heartbeatTracker.set(sessionId, now);
    
    return session;
  }

  /**
   * Generate a unique session ID
   * @private
   */
  _generateSessionId() {
    return `sess-${crypto.randomBytes(16).toString('hex')}`;
  }

  /**
   * Get a session by ID
   * @param {string} sessionId - The session ID
   * @returns {object|null} Session data or null
   */
  getSession(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return null;
    
    // Check if expired
    if (session.expiresAt < Date.now()) {
      this._expireSession(sessionId);
      return null;
    }
    
    return session;
  }

  /**
   * Update session heartbeat
   * @param {string} sessionId - The session ID
   * @param {object} updateData - Optional data to update
   * @returns {object} Updated session or null
   */
  heartbeat(sessionId, updateData = {}) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return { success: false, error: 'SESSION_NOT_FOUND' };
    }
    
    if (session.status !== 'active') {
      return { success: false, error: `Session not active (status: ${session.status})` };
    }
    
    const now = Date.now();
    session.lastHeartbeat = now;
    session.heartbeatCount += 1;
    
    // Update any provided data
    if (updateData.executionContext) {
      session.executionContext = {
        ...session.executionContext,
        ...updateData.executionContext
      };
    }
    if (updateData.metadata) {
      session.metadata = {
        ...session.metadata,
        ...updateData.metadata
      };
    }
    
    // Extend session expiry on heartbeat
    session.expiresAt = now + this.config.sessionTtlMs;
    
    this.heartbeatTracker.set(sessionId, now);
    
    return {
      success: true,
      sessionId,
      expiresAt: session.expiresAt,
      heartbeatCount: session.heartbeatCount
    };
  }

  /**
   * Check if a session is healthy (receiving heartbeats)
   * @param {string} sessionId - The session ID
   * @returns {object} Health status
   */
  checkHealth(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return { healthy: false, error: 'SESSION_NOT_FOUND' };
    }
    
    const now = Date.now();
    const timeSinceLastHeartbeat = now - this.heartbeatTracker.get(sessionId, session.lastHeartbeat);
    const missedHeartbeats = Math.floor(timeSinceLastHeartbeat / this.config.heartbeatIntervalMs);
    
    if (missedHeartbeats >= this.config.maxMissedHeartbeats) {
      this._markUnhealthy(sessionId, 'MAX_HEARTBEATS_MISSED');
      return {
        healthy: false,
        error: 'MAX_HEARTBEATS_MISSED',
        missedHeartbeats,
        threshold: this.config.maxMissedHeartbeats
      };
    }
    
    return {
      healthy: true,
      lastHeartbeat: session.lastHeartbeat,
      missedHeartbeats,
      threshold: this.config.maxMissedHeartbeats
    };
  }

  /**
   * Mark a session as unhealthy
   * @private
   */
  _markUnhealthy(sessionId, reason) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;
    
    session.status = 'unhealthy';
    session.unhealthyReason = reason;
    
    // Emit event
    this._emit('onSessionHeartbeatMissed', session, reason);
  }

  /**
   * Expire a session
   * @private
   */
  _expireSession(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.status = 'expired';
      this._emit('onSessionExpired', session);
    }
    this.activeSessions.delete(sessionId);
    this.heartbeatTracker.delete(sessionId);
  }

  /**
   * Revoke a session
   * @param {string} sessionId - The session ID
   * @param {string} reason - Revocation reason
   */
  revokeSession(sessionId, reason = 'manual') {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return { success: false, error: 'SESSION_NOT_FOUND' };
    }
    
    session.status = 'revoked';
    session.revokedAt = Date.now();
    session.revocationReason = reason;
    
    this._emit('onSessionRevoked', session, reason);
    this.activeSessions.delete(sessionId);
    this.heartbeatTracker.delete(sessionId);
    
    return { success: true, sessionId, reason };
  }

  /**
   * Extend session expiry
   * @param {string} sessionId - The session ID
   * @param {number} additionalMs - Additional time in milliseconds
   */
  extendSession(sessionId, additionalMs = null) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return { success: false, error: 'SESSION_NOT_FOUND' };
    }
    
    const extendBy = additionalMs || this.config.sessionTtlMs;
    session.expiresAt += extendBy;
    
    return {
      success: true,
      sessionId,
      expiresAt: session.expiresAt
    };
  }

  /**
   * Verify tool access for a session
   * @param {string} sessionId - The session ID
   * @param {string} toolName - The tool name
   * @returns {object} Access result
   */
  verifyToolAccess(sessionId, toolName) {
    const session = this.getSession(sessionId);
    if (!session) {
      return { allowed: false, error: 'SESSION_NOT_FOUND' };
    }
    
    if (session.status !== 'active') {
      return { allowed: false, error: `SESSION_NOT_ACTIVE (status: ${session.status})` };
    }
    
    const { allowedTools, deniedTools } = session.executionContext;
    
    // Check deny list first
    if (deniedTools.includes(toolName)) {
      return { allowed: false, error: 'TOOL_DENIED', tool: toolName };
    }
    
    // Check allow list
    if (allowedTools.includes('*')) {
      return { allowed: true };
    }
    
    if (!allowedTools.includes(toolName)) {
      return { allowed: false, error: 'TOOL_NOT_ALLOWED', tool: toolName };
    }
    
    return { allowed: true };
  }

  /**
   * Get all sessions for an agent
   * @param {string} agentId - The agent ID
   * @returns {array} Array of sessions
   */
  getAgentSessions(agentId) {
    const sessions = [];
    for (const session of this.activeSessions.values()) {
      if (session.agentId === agentId && session.status === 'active') {
        sessions.push(session);
      }
    }
    return sessions;
  }

  /**
   * List all active sessions
   * @returns {array} Array of active sessions
   */
  listActiveSessions() {
    const now = Date.now();
    const active = [];
    
    for (const session of this.activeSessions.values()) {
      if (session.expiresAt > now && session.status === 'active') {
        active.push(session);
      }
    }
    
    return active;
  }

  /**
   * Cleanup expired sessions
   * @private
   */
  _cleanupExpiredSessions() {
    const now = Date.now();
    for (const [sessionId, session] of this.activeSessions.entries()) {
      if (session.expiresAt < now) {
        this._expireSession(sessionId);
      }
    }
  }

  /**
   * Register an event handler
   * @param {string} event - Event name
   * @param {function} handler - Event handler function
   */
  on(event, handler) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].push(handler);
    }
  }

  /**
   * Emit an event
   * @private
   */
  _emit(event, ...args) {
    if (this.eventHandlers[event]) {
      for (const handler of this.eventHandlers[event]) {
        try {
          handler(...args);
        } catch (error) {
          console.error(`Error in ${event} handler:`, error);
        }
      }
    }
  }

  /**
   * Get session statistics
   * @returns {object} Statistics
   */
  getStats() {
    let active = 0;
    let unhealthy = 0;
    
    for (const session of this.activeSessions.values()) {
      if (session.status === 'active') active++;
      if (session.status === 'unhealthy') unhealthy++;
    }
    
    return {
      totalSessions: this.activeSessions.size,
      activeSessions: active,
      unhealthySessions: unhealthy,
      uptime: process.uptime()
    };
  }

  /**
   * Destroy the session manager
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.activeSessions.clear();
    this.heartbeatTracker.clear();
    this.eventHandlers = { onSessionExpired: [], onSessionHeartbeatMissed: [], onSessionRevoked: [] };
  }
}

module.exports = SessionManager;
