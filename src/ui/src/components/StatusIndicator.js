import React from 'react';
import { Box, Typography } from '@mui/material';
import CircleIcon from '@mui/icons-material/Circle';

const StatusIndicator = ({ status, label }) => {
  const getColor = (s) => {
    switch (s?.toLowerCase()) {
      case 'active':
      case 'compliant':
      case 'trusted':
        return 'success';
      case 'warning':
      case 'degraded':
      case 'suspended':
        return 'warning';
      case 'revoked':
      case 'critical':
      case 'shutdown':
        return 'error';
      default:
        return 'text.secondary';
    }
  };

  const color = getColor(status);
  const colorMap = {
    success: '#00e676',
    warning: '#ff9100',
    error: '#ff1744',
    'text.secondary': '#90a4ae',
  };

  return (
    <Box display="flex" alignItems="center" gap={1}>
      <CircleIcon sx={{ fontSize: 10, color: colorMap[color] }} />
      <Typography variant="body2" color="text.secondary">
        {label || status}
      </Typography>
    </Box>
  );
};

export default StatusIndicator;
