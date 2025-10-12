// debug.js
// Simple debugging script to check AWARE system components

const http = require('http');

// Function to make HTTP requests
function makeRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: data
        });
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    // If we have post data, send it
    if (postData) {
      req.write(postData);
    }
    
    req.end();
  });
}

// Function to check backend health
async function checkBackendHealth() {
  console.log('Checking backend health...');
  
  try {
    const response = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/health',
      method: 'GET'
    });
    
    console.log(`Backend health check: ${response.statusCode}`);
    if (response.statusCode === 200) {
      const data = JSON.parse(response.data);
      console.log(`Status: ${data.status}`);
      console.log(`Version: ${data.version}`);
      console.log(`Timestamp: ${data.timestamp}`);
      return true;
    } else {
      console.log(`Backend returned status ${response.statusCode}`);
      return false;
    }
  } catch (error) {
    console.error('Backend health check failed:', error.message);
    return false;
  }
}

// Function to check frontend availability
async function checkFrontend() {
  console.log('\nChecking frontend availability...');
  
  try {
    const response = await makeRequest({
      hostname: 'localhost',
      port: 3001,
      path: '/',
      method: 'GET'
    });
    
    console.log(`Frontend check: ${response.statusCode}`);
    if (response.statusCode === 200) {
      // Check if it's actually serving the React app
      if (response.data.includes('AWARE - Cluster Management Dashboard')) {
        console.log('Frontend is serving the correct application');
        return true;
      } else {
        console.log('Frontend is serving unexpected content');
        return false;
      }
    } else {
      console.log(`Frontend returned status ${response.statusCode}`);
      return false;
    }
  } catch (error) {
    console.error('Frontend check failed:', error.message);
    return false;
  }
}

// Function to check API endpoints
async function checkApiEndpoints() {
  console.log('\nChecking API endpoints...');
  
  // First, let's try to login to get a token
  let authToken = null;
  try {
    const loginData = JSON.stringify({
      username: 'admin',
      password: 'password'
    });
    
    const loginResponse = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(loginData)
      }
    }, loginData);
    
    console.log(`Login endpoint: ${loginResponse.statusCode}`);
    if (loginResponse.statusCode === 200) {
      try {
        const loginResult = JSON.parse(loginResponse.data);
        authToken = loginResult.token;
        console.log('Login successful, got auth token');
      } catch (parseError) {
        console.log('Login successful but failed to parse token');
      }
    } else {
      console.log(`Login failed with status ${loginResponse.statusCode}`);
      console.log(`Response: ${loginResponse.data}`);
    }
  } catch (error) {
    console.error(`Login endpoint: Failed - ${error.message}`);
  }
  
  const endpoints = [
    { path: '/api/cluster/status', name: 'Cluster Status' },
    { path: '/api/cluster/config', name: 'Cluster Config' },
    { path: '/api/cluster/metrics', name: 'Cluster Metrics' },
    { path: '/api/nodes', name: 'Nodes' },
    { path: '/api/alerts', name: 'Alerts' }
  ];
  
  let successCount = 0;
  let unauthorizedCount = 0;
  
  for (const endpoint of endpoints) {
    try {
      const options = {
        hostname: 'localhost',
        port: 3000,
        path: endpoint.path,
        method: 'GET'
      };
      
      // Add auth header if we have a token
      if (authToken) {
        options.headers = {
          'Authorization': `Bearer ${authToken}`
        };
      }
      
      const response = await makeRequest(options);
      
      console.log(`${endpoint.name}: ${response.statusCode}`);
      if (response.statusCode === 200) {
        successCount++;
      } else if (response.statusCode === 401 || response.statusCode === 403) {
        unauthorizedCount++;
        console.log(`  Response: ${response.data}`);
      }
    } catch (error) {
      console.error(`${endpoint.name}: Failed - ${error.message}`);
    }
  }
  
  console.log(`\nAPI endpoints working: ${successCount}/${endpoints.length}`);
  if (unauthorizedCount > 0) {
    console.log(`${unauthorizedCount} endpoints returned 401/403 (Unauthorized/Forbidden)`);
  }
  
  // If all endpoints work, that's great
  // If all endpoints return 401/403, that means auth is working but we have bad tokens
  const allGood = successCount === endpoints.length || (successCount === 0 && unauthorizedCount === endpoints.length);
  return successCount === endpoints.length; // Only return true if all endpoints worked
}

// Function to check Docker containers
async function checkDockerContainers() {
  console.log('\nChecking Docker containers...');
  
  const { exec } = require('child_process');
  
  return new Promise((resolve) => {
    exec('docker ps --filter "name=aware-" --format "table {{.Names}}\t{{.Status}}"', (error, stdout, stderr) => {
      if (error) {
        console.error('Failed to check Docker containers:', error.message);
        resolve(false);
        return;
      }
      
      console.log('Docker containers:');
      console.log(stdout);
      
      if (stdout.includes('aware-backend') && stdout.includes('aware-frontend')) {
        console.log('Both AWARE containers are running');
        resolve(true);
      } else {
        console.log('Some AWARE containers are missing');
        resolve(false);
      }
    });
  });
}

// Main debugging function
async function debugSystem() {
  console.log('=== AWARE System Debugging ===\n');
  
  // Check Docker containers
  const containersOk = await checkDockerContainers();
  
  // Check backend health
  const backendOk = await checkBackendHealth();
  
  // Check frontend
  const frontendOk = await checkFrontend();
  
  // Check API endpoints
  const apiOk = await checkApiEndpoints();
  
  // Summary
  console.log('\n=== Debugging Summary ===');
  console.log(`Docker containers: ${containersOk ? 'OK' : 'FAILED'}`);
  console.log(`Backend health: ${backendOk ? 'OK' : 'FAILED'}`);
  console.log(`Frontend availability: ${frontendOk ? 'OK' : 'FAILED'}`);
  console.log(`API endpoints: ${apiOk ? 'OK' : 'FAILED'}`);
  
  const overall = containersOk && backendOk && frontendOk && apiOk;
  console.log(`\nOverall system status: ${overall ? 'HEALTHY' : 'ISSUES DETECTED'}`);
  
  if (!overall) {
    console.log('\nRecommendations:');
    if (!containersOk) {
      console.log('- Check Docker containers with "docker ps"');
    }
    if (!backendOk) {
      console.log('- Check backend logs with "docker logs aware-backend"');
    }
    if (!frontendOk) {
      console.log('- Check frontend logs with "docker logs aware-frontend"');
    }
    if (!apiOk) {
      console.log('- Check API endpoints individually');
    }
  }
}

// Run the debugging
debugSystem().catch(console.error);