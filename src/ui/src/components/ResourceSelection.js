import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Paper,
  Grid,
  Chip,
  Button,
  LinearProgress
} from '@mui/material';
import { apiService } from '../services/apiService';

const ResourceSelection = ({ onSelectionChange }) => {
  const [resources, setResources] = useState([]);
  const [selectedResources, setSelectedResources] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fetch available distributed system resources
  useEffect(() => {
    const fetchResources = async () => {
      try {
        const response = await apiService.getResources();
        setResources(response.data.resources || []);
        
        // Initialize selected resources to all active ones
        const activeResources = response.data.resources?.filter(res => res.status === 'active') || [];
        setSelectedResources(activeResources.map(res => res.id));
      } catch (error) {
        console.error('Error fetching distributed system resources:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchResources();
  }, []);

  // Handle resource selection change
  const handleResourceToggle = async (resourceId) => {
    const newSelected = selectedResources.includes(resourceId)
      ? selectedResources.filter(id => id !== resourceId)
      : [...selectedResources, resourceId];

    setSelectedResources(newSelected);

    // Notify parent component of selection change
    if (onSelectionChange) {
      onSelectionChange(newSelected);
    }
  };

  // Toggle all resources
  const toggleAllResources = (selectAll) => {
    if (selectAll) {
      const allResourceIds = resources.map(res => res.id);
      setSelectedResources(allResourceIds);
      if (onSelectionChange) {
        onSelectionChange(allResourceIds);
      }
    } else {
      setSelectedResources([]);
      if (onSelectionChange) {
        onSelectionChange([]);
      }
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', p: 3 }}>
        <Typography>Loading distributed system resources...</Typography>
      </Box>
    );
  }

  return (
    <Paper sx={{ p: 2, mb: 3 }}>
      <Grid container spacing={2} alignItems="center" sx={{ mb: 2 }}>
        <Grid item xs={12}>
          <Typography variant="h6" gutterBottom>
            Distributed System Resource Selection
          </Typography>
        </Grid>
        <Grid item>
          <Button 
            size="small" 
            onClick={() => toggleAllResources(true)}
            disabled={selectedResources.length === resources.length}
          >
            Select All
          </Button>
        </Grid>
        <Grid item>
          <Button 
            size="small" 
            onClick={() => toggleAllResources(false)}
            disabled={selectedResources.length === 0}
          >
            Deselect All
          </Button>
        </Grid>
      </Grid>
      
      <FormGroup>
        {resources.map((resource) => (
          <Box key={resource.id} sx={{ mb: 1 }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={selectedResources.includes(resource.id)}
                  onChange={() => handleResourceToggle(resource.id)}
                  name={resource.name}
                />
              }
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                  <Typography variant="body2" sx={{ mr: 1, minWidth: '180px' }}>
                    {resource.name}
                  </Typography>
                  <Chip 
                    label={resource.status} 
                    size="small" 
                    color={resource.status === 'active' ? 'primary' : resource.status === 'maintenance' ? 'warning' : 'default'}
                    variant={resource.status === 'active' ? 'filled' : 'outlined'}
                    sx={{ height: '20px', mr: 1 }}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ mr: 1, minWidth: '80px' }}>
                    {resource.location}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
                    {resource.type}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
                      {resource.utilization}%
                    </Typography>
                    <Box sx={{ width: '80px', mr: 1 }}>
                      <LinearProgress 
                        variant="determinate" 
                        value={resource.utilization} 
                        sx={{ 
                          height: 6, 
                          borderRadius: 1,
                          '& .MuiLinearProgress-bar': {
                            backgroundColor: resource.utilization > 80 ? '#f44336' : 
                                            resource.utilization > 60 ? '#ff9800' : '#4caf50'
                          }
                        }} 
                      />
                    </Box>
                  </Box>
                </Box>
              }
            />
          </Box>
        ))}
      </FormGroup>
      
      <Box sx={{ mt: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Selected Resources: {selectedResources.length} of {resources.length}
        </Typography>
      </Box>
    </Paper>
  );
};

export default ResourceSelection;