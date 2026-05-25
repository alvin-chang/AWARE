import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  list: [],
  selectedAgent: null,
  loading: false,
  error: null,
};

const agentsSlice = createSlice({
  name: 'agents',
  initialState,
  reducers: {
    setAgents: (state, action) => {
      state.list = action.payload;
    },
    setSelectedAgent: (state, action) => {
      state.selectedAgent = action.payload;
    },
    updateStatus: (state, action) => {
      const { agentId, status } = action.payload;
      const agent = state.list.find((a) => a.id === agentId);
      if (agent) {
        agent.status = status;
        agent.lastStatusChange = new Date().toISOString();
      }
    },
    setLoading: (state, action) => {
      state.loading = action.payload;
    },
    setError: (state, action) => {
      state.error = action.payload;
    },
  },
});

export const { setAgents, setSelectedAgent, updateStatus, setLoading, setError } = agentsSlice.actions;
export default agentsSlice.reducer;
