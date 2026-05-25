import { io } from 'socket.io-client';
import store from '../store';
import { WS_URL, DEBUG } from '../constants';

let socket = null;

export const connectWebSocket = () => {
  if (socket) return socket;

  socket = io(WS_URL, {
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
  });

  socket.on('connect', () => {
    if (DEBUG) console.log('[WS] Connected to control plane');
  });

  socket.on('disconnect', () => {
    if (DEBUG) console.log('[WS] Disconnected from control plane');
  });

  // Real-time agent events
  socket.on('agent:status_change', (data) => {
    if (DEBUG) console.log('[WS] Agent status change:', data);
    store.dispatch({ type: 'agents/updateStatus', payload: data });
  });

  // Anomaly alerts
  socket.on('anomaly:detected', (data) => {
    if (DEBUG) console.log('[WS] Anomaly detected:', data);
    store.dispatch({ type: 'alerts/addAnomaly', payload: data });
  });

  // Kill switch events
  socket.on('kill:activated', (data) => {
    if (DEBUG) console.log('[WS] Kill switch activated:', data);
    store.dispatch({ type: 'alerts/addKillEvent', payload: data });
  });

  // Compliance updates
  socket.on('compliance:updated', (data) => {
    if (DEBUG) console.log('[WS] Compliance updated:', data);
    store.dispatch({ type: 'compliance/updateCoverage', payload: data });
  });

  // Audit trail events
  socket.on('audit:decision', (data) => {
    if (DEBUG) console.log('[WS] Audit decision:', data);
    store.dispatch({ type: 'audit/addDecision', payload: data });
  });

  return socket;
};

export const disconnectWebSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

export const getWebSocket = () => socket;
