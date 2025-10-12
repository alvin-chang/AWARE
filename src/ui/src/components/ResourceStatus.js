import React from 'react';
import { Box, Typography, Card, CardContent, LinearProgress } from '@mui/material';

const ResourceStatus = ({ resource, index }) => {
  // Determine color based on utilization
  const getUtilizationColor = (utilization) => {
    if (utilization > 80) return '#f44336'; // Red for high utilization
    if (utilization > 60) return '#ff9800'; // Orange for medium utilization
    return '#4caf50'; // Green for low utilization
  };

  const utilizationColor = getUtilizationColor(resource.utilization);

  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Typography variant="h6" component="div" gutterBottom>
          {resource.name}
        </Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          {resource.location} | {resource.type} resource
        </Typography>
        
        <Box sx={{ mb: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Utilization
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Box sx={{ width: '100%', mr: 1 }}>
              <LinearProgress 
                variant="determinate" 
                value={resource.utilization} 
                sx={{ 
                  height: 10, 
                  borderRadius: 1,
                  '& .MuiLinearProgress-bar': {
                    backgroundColor: utilizationColor
                  }
                }} 
              />
            </Box>
            <Typography variant="body2" color="text.secondary">
              {resource.utilization}%
            </Typography>
          </Box>
        </Box>
        
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 'auto' }}>
          <Typography variant="caption" color="text.secondary">
            Status: {resource.status}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Capacity: {resource.utilization}/{resource.capacity}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
};

export default ResourceStatus;