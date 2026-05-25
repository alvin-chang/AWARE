import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  decisions: [],
  routingLogs: {},
  loading: false,
  error: null,
};

const auditSlice = createSlice({
  name: 'audit',
  initialState,
  reducers: {
    addDecision: (state, action) => {
      state.decisions.unshift(action.payload);
    },
    setDecisions: (state, action) => {
      state.decisions = action.payload;
    },
    setRoutingLog: (state, action) => {
      const { agentId, logs } = action.payload;
      state.routingLogs[agentId] = logs;
    },
    setLoading: (state, action) => {
      state.loading = action.payload;
    },
    setError: (state, action) => {
      state.error = action.payload;
    },
  },
});

export const { addDecision, setDecisions, setRoutingLog, setLoading, setError } = auditSlice.actions;
export default auditSlice.reducer;
