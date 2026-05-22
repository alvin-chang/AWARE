import React, { useState, useEffect } from 'react';
import { Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Chip, LinearProgress, Tooltip, IconButton } from '@mui/material';
import KeyIcon from '@mui/icons-material/VpnKey';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import StatusIndicator from './StatusIndicator';

const AgentIdentityDashboard = ({ agents = [] }) => {
  const [sortField, setSortField] = useState('trustScore');
  const [sortDir, setSortDir] = useState('desc');

  const sortedAgents = [...agents].sort((a, b) => {
    const aVal = a[sortField] ?? 0;
    const bVal = b[sortField] ?? 0;
    return sortDir === 'asc' ? (aVal > bVal ? 1 : -1) : (aVal < bVal ? 1 : -1);
  });

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h5" fontWeight={600}>Agent Identity Dashboard</Typography>
        <Typography variant="body2" color="text.secondary">
          {agents.length} registered agents
        </Typography>
      </Box>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Agent ID</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Trust Score</TableCell>
              <TableCell>Capabilities</TableCell>
              <TableCell>Credentials</TableCell>
              <TableCell>Last Activity</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedAgents.map((agent) => (
              <TableRow key={agent.id} hover>
                <TableCell>
                  <Box display="flex" alignItems="center" gap={1}>
                    <FingerprintIcon fontSize="small" color="primary" />
                    <Typography variant="body2" fontFamily="monospace">
                      {agent.id?.substring(0, 8)}...
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell>{agent.name}</TableCell>
                <TableCell>
                  <StatusIndicator status={agent.status} />
                </TableCell>
                <TableCell>
                  <Tooltip title={`Trust Score: ${agent.trustScore}/100`}>
                    <Box width={120}>
                      <LinearProgress
                        variant="determinate"
                        value={agent.trustScore}
                        color={agent.trustScore > 80 ? 'success' : agent.trustScore > 50 ? 'warning' : 'error'}
                        sx={{ height: 8, borderRadius: 4 }}
                      />
                    </Box>
                  </Tooltip>
                </TableCell>
                <TableCell>
                  <Box display="flex" gap={0.5} flexWrap="wrap">
                    {(agent.capabilities || []).slice(0, 3).map((cap) => (
                      <Chip key={cap} label={cap} size="small" variant="outlined" />
                    ))}
                    {(agent.capabilities?.length || 0) > 3 && (
                      <Chip label={`+${agent.capabilities.length - 3}`} size="small" />
                    )}
                  </Box>
                </TableCell>
                <TableCell>
                  <Tooltip title={agent.credentials ? 'Verified' : 'No credentials'}>
                    <IconButton size="small">
                      <KeyIcon fontSize="small" color={agent.credentials ? 'primary' : 'disabled'} />
                    </IconButton>
                  </Tooltip>
                </TableCell>
                <TableCell>
                  <Typography variant="caption" color="text.secondary">
                    {agent.lastActivity ? new Date(agent.lastActivity).toLocaleString() : '—'}
                  </Typography>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

export default AgentIdentityDashboard;
