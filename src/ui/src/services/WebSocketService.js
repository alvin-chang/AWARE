// WebSocketService.js - Service for real-time updates using WebSocket
class WebSocketService {
  constructor() {
    this.ws = null;
    this.reconnectInterval = 5000; // 5 seconds
    this.maxReconnectAttempts = 10;
    this.reconnectAttempts = 0;
    this.eventHandlers = {};
    this.url = null;
    this.token = null;
  }

  connect(url, token = null) {
    if (this.ws) {
      this.disconnect();
    }

    // Store the token for use in authentication if needed
    this.token = token;

    // Construct the WebSocket URL - in production this would come from env
    const wsUrl = url || (process.env.REACT_APP_WS_URL || 'ws://localhost:3000/ws');
    
    // Add token to URL if available (as a query parameter)
    const fullUrl = token ? `${wsUrl}?token=${token}` : wsUrl;

    this.url = fullUrl;
    this.ws = new WebSocket(fullUrl);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0; // Reset reconnect attempts on successful connection
      this._triggerEvent('open');
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this._triggerEvent(data.type, data.payload);
      } catch (error) {
        console.error('WebSocket message parsing error:', error);
        // If it's not JSON, emit the raw data
        this._triggerEvent('message', event.data);
      }
    };

    this.ws.onclose = (event) => {
      console.log('WebSocket disconnected:', event.code, event.reason);
      this._triggerEvent('close', event);
      
      // Attempt to reconnect if not a manual disconnect
      if (!event.wasClean && this.reconnectAttempts < this.maxReconnectAttempts) {
        console.log(`Attempting to reconnect... (${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
        setTimeout(() => {
          this.reconnectAttempts++;
          this.connect(null, this.token); // Reconnect with the same token
        }, this.reconnectInterval);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this._triggerEvent('error', error);
    };
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn('WebSocket is not connected. Cannot send data:', data);
    }
  }

  on(event, handler) {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = [];
    }
    this.eventHandlers[event].push(handler);
  }

  off(event, handler) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event] = this.eventHandlers[event].filter(h => h !== handler);
    }
  }

  _triggerEvent(event, data) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].forEach(handler => handler(data));
    }
  }
  
  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

// Create a singleton instance
const webSocketService = new WebSocketService();

export default webSocketService;