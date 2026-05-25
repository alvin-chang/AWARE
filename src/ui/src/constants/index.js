export const ROUTES = {
  DASHBOARD: '/',
  AGENTS: '/agents',
  CONSTRAINTS: '/constraints',
  KILL_SWITCH: '/kill-switch',
  ANOMALIES: '/anomalies',
  COMPLIANCE: '/compliance',
  AUDIT: '/audit',
};

export const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:8080/api';
export const WS_URL = process.env.REACT_APP_WS_URL || 'ws://localhost:8080/ws';
export const DEBUG = process.env.REACT_APP_DEBUG === 'true';
export const APP_TITLE = process.env.REACT_APP_TITLE || 'AWARE Control Plane';
