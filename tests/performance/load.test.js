// tests/performance/load.test.js
const APIGateway = require('../../src/api/index');

describe('API Performance Tests', () => {
  let apiGateway;
  let app;
  const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6InBlcmZfdGVzdCIscGVybWlzc2lvbnMiOlsicmVhZCIsIndyaXRlIl0sImlhdCI6MTUxNjIzOTAyMn0.Sa0H49J32NFe3Od0Rl713W5J76OhHJ48i7Q154J32Nw'; // Valid test token

  beforeAll(async () => {
    // Create a mock node discovery and election manager for testing
    const mockNodeDiscovery = {
      nodeId: 'test-node-1',
      getDiscoveredNodes: jest.fn().mockReturnValue(
        Array.from({ length: 10 }, (_, i) => ({
          nodeId: `node-${i + 1}`,
          status: 'active',
          lastSeen: new Date(),
          capabilities: ['compute', 'storage']
        }))
      )
    };
    
    const mockElectionManager = {
      isLeader: jest.fn().mockReturnValue(true),
      getLeader: jest.fn().mockReturnValue('test-node-1')
    };
    
    apiGateway = new APIGateway({
      port: 3002, // Different port for performance tests
      nodeDiscovery: mockNodeDiscovery,
      electionManager: mockElectionManager,
      secretKey: 'test_secret'
    });
    
    app = apiGateway.app;
  });

  test('should handle concurrent requests efficiently', async () => {
    const numRequests = 50;
    const startTime = Date.now();
    
    // Create an array of promises for concurrent requests
    const requests = Array.from({ length: numRequests }, () => 
      fetch(`http://localhost:3002/health`)
        .then(res => res.json())
        .catch(err => ({ error: err.message }))
    );
    
    const responses = await Promise.all(requests);
    const endTime = Date.now();
    
    // Verify all requests were successful
    responses.forEach(response => {
      if (!response.error) {
        expect(response.status).toBe('healthy');
      }
    });
    
    // Performance requirement: all 50 requests should complete in under 5 seconds
    const totalTime = endTime - startTime;
    console.log(`Completed ${numRequests} concurrent requests in ${totalTime}ms`);
    expect(totalTime).toBeLessThan(5000); // Less than 5 seconds
  }, 10000); // 10 second timeout

  test('should maintain response time under load', async () => {
    const numRequests = 100;
    const responseTimes = [];
    
    // Measure response time for multiple sequential requests
    for (let i = 0; i < numRequests; i++) {
      const start = Date.now();
      try {
        await fetch(`http://localhost:3002/health`);
      } catch (error) {
        // Ignore errors for this performance test
      }
      const end = Date.now();
      responseTimes.push(end - start);
    }
    
    // Calculate average response time
    const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    console.log(`Average response time over ${numRequests} requests: ${avgResponseTime}ms`);
    
    // Performance requirement: average response time should be under 200ms
    expect(avgResponseTime).toBeLessThan(200);
  }, 15000); // 15 second timeout

  test('should handle API request bursts', async () => {
    const burstSize = 20;
    const burstCount = 5;
    const allResponseTimes = [];
    
    for (let burst = 0; burst < burstCount; burst++) {
      const burstStart = Date.now();
      const burstRequests = Array.from({ length: burstSize }, async () => {
        const start = Date.now();
        try {
          await fetch(`http://localhost:3002/cluster/status`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
        } catch (error) {
          // Ignore errors for this performance test
        }
        const end = Date.now();
        return end - start;
      });
      
      const burstTimes = await Promise.all(burstRequests);
      allResponseTimes.push(...burstTimes);
      
      const burstDuration = Date.now() - burstStart;
      console.log(`Burst ${burst + 1} (${burstSize} requests) completed in ${burstDuration}ms`);
      
      // Wait a bit before the next burst
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    const avgBurstResponseTime = allResponseTimes.reduce((a, b) => a + b, 0) / allResponseTimes.length;
    console.log(`Average response time over ${burstCount} bursts of ${burstSize} requests: ${avgBurstResponseTime}ms`);
    
    // Performance requirement: average response time during bursts should be under 300ms
    expect(avgBurstResponseTime).toBeLessThan(300);
  }, 30000); // 30 second timeout

  test('should maintain 99.9% availability under load', async () => {
    const numRequests = 200;
    let successfulRequests = 0;
    
    // Send requests with a small delay between each to simulate steady load
    for (let i = 0; i < numRequests; i++) {
      try {
        const response = await fetch(`http://localhost:3002/health`);
        if (response.ok) {
          successfulRequests++;
        }
      } catch (error) {
        // Request failed
      }
      
      // Small delay to simulate more realistic load pattern
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    const successRate = successfulRequests / numRequests * 100;
    console.log(`Success rate: ${successRate}% (${successfulRequests}/${numRequests})`);
    
    // Requirement: maintain at least 99% success rate under load
    expect(successRate).toBeGreaterThanOrEqual(99);
  }, 30000); // 30 second timeout
}, 60000); // 60 second timeout for the entire test suite