import React, { useState, useEffect } from 'react';
import { Typography, Box, Paper, Divider, CircularProgress, Alert, Button } from '@mui/material';
import { Refresh as RefreshIcon } from '@mui/icons-material';
import MetricsVisualization from '../components/MetricsVisualization';
import { apiService } from '../services/apiService';

const Monitoring = () => {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch metrics from API
  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const response = await apiService.getClusterMetrics();
        setMetrics(response.data);
      } catch (err) {
        setError(`Failed to load metrics: ${err.message}`);
        console.error('Error fetching metrics:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
    
    // Set up interval to refresh data periodically (every 30 seconds)
    const interval = setInterval(fetchMetrics, 30000);
    
    // Cleanup interval on component unmount
    return () => clearInterval(interval);
  }, []);

  const refreshMetrics = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await apiService.getClusterMetrics();
      setMetrics(response.data);
    } catch (err) {
      setError(`Failed to refresh metrics: ${err.message}`);
      console.error('Error refreshing metrics:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading && !metrics) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{ color: '#212121' }}>
          Monitoring
        </Typography>
        <Button 
          variant="outlined" 
          startIcon={<RefreshIcon />}
          onClick={refreshMetrics}
          sx={{ 
            color: '#1976D2',
            borderColor: '#1976D2'
          }}
        >
          Refresh Metrics
        </Button>
      </Box>
      
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
      )}
      
      <Paper sx={{ p: 3, background: '#FFFFFF', mb: 3 }}>
        <Typography variant="h6" sx={{ color: '#212121', mb: 2 }}>
          Cluster Metrics
        </Typography>
        
        {metrics ? (
          <Box>
            <Typography variant="body1" color="textSecondary" paragraph>
              View detailed metrics and performance data for your clusters and nodes.
            </Typography>
            
            <Divider sx={{ my: 2 }} />
            
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2, mb: 3 }}>
              <Paper sx={{ p: 2, textAlign: 'center' }}>
                <Typography variant="h4" sx={{ color: '#2E7D32' }}>
                  {metrics.cluster?.nodeCount || 0}
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  Total Nodes
                </Typography>
              </Paper>
              
              <Paper sx={{ p: 2, textAlign: 'center' }}>
                <Typography variant="h4" sx={{ color: '#1976D2' }}>
                  {metrics.nodes?.healthy || 0}
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  Healthy Nodes
                </Typography>
              </Paper>
              
              <Paper sx={{ p: 2, textAlign: 'center' }}>
                <Typography variant="h4" sx={{ color: '#FF9800' }}>
                  {metrics.nodes?.unhealthy || 0}
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  Unhealthy Nodes
                </Typography>
              </Paper>
              
              <Paper sx={{ p: 2, textAlign: 'center' }}>
                <Typography variant="h4" sx={{ color: '#D32F2F' }}>
                  {metrics.performance?.cpu?.average?.toFixed(1) || 0}%
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  Avg CPU
                </Typography>
              </Paper>
            </Box>
          </Box>
        ) : (
          <Typography variant="body1" color="textSecondary">
            No metrics available yet. Metrics will appear once the cluster is active.
          </Typography>
        )}
      </Paper>
      
      <MetricsVisualization metrics={metrics} />
    </Box>
  );
};

export default Monitoring;