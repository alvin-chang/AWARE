import React, { useState, useEffect } from 'react';
import { Typography, Box, Paper, Divider, CircularProgress, Alert as MuiAlert, Button } from '@mui/material';
import { Refresh as RefreshIcon } from '@mui/icons-material';
import LogViewer from '../components/LogViewer';
import { apiService } from '../services/apiService';

const Alerts = () => {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch alerts from API
  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const response = await apiService.getAlerts();
        setAlerts(response.data.alerts || []);
      } catch (err) {
        setError(`Failed to load alerts: ${err.message}`);
        console.error('Error fetching alerts:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchAlerts();
    
    // Set up interval to refresh data periodically (every 30 seconds)
    const interval = setInterval(fetchAlerts, 30000);
    
    // Cleanup interval on component unmount
    return () => clearInterval(interval);
  }, []);

  const refreshAlerts = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await apiService.getAlerts();
      setAlerts(response.data.alerts || []);
    } catch (err) {
      setError(`Failed to refresh alerts: ${err.message}`);
      console.error('Error refreshing alerts:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading && alerts.length === 0) {
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
          Alerts
        </Typography>
        <Button 
          variant="outlined" 
          startIcon={<RefreshIcon />}
          onClick={refreshAlerts}
          sx={{ 
            color: '#1976D2',
            borderColor: '#1976D2'
          }}
        >
          Refresh Alerts
        </Button>
      </Box>
      
      {error && (
        <MuiAlert severity="error" sx={{ mb: 2 }}>{error}</MuiAlert>
      )}
      
      <Paper sx={{ p: 3, background: '#FFFFFF', mb: 3 }}>
        <Typography variant="h6" sx={{ color: '#212121', mb: 2 }}>
          System Alerts
        </Typography>
        <Typography variant="body1" color="textSecondary">
          View and manage system notifications and alerts.
        </Typography>
        <Divider sx={{ my: 2 }} />
        <Typography variant="body1" color="textSecondary">
          Filter and search through system logs to identify and resolve issues.
        </Typography>
      </Paper>
      
      <LogViewer alerts={alerts} loading={loading} error={error} onRefresh={refreshAlerts} />
    </Box>
  );
};

export default Alerts;