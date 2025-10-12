import React from 'react';
import { Typography, Box, Chip } from '@mui/material';

const ClusterHealthOverview = ({ clusters }) => {
  return (
    <Box>
      <Typography variant="h6" gutterBottom sx={{ color: '#212121', mb: 2 }}>
        Cluster Health Overview
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
        {clusters.map((cluster) => (
          <Box 
            key={cluster.id} 
            sx={{ 
              flex: '1 1 300px', 
              minWidth: 280, 
              p: 2, 
              border: '1px solid #e0e0e0', 
              borderRadius: '8px',
              background: '#F9F9F9'
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold', color: '#212121' }}>
                {cluster.name}
              </Typography>
              <Chip 
                label={cluster.status === 'healthy' ? 'HEALTHY' : cluster.status === 'warning' ? 'WARNING' : 'ERROR'} 
                color={cluster.status === 'healthy' ? 'success' : cluster.status === 'warning' ? 'warning' : 'error'} 
                size="small" 
                sx={{ height: '20px' }}
              />
            </Box>
            <Box sx={{ display: 'flex', gap: 3 }}>
              <Typography variant="body2" color="textSecondary">
                Nodes: {cluster.nodeCount}
              </Typography>
              <Typography variant="body2" color="textSecondary">
                Queens: {cluster.queenCount}
              </Typography>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export default ClusterHealthOverview;