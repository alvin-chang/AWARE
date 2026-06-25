import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  anomalies: [],
  killEvents: [],
  totalAnomalies: 0,
  criticalAnomalies: 0,
  unreadKillEvents: 0,
};

const alertsSlice = createSlice({
  name: 'alerts',
  initialState,
  reducers: {
    addAnomaly: (state, action) => {
      state.anomalies.unshift(action.payload);
      state.totalAnomalies += 1;
      if (action.payload.severity === 'critical') {
        state.criticalAnomalies += 1;
      }
    },
    addKillEvent: (state, action) => {
      state.killEvents.unshift(action.payload);
      state.unreadKillEvents += 1;
    },
    acknowledgeAnomaly: (state, action) => {
      const anomaly = state.anomalies.find((a) => a.id === action.payload);
      if (anomaly) {
        anomaly.acknowledged = true;
      }
    },
    clearKillEvents: (state) => {
      state.unreadKillEvents = 0;
    },
  },
});

export const { addAnomaly, addKillEvent, acknowledgeAnomaly, clearKillEvents } = alertsSlice.actions;
export default alertsSlice.reducer;
