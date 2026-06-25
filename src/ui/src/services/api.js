import axios from 'axios';
import { API_BASE, DEBUG } from '../constants';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

if (process.env.REACT_APP_API_KEY) {
  api.defaults.headers.common['Authorization'] = `Bearer ${process.env.REACT_APP_API_KEY}`;
}

// Request interceptor for logging
if (DEBUG) {
  api.interceptors.request.use((config) => {
    console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`);
    return config;
  });
}

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const message = error.response?.data?.message || error.message || 'Unknown error occurred';
    if (DEBUG) {
      console.error(`[API Error] ${message}`);
    }
    return Promise.reject(error);
  }
);

// Agent endpoints
export const agentAPI = {
  list: () => api.get('/agents'),
  getById: (id) => api.get(`/agents/${id}`),
  getIdentity: (id) => api.get(`/agents/${id}/identity`),
  getTrustScore: (id) => api.get(`/agents/${id}/trust-score`),
  getCapabilities: (id) => api.get(`/agents/${id}/capabilities`),
};

// Constraint endpoints
export const constraintAPI = {
  list: () => api.get('/constraints'),
  get: (id) => api.get(`/constraints/${id}`),
  enforce: (agentId, constraintId) => api.post(`/agents/${agentId}/constraints/${constraintId}/enforce`),
  getEnforcementStatus: (agentId) => api.get(`/agents/${agentId}/constraints/status`),
};

// Kill switch endpoints
export const killSwitchAPI = {
  revoke: (agentId, reason) => api.post(`/agents/${agentId}/revoke`, { reason }),
  emergencyShutdown: (agentId) => api.post(`/agents/${agentId}/emergency-shutdown`),
  bulkRevoke: (agentIds, reason) => api.post('/agents/bulk-revoke', { agentIds, reason }),
  listRevoked: () => api.get('/agents/revoked'),
  restore: (agentId) => api.post(`/agents/${agentId}/restore`),
};

// Anomaly endpoints
export const anomalyAPI = {
  list: (params) => api.get('/anomalies', { params }),
  getById: (id) => api.get(`/anomalies/${id}`),
  getBaseline: (agentId) => api.get(`/agents/${agentId}/baseline`),
  acknowledge: (id) => api.post(`/anomalies/${id}/acknowledge`),
  getStats: () => api.get('/anomalies/stats'),
};

// Compliance endpoints
export const complianceAPI = {
  getCoverage: () => api.get('/compliance/coverage'),
  getFrameworks: () => api.get('/compliance/frameworks'),
  getEvidence: (framework) => api.get(`/compliance/frameworks/${framework}/evidence`),
  getReadiness: () => api.get('/compliance/readiness'),
  getAuditReport: (id) => api.get(`/compliance/reports/${id}`),
};

// Audit trail endpoints
export const auditAPI = {
  getTrail: (params) => api.get('/audit/trail', { params }),
  getByAgent: (agentId, params) => api.get(`/agents/${agentId}/audit`, { params }),
  getDecisionChain: (eventId) => api.get(`/audit/decisions/${eventId}/chain`),
  getRoutingLog: (agentId) => api.get(`/agents/${agentId}/routing`),
};

export default api;
