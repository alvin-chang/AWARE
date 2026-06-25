import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  coverage: [],
  frameworks: [],
  readiness: null,
  loading: false,
  error: null,
};

const complianceSlice = createSlice({
  name: 'compliance',
  initialState,
  reducers: {
    setCoverage: (state, action) => {
      state.coverage = action.payload;
    },
    setFrameworks: (state, action) => {
      state.frameworks = action.payload;
    },
    setReadiness: (state, action) => {
      state.readiness = action.payload;
    },
    updateCoverage: (state, action) => {
      const { framework, coverage } = action.payload;
      const existing = state.coverage.find((c) => c.framework === framework);
      if (existing) {
        existing.coverage = coverage;
        existing.lastUpdated = new Date().toISOString();
      } else {
        state.coverage.push({ framework, coverage, lastUpdated: new Date().toISOString() });
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

export const { setCoverage, setFrameworks, setReadiness, updateCoverage, setLoading, setError } = complianceSlice.actions;
export default complianceSlice.reducer;
