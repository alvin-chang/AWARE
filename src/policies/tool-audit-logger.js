// src/policies/tool-audit-logger.js
// Tool Audit Logger — Logs all tool invocations for compliance and security
// ADR (internal): Tool Access Control & Enforcement

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

/**
 * Tool Audit Logger — Logs all tool observations and executions
 *
 * Provides:
 * 1. Tool observation logging (every call, before allow/deny)
 * 2. Tool execution logging (outcome)
 * 3. Security event logging (denials, shadow detections)
 * 4. Compliance evidence collection
 */
class ToolAuditLogger extends EventEmitter {
  /**
   * @param {Object} config - Configuration
   * @param {string} config.logDir - Directory for log files
   * @param {number} config.retentionDays - Days to retain logs
   * @param {boolean} config.enableConsole - Enable console logging
   */
  constructor(config = {}) {
    super();
    this.logDir = config.logDir || '/aware/logs/audit';
    this.retentionDays = config.retentionDays || 90;
    this.enableConsole = config.enableConsole !== false;

    // Ensure log directory exists
    this.ensureLogDir();

    // In-memory buffer for batch writing
    this.buffer = [];
    this.bufferSize = config.bufferSize || 100;
    this.flushIntervalMs = config.flushIntervalMs || 5000;
    this.lastFlush = Date.now();

    // Start flush timer
    this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs);
  }

  /**
   * Ensure log directory exists
   */
  ensureLogDir() {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (error) {
      console.error(`Failed to create audit log directory: ${error.message}`);
    }
  }

  /**
   * Get log file path for current date
   * @param {string} prefix - Log prefix (observations, executions, security)
   * @returns {string}
   */
  getLogFilePath(prefix = 'audit') {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return path.join(this.logDir, `${prefix}-${date}.jsonl`);
  }

  /**
   * Write log entry to buffer
   * @param {Object} entry - Log entry
   */
  writeLogEntry(entry) {
    const line = JSON.stringify(entry) + '\n';

    // Console output
    if (this.enableConsole) {
      console.log(`[AUDIT] ${entry.event || 'LOG'}: ${JSON.stringify(entry)}`);
    }

    // Buffer for batch write
    this.buffer.push(line);

    // Flush if buffer full
    if (this.buffer.length >= this.bufferSize) {
      this.flush();
    }
  }

  /**
   * Flush buffer to disk
   */
  async flush() {
    if (this.buffer.length === 0) return;

    const entries = this.buffer.splice(0, this.buffer.length);
    const now = Date.now();

    if (now - this.lastFlush > this.flushIntervalMs) {
      this.lastFlush = now;
    }

    // Write to appropriate log files based on event type
    try {
      const observationEntries = entries.filter(l => {
        try {
          const e = JSON.parse(l);
          return e.event === 'TOOL_OBSERVATION';
        } catch {
          return false;
        }
      });

      const executionEntries = entries.filter(l => {
        try {
          const e = JSON.parse(l);
          return e.event === 'TOOL_EXECUTION';
        } catch {
          return false;
        }
      });

      const securityEntries = entries.filter(l => {
        try {
          const e = JSON.parse(l);
          return [
            'TOOL_ACCESS_DENIED',
            'SHADOW_TOOL_DETECTED',
            'ANOMALOUS_USAGE',
            'PARAMETER_VALIDATION_FAILED'
          ].includes(e.event);
        } catch {
          return false;
        }
      });

      if (observationEntries.length > 0) {
        fs.appendFileSync(this.getLogFilePath('observations'), observationEntries.join(''));
      }

      if (executionEntries.length > 0) {
        fs.appendFileSync(this.getLogFilePath('executions'), executionEntries.join(''));
      }

      if (securityEntries.length > 0) {
        fs.appendFileSync(this.getLogFilePath('security'), securityEntries.join(''));
      }

      // Write all to combined audit log
      fs.appendFileSync(this.getLogFilePath('audit'), entries.join(''));

    } catch (error) {
      console.error(`Failed to flush audit log: ${error.message}`);
      // Put entries back in buffer on failure
      this.buffer.unshift(...entries);
    }
  }

  /**
   * Log a tool observation (every call before allow/deny)
   * @param {Object} observation - Tool observation
   */
  async logToolObservation(observation) {
    const entry = {
      event: 'TOOL_OBSERVATION',
      timestamp: observation.timestamp || Date.now(),
      agentId: observation.agentId,
      sessionId: observation.sessionId,
      role: observation.role,
      toolId: observation.toolId,
      parameters: this.sanitizeParameters(observation.parameters),
      callSource: observation.callSource || 'direct'
    };

    this.writeLogEntry(entry);
    this.emit('observation', entry);

    return entry;
  }

  /**
   * Log a tool execution (after execution)
   * @param {Object} execution - Execution details
   */
  async logToolExecution(execution) {
    const entry = {
      event: 'TOOL_EXECUTION',
      timestamp: Date.now(),
      observation: {
        agentId: execution.agentId,
        sessionId: execution.sessionId,
        toolId: execution.toolId,
        parameters: this.sanitizeParameters(execution.parameters)
      },
      success: execution.success,
      result: execution.result,
      error: execution.error,
      durationMs: execution.durationMs
    };

    this.writeLogEntry(entry);
    this.emit('execution', entry);

    return entry;
  }

  /**
   * Log a security event
   * @param {Object} securityEvent - Security event
   */
  async logSecurityEvent(securityEvent) {
    const entry = {
      event: securityEvent.type || 'SECURITY_EVENT',
      timestamp: Date.now(),
      agentId: securityEvent.agentId,
      sessionId: securityEvent.sessionId,
      toolId: securityEvent.toolId,
      reason: securityEvent.reason,
      details: securityEvent.details,
      alert: securityEvent.alert,
      shadowState: securityEvent.state
    };

    this.writeLogEntry(entry);
    this.emit('security', entry);

    // Emit critical alert for denied access
    if (entry.event === 'TOOL_ACCESS_DENIED') {
      this.emit('accessDenied', entry);
    }

    return entry;
  }

  /**
   * Log parameter validation failure
   * @param {Object} validation - Validation result
   */
  async logValidationFailure(validation) {
    const entry = {
      event: 'PARAMETER_VALIDATION_FAILED',
      timestamp: Date.now(),
      agentId: validation.agentId,
      sessionId: validation.sessionId,
      toolId: validation.toolId,
      errors: validation.errors
    };

    this.writeLogEntry(entry);
    this.emit('validationFailed', entry);

    return entry;
  }

  /**
   * Sanitize parameters for logging (remove sensitive data)
   * @param {Object} parameters - Parameters to sanitize
   * @returns {Object}
   */
  sanitizeParameters(parameters) {
    if (!parameters) return {};

    const sensitiveKeys = [
      'password', 'secret', 'token', 'api_key', 'apikey',
      'credential', 'private_key', 'privatekey', 'authorization',
      'bearer', 'passwd', 'passw0rd'
    ];

    const sanitized = {};
    for (const [key, value] of Object.entries(parameters)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some(s => lowerKey.includes(s))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object') {
        sanitized[key] = this.sanitizeParameters(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Query audit logs
   * @param {Object} query - Query parameters
   * @returns {Promise<Array>}
   */
  async query(query = {}) {
    const {
      eventType,
      agentId,
      toolId,
      startTime,
      endTime,
      limit = 1000
    } = query;

    const results = [];
    const logFile = this.getLogFilePath('audit');

    try {
      if (!fs.existsSync(logFile)) {
        return results;
      }

      const content = fs.readFileSync(logFile, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);

          if (eventType && entry.event !== eventType) continue;
          if (agentId && entry.agentId !== agentId) continue;
          if (toolId && entry.toolId !== toolId) continue;
          if (startTime && entry.timestamp < startTime) continue;
          if (endTime && entry.timestamp > endTime) continue;

          results.push(entry);

          if (results.length >= limit) break;
        } catch {
          // Skip invalid lines
        }
      }
    } catch (error) {
      console.error(`Failed to query audit logs: ${error.message}`);
    }

    return results;
  }

  /**
   * Get compliance evidence for a time period
   * @param {number} startTime - Start timestamp
   * @param {number} endTime - End timestamp
   * @returns {Promise<Object>}
   */
  async getComplianceEvidence(startTime, endTime) {
    const events = await this.query({ startTime, endTime, limit: 10000 });

    const evidence = {
      period: { startTime, endTime },
      totalObservations: events.filter(e => e.event === 'TOOL_OBSERVATION').length,
      totalExecutions: events.filter(e => e.event === 'TOOL_EXECUTION').length,
      successfulExecutions: events.filter(e => e.event === 'TOOL_EXECUTION' && e.success).length,
      failedExecutions: events.filter(e => e.event === 'TOOL_EXECUTION' && !e.success).length,
      accessDenials: events.filter(e => e.event === 'TOOL_ACCESS_DENIED').length,
      shadowDetections: events.filter(e => e.event === 'SHADOW_TOOL_DETECTED').length,
      anomalousUsages: events.filter(e => e.event === 'ANOMALOUS_USAGE').length,
      validationFailures: events.filter(e => e.event === 'PARAMETER_VALIDATION_FAILED').length,
      agents: {},
      tools: {}
    };

    // Aggregate by agent
    for (const event of events) {
      const agentId = event.agentId;
      if (!evidence.agents[agentId]) {
        evidence.agents[agentId] = {
          totalCalls: 0,
          denials: 0,
          tools: new Set()
        };
      }
      evidence.agents[agentId].totalCalls++;
      if (event.event === 'TOOL_ACCESS_DENIED') {
        evidence.agents[agentId].denials++;
      }
      if (event.toolId) {
        evidence.agents[agentId].tools.add(event.toolId);
      }
    }

    // Convert sets to counts
    for (const agentId of Object.keys(evidence.agents)) {
      evidence.agents[agentId].toolCount = evidence.agents[agentId].tools.size;
      delete evidence.agents[agentId].tools;
    }

    return evidence;
  }

  /**
   * Cleanup old log files
   */
  cleanup() {
    try {
      const files = fs.readdirSync(this.logDir);
      const cutoff = Date.now() - (this.retentionDays * 24 * 60 * 60 * 1000);

      for (const file of files) {
        const filePath = path.join(this.logDir, file);
        const stats = fs.statSync(filePath);

        if (stats.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          console.log(`Deleted old audit log: ${file}`);
        }
      }
    } catch (error) {
      console.error(`Failed to cleanup audit logs: ${error.message}`);
    }
  }

  /**
   * Stop the logger
   */
  stop() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.flush();
  }
}

// Singleton instance
let instance = null;

/**
 * Get or create ToolAuditLogger singleton
 * @param {Object} config - Configuration
 * @returns {ToolAuditLogger}
 */
function getToolAuditLogger(config = {}) {
  if (!instance) {
    instance = new ToolAuditLogger(config);
  }
  return instance;
}

module.exports = {
  ToolAuditLogger,
  getToolAuditLogger
};
