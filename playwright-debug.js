// playwright-debug.js
// Comprehensive Playwright test to debug AWARE system network issues

const { chromium } = require('playwright');

async function debugAWARESystem() {
  console.log('=== AWARE System Playwright Debug ===\n');
  
  // Launch browser
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    // Enable request interception to capture network logs
    page.on('request', request => {
      console.log(`→ Request: ${request.method()} ${request.url()}`);
    });
    
    page.on('response', response => {
      console.log(`← Response: ${response.status()} ${response.url()}`);
    });
    
    page.on('requestfailed', request => {
      console.log(`✗ Failed Request: ${request.method()} ${request.url()} - ${request.failure().errorText}`);
    });
    
    page.on('console', msg => {
      console.log(`Console: ${msg.type()} - ${msg.text()}`);
    });
    
    page.on('pageerror', error => {
      console.log(`Page Error: ${error.message}`);
    });
    
    // Test 1: Navigate to frontend
    console.log('1. Testing frontend access...');
    try {
      const response = await page.goto('http://localhost:3001/', { 
        waitUntil: 'networkidle',
        timeout: 10000
      });
      
      if (response.ok()) {
        console.log(`✓ Frontend loaded successfully with status ${response.status()}`);
        
        // Wait for React app to initialize
        await page.waitForTimeout(3000);
        
        // Check if we have the expected content
        const title = await page.title();
        console.log(`  Page title: ${title}`);
        
        // Check for key elements
        const dashboardExists = await page.isVisible('text=Dashboard Overview');
        console.log(`  Dashboard element found: ${dashboardExists}`);
      } else {
        console.log(`✗ Frontend failed to load with status ${response.status()}`);
        const body = await response.text();
        console.log(`  Response body: ${body.substring(0, 200)}...`);
      }
    } catch (error) {
      console.log(`✗ Frontend access failed: ${error.message}`);
    }
    
    // Test 2: Try to login
    console.log('\n2. Testing login flow...');
    try {
      // Navigate to login page
      await page.goto('http://localhost:3001/login', { 
        waitUntil: 'networkidle',
        timeout: 10000
      });
      
      // Fill login form
      await page.fill('input[name="username"]', 'admin');
      await page.fill('input[name="password"]', 'password');
      
      // Capture network requests during login
      console.log('  Submitting login form...');
      const [loginResponse] = await Promise.all([
        page.waitForResponse(response => 
          response.url().includes('/login') && response.status() === 200,
          { timeout: 10000 }
        ),
        page.click('button[type="submit"]')
      ]);
      
      console.log(`✓ Login successful with status ${loginResponse.status()}`);
      
      // Get the token from response
      const loginData = await loginResponse.json();
      console.log(`  Token received: ${loginData.token ? 'YES' : 'NO'}`);
      
      if (loginData.token) {
        // Store token for later use
        await context.addCookies([{
          name: 'token',
          value: loginData.token,
          domain: 'localhost',
          path: '/',
          expires: Date.now() / 1000 + 3600, // 1 hour
          httpOnly: false,
          secure: false
        }]);
      }
    } catch (error) {
      console.log(`✗ Login failed: ${error.message}`);
    }
    
    // Test 3: Try to access dashboard after login
    console.log('\n3. Testing dashboard access after login...');
    try {
      const response = await page.goto('http://localhost:3001/dashboard', { 
        waitUntil: 'networkidle',
        timeout: 15000
      });
      
      console.log(`  Dashboard page status: ${response.status()}`);
      
      // Check for dashboard elements
      await page.waitForTimeout(2000);
      
      const clusterCardExists = await page.isVisible('text=Active Clusters');
      console.log(`  Cluster card found: ${clusterCardExists}`);
      
      // Take a screenshot for visual debugging
      await page.screenshot({ path: 'debug-dashboard.png' });
      console.log('  Screenshot saved as debug-dashboard.png');
    } catch (error) {
      console.log(`✗ Dashboard access failed: ${error.message}`);
    }
    
    // Test 4: Direct API calls to check connectivity
    console.log('\n4. Testing direct API connectivity...');
    try {
      // Test health endpoint
      const healthResponse = await page.evaluate(async () => {
        const response = await fetch('http://localhost:3000/health');
        return {
          status: response.status,
          ok: response.ok,
          data: await response.text()
        };
      });
      
      console.log(`  Health endpoint: ${healthResponse.status} ${healthResponse.ok ? 'OK' : 'FAILED'}`);
      console.log(`  Health data: ${healthResponse.data.substring(0, 100)}...`);
    } catch (error) {
      console.log(`✗ Direct API health test failed: ${error.message}`);
    }
    
    // Test 5: Check if frontend can proxy API requests
    console.log('\n5. Testing frontend API proxy...');
    try {
      // Try to access API through frontend proxy
      const proxyResponse = await page.evaluate(async () => {
        try {
          const response = await fetch('/api/cluster/status');
          return {
            status: response.status,
            ok: response.ok,
            headers: [...response.headers.entries()]
          };
        } catch (error) {
          return {
            error: error.message
          };
        }
      });
      
      if (proxyResponse.error) {
        console.log(`✗ Proxy test failed: ${proxyResponse.error}`);
      } else {
        console.log(`  Proxy test status: ${proxyResponse.status} ${proxyResponse.ok ? 'OK' : 'FAILED'}`);
        console.log(`  Response headers: ${JSON.stringify(proxyResponse.headers).substring(0, 100)}...`);
      }
    } catch (error) {
      console.log(`✗ Proxy test failed: ${error.message}`);
    }
    
    // Test 6: Check browser console for errors
    console.log('\n6. Checking browser console for errors...');
    // This was already handled with the console listener above
    
    // Wait a bit to see any delayed errors
    await page.waitForTimeout(3000);
    
  } catch (error) {
    console.log(`✗ General error: ${error.message}`);
  } finally {
    // Close browser
    await browser.close();
  }
  
  console.log('\n=== Debug Complete ===');
}

// Run the debug
debugAWARESystem().catch(console.error);
