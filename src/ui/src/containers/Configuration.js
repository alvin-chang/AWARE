import React, { useState, useEffect } from 'react';
import { 
  Typography, 
  Box, 
  Paper, 
  TextField, 
  Button, 
  Grid, 
  CircularProgress, 
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem
} from '@mui/material';
import { apiService } from '../services/apiService';

const Configuration = () => {
  const [config, setConfig] = useState({
    maxNodes: 100,
    heartbeatInterval: 30000,
    electionTimeout: 5000,
    clusterName: 'Default Cluster'
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  // Fetch initial configuration
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Get cluster status which includes configuration
        const response = await apiService.getClusterStatus();
        const clusterData = response.data;
        
        if (clusterData.configuration) {
          setConfig({
            maxNodes: clusterData.configuration.maxNodes || 100,
            heartbeatInterval: clusterData.configuration.heartbeatInterval || 30000,
            electionTimeout: clusterData.configuration.electionTimeout || 5000,
            clusterName: clusterData.name || 'Default Cluster'
          });
        }
      } catch (err) {
        setError(`Failed to load configuration: ${err.message}`);
        console.error('Error fetching configuration:', err);
        
        // Set default values in case of error
        setConfig({
          maxNodes: 100,
          heartbeatInterval: 30000,
          electionTimeout: 5000,
          clusterName: 'Default Cluster'
        });
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setConfig(prev => ({
      ...prev,
      [name]: name === 'maxNodes' || name === 'heartbeatInterval' || name === 'electionTimeout' 
        ? parseInt(value, 10) 
        : value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      // Update cluster configuration
      await apiService.updateClusterConfig({
        maxNodes: config.maxNodes,
        heartbeatInterval: config.heartbeatInterval,
        electionTimeout: config.electionTimeout
      });

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000); // Hide success message after 3 seconds
    } catch (err) {
      setError(`Failed to update configuration: ${err.message}`);
      console.error('Error updating configuration:', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h4" sx={{ color: '#212121', mb: 3 }}>
        System Configuration
      </Typography>
      
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>Configuration updated successfully!</Alert>}
      
      <Paper sx={{ p: 3, background: '#FFFFFF' }}>
        <Typography variant="h6" sx={{ color: '#212121', mb: 2 }}>
          Cluster Settings
        </Typography>
        
        <Box component="form" onSubmit={handleSubmit}>
          <Grid container spacing={3}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Cluster Name"
                name="clusterName"
                value={config.clusterName}
                onChange={handleChange}
                variant="outlined"
                disabled
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Max Nodes"
                name="maxNodes"
                type="number"
                value={config.maxNodes}
                onChange={handleChange}
                variant="outlined"
                inputProps={{ min: 1, max: 1000 }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Heartbeat Interval (ms)"
                name="heartbeatInterval"
                type="number"
                value={config.heartbeatInterval}
                onChange={handleChange}
                variant="outlined"
                inputProps={{ min: 1000 }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Election Timeout (ms)"
                name="electionTimeout"
                type="number"
                value={config.electionTimeout}
                onChange={handleChange}
                variant="outlined"
                inputProps={{ min: 1000 }}
              />
            </Grid>
          </Grid>
          
          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              type="submit"
              variant="contained"
              sx={{ 
                background: '#2E7D32',
                '&:hover': { background: '#1B5E20' }
              }}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Configuration'}
            </Button>
          </Box>
        </Box>
      </Paper>
    </Box>
  );
};

export default Configuration;