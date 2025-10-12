import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Grid, Paper, Typography, Box, CircularProgress, Alert } from '@mui/material';
import { Card, CardContent, CardHeader } from '@mui/material';
import ClusterHealthOverview from '../components/ClusterHealthOverview';
import NodeConnectivityStatus from '../components/NodeConnectivityStatus';
import SummaryCard from '../components/SummaryCard';
import ResourceSelection from '../components/ResourceSelection';
import ResourceStatus from '../components/ResourceStatus';
import { apiService } from '../services/apiService';
import performanceMonitor, { performanceUtils } from '../utils/performanceUtils';

const Dashboard = () => {
  const [dashboardData, setDashboardData] = useState({
    activeClusters: 0,
    connectedNodes: 0,
    avgResponseTime: 0,
    clusters: [],
    nodes: []
  });
  const [resources, setResources] = useState([]);
  const [selectedResourceIds, setSelectedResourceIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch real data from API with performance optimization
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Use performance monitoring for the fetch operation
      const result = await performanceMonitor.measureFunction('dashboard_data_fetch', async () => {
        // Fetch cluster status, nodes, and resources in parallel for better performance
        const [clusterStatusResponse, nodesResponse, resourcesResponse] = await Promise.all([
          apiService.getClusterStatus(),
          apiService.getNodes(),
          apiService.getResources().catch(() => ({ data: { resources: [] } })) // Handle potential resource API error gracefully
        ]);
        
        return { 
          clusterStatus: clusterStatusResponse.data, 
          nodesData: nodesResponse.data,
          resourcesData: resourcesResponse.data
        };
      });
      
      const { clusterStatus, nodesData, resourcesData } = result;
      
      // Update resources state
      setResources(resourcesData?.resources || []);
      
      // Create mock data based on API responses
      const mockData = {
        activeClusters: 1, // We have one cluster
        connectedNodes: clusterStatus.nodeCount || 0,
        avgResponseTime: 42, // Mock value for now
        clusters: [
          { 
            id: clusterStatus.clusterId || 1, 
            name: clusterStatus.name || 'Default Cluster', 
            status: clusterStatus.status === 'active' ? 'healthy' : 'warning', 
            nodeCount: clusterStatus.nodeCount || 0, 
            queenCount: clusterStatus.isLeader ? 1 : 0 
          }
        ],
        nodes: nodesData.discovered.map((node, index) => ({
          id: `${index + 1}`.padStart(3, '0'),
          name: `Node-${node.nodeId?.substr(0, 5) || `00${index + 1}`}`,
          status: node.status || 'connected',
          role: node.role || 'worker',
          responseTime: Math.floor(Math.random() * 50) + 10 // Random mock value
        })).concat(
          // Add the local node
          [{
            id: '001',
            name: `Node-${nodesData.self?.nodeId?.substr(0, 5) || 'self'}`,
            status: 'connected',
            role: nodesData.self?.role || 'worker',
            responseTime: 15
          }]
        )
      };
      
      setDashboardData(mockData);
    } catch (err) {
      setError(`Failed to load dashboard data: ${err.message}`);
      console.error('Error fetching dashboard data:', err);
      
      // Set default mock data in case of error
      const mockData = {
        activeClusters: 0,
        connectedNodes: 0,
        avgResponseTime: 0,
        clusters: [],
        nodes: []
      };
      setDashboardData(mockData);
    } finally {
      setLoading(false);
    }
  }, []);

  // Set up interval to refresh data periodically (every 30 seconds)
  useEffect(() => {
    fetchData();
    
    const interval = setInterval(fetchData, 30000);
    
    // Cleanup interval on component unmount
    return () => clearInterval(interval);
  }, [fetchData]);

  // Handle resource selection changes
  const handleResourceSelectionChange = (selectedIds) => {
    setSelectedResourceIds(selectedIds);
  };

  // Memoize summary card data to prevent unnecessary re-renders
  const summaryCards = useMemo(() => [
    { title: "Active Clusters", value: dashboardData.activeClusters, icon: "📊", color: "#2E7D32" },
    { title: "Total Nodes", value: dashboardData.connectedNodes, icon: "🔗", color: "#1976D2" },
    { title: "Avg Response Time", value: `${dashboardData.avgResponseTime}ms`, icon: "⚡", color: "#FF9800" },
    { title: "System Status", value: "Healthy", icon: "✅", color: "#2E7D32" }
  ], [dashboardData]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  // Filter selected resources based on selection
  const selectedResources = resources.filter(resource => 
    selectedResourceIds.includes(resource.id)
  );

  return (
    <Box sx={{ flexGrow: 1 }}>
      <Typography variant="h4" gutterBottom sx={{ color: '#212121' }}>
        AWARE Cluster Management Dashboard
      </Typography>
      
      {/* Summary Cards with memoization */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        {summaryCards.map((card, index) => (
          <Grid item xs={12} sm={6} md={3} key={index}>
            <SummaryCard 
              title={card.title} 
              value={card.value} 
              icon={card.icon}
              color={card.color}
            />
          </Grid>
        ))}
      </Grid>

      {/* Distributed System Resource Selection */}
      <ResourceSelection onSelectionChange={handleResourceSelectionChange} />

      {/* Resource Status - Only show if there are selected resources */}
      {selectedResources.length > 0 && (
        <Paper sx={{ p: 2, mb: 3, background: '#FFFFFF' }}>
          <Typography variant="h6" gutterBottom sx={{ color: '#212121', mb: 2 }}>
            Distributed System Resource Status
          </Typography>
          <Grid container spacing={2}>
            {selectedResources.map((resource, index) => (
              <Grid item xs={12} sm={6} md={4} key={resource.id}>
                <ResourceStatus resource={resource} index={index} />
              </Grid>
            ))}
          </Grid>
        </Paper>
      )}

      {/* Cluster Health Overview */}
      <Paper sx={{ p: 2, mb: 3, background: '#FFFFFF' }}>
        <ClusterHealthOverview clusters={dashboardData.clusters} />
      </Paper>

      {/* Node Connectivity Status */}
      <Paper sx={{ p: 2, background: '#FFFFFF' }}>
        <NodeConnectivityStatus nodes={dashboardData.nodes} />
      </Paper>
    </Box>
  );
};

export default Dashboard;