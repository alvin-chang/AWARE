// src/ui/utils/performanceUtils.js
// Performance utilities for monitoring and optimization

// Performance monitoring class
class PerformanceMonitor {
  constructor() {
    this.metrics = {};
    this.observers = [];
  }

  // Measure execution time of a function
  async measureFunction(name, fn, ...args) {
    const start = performance.now();
    try {
      const result = await fn(...args);
      const end = performance.now();
      const duration = end - start;
      
      this.recordMetric(`${name}_execution_time`, duration);
      
      return result;
    } catch (error) {
      const end = performance.now();
      const duration = end - start;
      
      this.recordMetric(`${name}_execution_time`, duration);
      this.recordMetric(`${name}_error_count`, 1);
      
      throw error;
    }
  }

  // Record a metric
  recordMetric(name, value) {
    if (!this.metrics[name]) {
      this.metrics[name] = [];
    }
    
    this.metrics[name].push({
      value,
      timestamp: Date.now()
    });
    
    // Notify observers of the new metric
    this.observers.forEach(observer => {
      observer(name, value);
    });
    
    // Keep only the last 1000 measurements for each metric
    if (this.metrics[name].length > 1000) {
      this.metrics[name] = this.metrics[name].slice(-1000);
    }
  }

  // Get average value for a metric
  getAverage(name) {
    if (!this.metrics[name] || this.metrics[name].length === 0) {
      return 0;
    }
    
    const sum = this.metrics[name].reduce((acc, metric) => acc + metric.value, 0);
    return sum / this.metrics[name].length;
  }

  // Get latest value for a metric
  getLatest(name) {
    if (!this.metrics[name] || this.metrics[name].length === 0) {
      return null;
    }
    
    return this.metrics[name][this.metrics[name].length - 1].value;
  }

  // Subscribe to metric changes
  subscribe(observer) {
    this.observers.push(observer);
  }

  // Unsubscribe from metric changes
  unsubscribe(observer) {
    this.observers = this.observers.filter(obs => obs !== observer);
  }

  // Get all metrics
  getAllMetrics() {
    return { ...this.metrics };
  }

  // Clear all metrics
  clearMetrics() {
    this.metrics = {};
  }
}

// Create a singleton instance
const performanceMonitor = new PerformanceMonitor();
export default performanceMonitor;

// Utility functions for common performance tasks
export const performanceUtils = {
  // Debounce function to optimize frequent calls
  debounce: (func, wait) => {
    let timeout;
    return (...args) => {
      const later = () => {
        clearTimeout(timeout);
        func.apply(this, args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  // Throttle function to limit call frequency
  throttle: (func, limit) => {
    let inThrottle;
    return (...args) => {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  },

  // Memoize function to cache results
  memoize: (func) => {
    const cache = new Map();
    return (...args) => {
      const key = JSON.stringify(args);
      if (cache.has(key)) {
        return cache.get(key);
      }
      const result = func.apply(this, args);
      cache.set(key, result);
      return result;
    };
  },

  // Lazy load images function
  lazyLoadImages: () => {
    const images = document.querySelectorAll('img[data-src]');
    const imageObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          img.src = img.dataset.src;
          img.classList.remove('lazy');
          imageObserver.unobserve(img);
        }
      });
    });

    images.forEach(img => imageObserver.observe(img));
  },

  // Virtual scroll helper (simplified version)
  virtualScroll: (items, itemHeight, containerHeight) => {
    const visibleItemsCount = Math.ceil(containerHeight / itemHeight) + 1;
    return {
      visibleItemsCount,
      itemHeight,
      containerHeight
    };
  },

  // Optimize rendering by batching updates
  batchUpdates: (updates) => {
    return new Promise(resolve => {
      // Use requestAnimationFrame to batch updates
      requestAnimationFrame(() => {
        updates.forEach(update => update());
        resolve();
      });
    });
  }
};