// apiService.js - Service for API communication with AWARE backend
import axios from 'axios';
import performanceMonitor from '../utils/performanceUtils';

// Base URL for the AWARE API - in production this would come from environment variables
// When running in browser, use relative paths which will be proxied by nginx
const API_BASE_URL = process.env.REACT_APP_API_URL || '/api';

// Simple cache implementation
class ApiCache {
  constructor() {
    this.cache = new Map();
    this.timeouts = new Map();
    this.defaultTtl = 30000; // 30 seconds default TTL
  }

  set(key, value, ttl = this.defaultTtl) {
    // Clear any existing timeout for this key
    if (this.timeouts.has(key)) {
      clearTimeout(this.timeouts.get(key));
    }

    // Set the value
    this.cache.set(key, value);

    // Set timeout to remove the value after TTL
    const timeout = setTimeout(() => {
      this.cache.delete(key);
      this.timeouts.delete(key);
    }, ttl);

    this.timeouts.set(key, timeout);
  }

  get(key) {
    return this.cache.get(key);
  }

  has(key) {
    return this.cache.has(key);
  }

  clear() {
    // Clear all timeouts
    for (const timeout of this.timeouts.values()) {
      clearTimeout(timeout);
    }
    this.cache.clear();
    this.timeouts.clear();
  }

  // Specific cache keys for API calls
  generateKey(url, params) {
    return `${url}?${new URLSearchParams(params || {}).toString()}`;
  }
}

const apiCache = new ApiCache();

// Create an axios instance with default settings
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000, // Increased timeout to 15 seconds
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token to requests and measure performance
apiClient.interceptors.request.use(
  (config) => {
    // Record start time for performance measurement
    config.metadata = { startTime: new Date() };
    
    const token = localStorage.getItem('token'); // Get token from localStorage
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle common errors and measure performance
apiClient.interceptors.response.use(
  (response) => {
    // Calculate request duration
    const duration = new Date() - response.config.metadata.startTime;
    performanceMonitor.recordMetric('api_response_time', duration);
    
    return response;
  },
  (error) => {
    // Record error for performance monitoring
    performanceMonitor.recordMetric('api_error_count', 1);
    
    if (error.response?.status === 401) {
      // Handle unauthorized access - maybe redirect to login
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// API methods with caching and performance monitoring
export const apiService = {
  // Authentication methods
  login: (credentials) => {
    // For login, we need to make a request to the backend login endpoint
    // In the browser, this will go through nginx proxy
    return axios.post('/login', credentials);
  },
  
  register: (userData) => {
    // For registration, we need to make a request to the backend register endpoint
    // In the browser, this will go through nginx proxy
    return axios.post('/register', userData);
  },
  
  logout: () => {
    localStorage.removeItem('token');
    return Promise.resolve({ data: { message: 'Logged out successfully' } });
  },
  
  getCurrentUser: () => {
    // In a real implementation, this would make an API call
    const token = localStorage.getItem('token');
    if (token) {
      // Decode the token to get user info (simplified)
      try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        
        return Promise.resolve({ data: JSON.parse(jsonPayload) });
      } catch (e) {
        return Promise.reject(new Error('Could not decode token'));
      }
    }
    return Promise.reject(new Error('No token found'));
  },

  // Cluster methods with caching
  getClusterStatus: () => {
    const cacheKey = apiCache.generateKey('/cluster/status', null);
    if (apiCache.has(cacheKey)) {
      return Promise.resolve(apiCache.get(cacheKey));
    }
    
    return apiClient.get('/cluster/status')
      .then(response => {
        // Cache successful response for 10 seconds
        apiCache.set(cacheKey, response, 10000);
        return response;
      });
  },
  
  getClusterConfig: () => {
    const cacheKey = apiCache.generateKey('/cluster/config', null);
    if (apiCache.has(cacheKey)) {
      return Promise.resolve(apiCache.get(cacheKey));
    }
    
    return apiClient.get('/cluster/config')
      .then(response => {
        // Cache config for 30 seconds (it doesn't change frequently)
        apiCache.set(cacheKey, response, 30000);
        return response;
      });
  },
  
  updateClusterConfig: (configData) => {
    // Clear the cached config after updating
    const cacheKey = apiCache.generateKey('/cluster/config', null);
    apiCache.cache.delete(cacheKey);
    
    return apiClient.put('/cluster/config', { configuration: configData });
  },
  
  createCluster: (clusterData) => {
    // Clear cluster-related caches after creating a cluster
    apiCache.clear();
    return apiClient.post('/cluster', clusterData);
  },
  
  getClusterMetrics: () => {
    const cacheKey = apiCache.generateKey('/cluster/metrics', null);
    if (apiCache.has(cacheKey)) {
      return Promise.resolve(apiCache.get(cacheKey));
    }
    
    return apiClient.get('/cluster/metrics')
      .then(response => {
        // Cache metrics for 5 seconds (frequently changing)
        apiCache.set(cacheKey, response, 5000);
        return response;
      });
  },
  
  scaleClusterUp: (count) => apiClient.post('/cluster/scale-up', { count }),
  scaleClusterDown: (count) => apiClient.post('/cluster/scale-down', { count }),
  getClusterEvents: (limit) => apiClient.get(`/cluster/events${limit ? `?limit=${limit}` : ''}`),

  // Node methods with caching
  getNodes: () => {
    const cacheKey = apiCache.generateKey('/nodes', null);
    if (apiCache.has(cacheKey)) {
      return Promise.resolve(apiCache.get(cacheKey));
    }
    
    return apiClient.get('/nodes')
      .then(response => {
        // Cache nodes for 5 seconds (frequently changing)
        apiCache.set(cacheKey, response, 5000);
        return response;
      });
  },
  
  getNode: (id) => {
    const cacheKey = apiCache.generateKey(`/nodes/${id}`, null);
    if (apiCache.has(cacheKey)) {
      return Promise.resolve(apiCache.get(cacheKey));
    }
    
    return apiClient.get(`/nodes/${id}`)
      .then(response => {
        // Cache individual node for 10 seconds
        apiCache.set(cacheKey, response, 10000);
        return response;
      });
  },
  
  updateNode: (id, nodeData) => {
    // Clear the cached node after updating
    const cacheKey = apiCache.generateKey(`/nodes/${id}`, null);
    apiCache.cache.delete(cacheKey);
    
    // Also clear the nodes list cache since it may have changed
    apiCache.cache.delete(apiCache.generateKey('/nodes', null));
    
    return apiClient.put(`/nodes/${id}`, nodeData);
  },
  
  triggerNodeHealthCheck: (id) => apiClient.post(`/nodes/${id}/health-check`),

  // Alert methods with caching
  getAlerts: (params) => {
    const cacheKey = apiCache.generateKey('/alerts', params);
    if (apiCache.has(cacheKey)) {
      return Promise.resolve(apiCache.get(cacheKey));
    }
    
    const queryParams = params ? new URLSearchParams(params).toString() : '';
    const url = `/alerts${queryParams ? `?${queryParams}` : ''}`;
    
    return apiClient.get(url)
      .then(response => {
        // Cache alerts for 15 seconds (moderately frequently changing)
        apiCache.set(cacheKey, response, 15000);
        return response;
      });
  },
  
  getAlert: (id) => apiClient.get(`/alerts/${id}`),
  updateAlert: (id, alertData) => {
    // Clear alerts cache when updating an alert
    apiCache.cache.delete(apiCache.generateKey('/alerts', null));
    return apiClient.put(`/alerts/${id}`, alertData);
  },
  createAlert: (alertData) => {
    // Clear alerts cache when creating an alert
    apiCache.cache.delete(apiCache.generateKey('/alerts', null));
    return apiClient.post('/alerts', alertData);
  },
  
  // Method to clear cache when needed
  clearCache: () => {
    apiCache.clear();
  },

  // Resource methods with caching
  getResources: () => {
    const cacheKey = apiCache.generateKey('/resources', null);
    if (apiCache.has(cacheKey)) {
      return Promise.resolve(apiCache.get(cacheKey));
    }
    
    return apiClient.get('/resources')
      .then(response => {
        // Cache resources for 30 seconds (they don't change frequently)
        apiCache.set(cacheKey, response, 30000);
        return response;
      });
  },
  
  getResource: (id) => {
    const cacheKey = apiCache.generateKey(`/resources/${id}`, null);
    if (apiCache.has(cacheKey)) {
      return Promise.resolve(apiCache.get(cacheKey));
    }
    
    return apiClient.get(`/resources/${id}`)
      .then(response => {
        // Cache individual resource for 30 seconds
        apiCache.set(cacheKey, response, 30000);
        return response;
      });
  },
  
  updateResource: (id, resourceData) => {
    // Clear the cached resource after updating
    const cacheKey = apiCache.generateKey(`/resources/${id}`, null);
    apiCache.cache.delete(cacheKey);
    
    // Also clear the resources list cache since it may have changed
    apiCache.cache.delete(apiCache.generateKey('/resources', null));
    
    return apiClient.put(`/resources/${id}`, resourceData);
  }
};

export default apiClient;