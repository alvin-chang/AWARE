import { configureStore } from '@reduxjs/toolkit';

// Initial state for the store
const initialState = {
  auth: {
    isAuthenticated: false,
    user: null,
    token: null
  },
  clusters: {
    list: [],
    currentCluster: null
  },
  nodes: {
    list: [],
    status: 'idle'
  },
  ui: {
    loading: false,
    error: null
  }
};

// Simple reducer for now
const rootReducer = (state = initialState, action) => {
  switch(action.type) {
    case 'AUTH_LOGIN':
      return {
        ...state,
        auth: {
          ...state.auth,
          isAuthenticated: true,
          user: action.payload.user,
          token: action.payload.token
        }
      };
    case 'AUTH_LOGOUT':
      return {
        ...state,
        auth: {
          ...state.auth,
          isAuthenticated: false,
          user: null,
          token: null
        }
      };
    case 'SET_LOADING':
      return {
        ...state,
        ui: {
          ...state.ui,
          loading: action.payload
        }
      };
    case 'SET_ERROR':
      return {
        ...state,
        ui: {
          ...state.ui,
          error: action.payload
        }
      };
    default:
      return state;
  }
};

const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Ignore these action types during serialization checks
        ignoredActions: ['persist/PERSIST'],
      },
    }),
});

export default store;