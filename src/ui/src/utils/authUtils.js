// authUtils.js - Utility functions for authentication with security enhancements
export const saveToken = (token) => {
  // Basic validation to ensure we're storing a JWT token
  if (typeof token !== 'string' || !token.includes('.')) {
    console.error('Invalid token format');
    return;
  }
  
  // Store token in localStorage (for now, in production consider http-only cookies)
  localStorage.setItem('token', token);
};

export const getToken = () => {
  const token = localStorage.getItem('token');
  
  // Basic validation
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return null;
  }
  
  return token;
};

export const removeToken = () => {
  localStorage.removeItem('token');
};

export const isAuthenticated = () => {
  const token = getToken();
  if (!token) {
    return false;
  }
  
  try {
    // Decode the token to check if it's expired
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    
    const payload = JSON.parse(jsonPayload);
    const currentTime = Math.floor(Date.now() / 1000);
    
    // Check if token is expired
    if (payload.exp && payload.exp < currentTime) {
      removeToken(); // Remove expired token
      return false;
    }
    
    return true;
  } catch (e) {
    console.error('Error validating token:', e);
    removeToken(); // Remove invalid token
    return false;
  }
};

export const getTokenPayload = () => {
  const token = getToken();
  if (!token) {
    return null;
  }
  
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    
    return JSON.parse(jsonPayload);
  } catch (e) {
    console.error('Error decoding token:', e);
    return null;
  }
};

export const setAuthToken = (token) => {
  if (token) {
    saveToken(token);
  } else {
    removeToken();
  }
};

// Validate JWT token format
export const isValidToken = (token) => {
  if (!token || typeof token !== 'string') {
    return false;
  }
  
  // Check if it's a properly formatted JWT (3 parts separated by dots)
  const parts = token.split('.');
  if (parts.length !== 3) {
    return false;
  }
  
  // Basic checks for each part
  return parts.every(part => part.length > 0 && /^[A-Za-z0-9-_]+$/.test(part));
};