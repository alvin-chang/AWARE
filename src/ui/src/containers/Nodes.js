import React, { useState, useEffect } from 'react';
import { 
  Typography, 
  Box, 
  Paper, 
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Chip,
  CircularProgress,
  Alert,
  Button
} from '@mui/material';
import { 
  CheckCircle as ConnectedIcon,
  Cancel as DisconnectedIcon,
  Person as QueenIcon,
  Settings as WorkerIcon,
  Refresh as RefreshIcon
} from '@mui/icons-material';
import { apiService } from '../services/apiService';

const Nodes = () => {
  const [nodes, setNodes] = useState({ self: null, discovered: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch nodes from API
  useEffect(() => {
    const fetchNodes = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const response = await apiService.getNodes();
        setNodes(response.data);
      } catch (err) {
        setError(`Failed to load nodes: ${err.message}`);
        console.error('Error fetching nodes:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchNodes();
    
    // Set up interval to refresh data periodically (every 30 seconds)
    const interval = setInterval(fetchNodes, 30000);
    
    // Cleanup interval on component unmount
    return () => clearInterval(interval);
  }, []);

  const refreshNodes = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await apiService.getNodes();
      setNodes(response.data);
    } catch (err) {
      setError(`Failed to refresh nodes: ${err.message}`);
      console.error('Error refreshing nodes:', err);
    } finally {
      setLoading(false);
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
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{ color: '#212121' }}>
          Nodes
        </Typography>
        <Button 
          variant="outlined" 
          startIcon={<RefreshIcon />}
          onClick={refreshNodes}
          sx={{ 
            color: '#1976D2',
            borderColor: '#1976D2'
          }}
        >
          Refresh
        </Button>
      </Box>
      
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
      )}
      
      <Paper sx={{ p: 3, background: '#FFFFFF', mb: 3 }}>
        <Typography variant="h6" sx={{ color: '#212121', mb: 2 }}>
          Node Monitoring
        </Typography>
        <Typography variant="body1" color="textSecondary" paragraph>
          Monitor the status and performance of individual nodes in your clusters.
        </Typography>
        
        <Typography variant="subtitle1" sx={{ color: '#212121', mt: 2, mb: 1 }}>
          Self Node
        </Typography>
        {nodes.self && (
          <List>
            <ListItem>
              <ListItemIcon>
                <ConnectedIcon sx={{ color: '#2E7D32' }} />
              </ListItemIcon>
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="h6" sx={{ color: '#212121' }}>
                      {`Node-${nodes.self.nodeId?.substr(0, 8) || 'Unknown'}`}
                    </Typography>
                    <Chip
                      label={nodes.self.role === 'queen' ? 'Queen' : 'Worker'}
                      color={nodes.self.role === 'queen' ? 'primary' : 'default'}
                      size="small"
                      icon={nodes.self.role === 'queen' ? <QueenIcon /> : <WorkerIcon />}
                    />
                  </Box>
                }
                secondary={
                  <Box sx={{ mt: 1 }}>
                    <Typography variant="body2" color="textSecondary">
                      Status: {nodes.self.status || 'Unknown'} | 
                      Last seen: {nodes.self.lastSeen ? new Date(nodes.self.lastSeen).toLocaleString() : 'N/A'}
                    </Typography>
                  </Box>
                }
              />
            </ListItem>
          </List>
        )}
        
        <Typography variant="subtitle1" sx={{ color: '#212121', mt: 2, mb: 1 }}>
          Discovered Nodes
        </Typography>
        {nodes.discovered && nodes.discovered.length > 0 ? (
          <List>
            {nodes.discovered.map((node) => (
              <ListItem key={node.nodeId}>
                <ListItemIcon>
                  {node.status === 'active' || node.status === 'connected' ? 
                    <ConnectedIcon sx={{ color: '#2E7D32' }} /> : 
                    <DisconnectedIcon sx={{ color: '#D32F2F' }} />
                  }
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="h6" sx={{ color: '#212121' }}>
                        {`Node-${node.nodeId?.substr(0, 8) || 'Unknown'}`}
                      </Typography>
                      <Chip
                        label={node.role || 'Worker'}
                        color={node.role === 'queen' ? 'primary' : 'default'}
                        size="small"
                        icon={node.role === 'queen' ? <QueenIcon /> : <WorkerIcon />}
                      />
                    </Box>
                  }
                  secondary={
                    <Box sx={{ mt: 1 }}>
                      <Typography variant="body2" color="textSecondary">
                        Status: {node.status || 'Unknown'} | 
                        Address: {node.address || 'N/A'} |
                        Last seen: {node.lastSeen ? new Date(node.lastSeen).toLocaleString() : 'N/A'}
                      </Typography>
                    </Box>
                  }
                />
              </ListItem>
            ))}
          </List>
        ) : (
          <Typography variant="body1" color="textSecondary">
            No other nodes discovered yet. Make sure other AWARE nodes are running and discoverable.
          </Typography>
        )}
      </Paper>
    </Box>
  );
};

export default Nodes;