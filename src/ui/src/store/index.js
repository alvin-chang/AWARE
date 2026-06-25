import { configureStore } from '@reduxjs/toolkit';
import agentsReducer from './agentsSlice';
import alertsReducer from './alertsSlice';
import complianceReducer from './complianceSlice';
import auditReducer from './auditSlice';

const store = configureStore({
  reducer: {
    agents: agentsReducer,
    alerts: alertsReducer,
    compliance: complianceReducer,
    audit: auditReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ['agents/updateStatus', 'alerts/addAnomaly', 'alerts/addKillEvent', 'compliance/updateCoverage', 'audit/addDecision'],
        ignoredPaths: ['agents.list', 'alerts.anomalies', 'compliance.coverage'],
      },
    }),
});

export default store;
