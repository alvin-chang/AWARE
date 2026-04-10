import React from 'react';
import { Card, CardContent, Typography, Box } from '@mui/material';

const SummaryCard = ({ title, value, icon, color }) => {
  return (
    <Card sx={{ 
      height: '100%', 
      background: '#FFFFFF',
      border: '1px solid #e0e0e0',
      borderRadius: '8px',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
    }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Box sx={{ 
            fontSize: '24px', 
            mr: 2, 
            color: color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: `${color}20` // Lighter background with opacity
          }}>
            {icon}
          </Box>
          <Box>
            <Typography color="textSecondary" gutterBottom variant="caption">
              {title}
            </Typography>
            <Typography variant="h5" component="div" sx={{ color: '#212121' }}>
              {value}
            </Typography>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
};

export default SummaryCard;