import React, { useState, useEffect } from 'react';
import { 
  Typography, 
  Box, 
  Button, 
  Paper, 
  Divider, 
  CircularProgress, 
  Alert,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Chip
} from '@mui/material';
import { 
  Add as AddIcon, 
  List as ListIcon,
  CheckCircle as HealthyIcon,
  Warning as WarningIcon,
  Error as ErrorIcon,
  Link as NodeIcon
} from '@mui/icons-material';
import ClusterCreationWizard from '../components/ClusterCreationWizard';
import { apiService } from '../services/apiService';

const Clusters = () => {
  const [showWizard, setShowWizard] = useState(false);
  const [clusters, setClusters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch clusters from API
  useEffect(() => {
    const fetchClusters = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // For now, we'll use the cluster status endpoint since we only have one cluster
        const clusterStatusResponse = await apiService.getClusterStatus();
        const clusterStatus = clusterStatusResponse.data;
        
        // Format the cluster data for display
        const clusterList = [
          {
            id: clusterStatus.clusterId,
            name: clusterStatus.name || 'Default Cluster',
            status: clusterStatus.status,
            nodeCount: clusterStatus.nodeCount,
            isLeader: clusterStatus.isLeader,
            leader: clusterStatus.leader
          }
        ];
        
        setClusters(clusterList);
      } catch (err) {
        setError(`Failed to load clusters: ${err.message}`);
        console.error('Error fetching clusters:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchClusters();
    
    // Set up interval to refresh data periodically (every 30 seconds)
    const interval = setInterval(fetchClusters, 30000);
    
    // Cleanup interval on component unmount
    return () => clearInterval(interval);
  }, []);

  // Handle cluster creation from the wizard
  const handleClusterCreated = async (clusterData) => {
    try {
      await apiService.createCluster(clusterData);
      // Refresh the cluster list
      const clusterStatusResponse = await apiService.getClusterStatus();
      const clusterStatus = clusterStatusResponse.data;
      
      const newCluster = {
        id: clusterStatus.clusterId,
        name: clusterStatus.name || 'Default Cluster',
        status: clusterStatus.status,
        nodeCount: clusterStatus.nodeCount,
        isLeader: clusterStatus.isLeader,
        leader: clusterStatus.leader
      };
      
      setClusters([newCluster]);
      setShowWizard(false);
    } catch (err) {
      setError(`Failed to create cluster: ${err.message}`);
      console.error('Error creating cluster:', err);
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'active':
      case 'healthy':
        return <HealthyIcon sx={{ color: '#2E7D32' }} />;
      case 'warning':
        return <WarningIcon sx={{ color: '#FF9800' }} />;
      case 'error':
      case 'inactive':
        return <ErrorIcon sx={{ color: '#D32F2F' }} />;
      default:
        return <HealthyIcon sx={{ color: '#2E7D32' }} />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'active':
      case 'healthy':
        return 'success';
      case 'warning':
        return 'warning';
      case 'error':
      case 'inactive':
        return 'error';
      default:
        return 'success';
    }
  };

  if (loading && !showWizard) {
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
          Clusters
        </Typography>
        <Button 
          variant="contained" 
          startIcon={showWizard ? <ListIcon /> : <AddIcon />}
          onClick={() => setShowWizard(!showWizard)}
          sx={{ 
            background: '#2E7D32',
            '&:hover': { background: '#1B5E20' }
          }}
        >
          {showWizard ? 'View Clusters' : 'Create Cluster'}
        </Button>
      </Box>
      
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
      )}
      
      {showWizard ? (
        <Paper sx={{ p: 3, background: '#FFFFFF' }}>
          <ClusterCreationWizard onClusterCreated={handleClusterCreated} />
        </Paper>
      ) : (
        <Paper sx={{ p: 3, background: '#FFFFFF' }}>
          <Typography variant="h6" sx={{ color: '#212121', mb: 2 }}>
            Cluster Management
          </Typography>
          
          {clusters.length > 0 ? (
            <List>
              {clusters.map((cluster) => (
                <ListItem 
                  key={cluster.id} 
                  sx={{ 
                    borderBottom: '1px solid #eee',
                    '&:last-child': { borderBottom: 'none' }
                  }}
                >
                  <ListItemIcon>
                    {getStatusIcon(cluster.status)}
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="h6" sx={{ color: '#212121' }}>
                          {cluster.name}
                        </Typography>
                        <Chip
                          label={cluster.status.charAt(0).toUpperCase() + cluster.status.slice(1)}
                          color={getStatusColor(cluster.status)}
                          size="small"
                        />
                      </Box>
                    }
                    secondary={
                      <Box sx={{ mt: 1 }}>
                        <Typography variant="body2" color="textSecondary">
                          Nodes: {cluster.nodeCount} | 
                          {cluster.isLeader ? ' This node is the leader' : ` Leader: ${cluster.leader || 'Unknown'}`}
                        </Typography>
                      </Box>
                    }
                  />
                  <ListItemIcon>
                    <NodeIcon />
                    <Typography variant="body2" sx={{ ml: 1 }}>
                      {cluster.nodeCount}
                    </Typography>
                  </ListItemIcon>
                </ListItem>
              ))}
            </List>
          ) : (
            <Box>
              <Typography variant="body1" color="textSecondary">
                No clusters found. Create your first cluster to get started.
              </Typography>
            </Box>
          )}
        </Paper>
      )}
    </Box>
  );
};

export default Clusters;