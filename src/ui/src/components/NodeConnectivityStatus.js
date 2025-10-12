import React from 'react';
import { Typography, Box, Chip } from '@mui/material';

const NodeConnectivityStatus = ({ nodes }) => {
  return (
    <Box>
      <Typography variant="h6" gutterBottom sx={{ color: '#212121', mb: 2 }}>
        Node Connectivity Status
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {nodes.map((node) => (
          <Box 
            key={node.id} 
            sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              p: 1, 
              border: '1px solid #e0e0e0', 
              borderRadius: '4px',
              background: '#FFFFFF',
              minWidth: 150
            }}
          >
            <Box 
              sx={{ 
                width: 12, 
                height: 12, 
                borderRadius: '50%', 
                backgroundColor: node.status === 'connected' ? '#2E7D32' : '#D32F2F',
                mr: 1 
              }} 
            />
            <Typography variant="body2" sx={{ mr: 1, color: '#212121' }}>
              Node-{node.id}
            </Typography>
            <Chip 
              label={node.role.toUpperCase()} 
              size="small" 
              sx={{ height: '20px', fontSize: '10px' }} 
              color={node.role === 'queen' ? 'primary' : 'default'}
            />
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export default NodeConnectivityStatus;