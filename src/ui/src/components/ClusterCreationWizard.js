import React, { useState } from 'react';
import { 
  Box, 
  Button, 
  Stepper, 
  Step, 
  StepLabel, 
  Typography, 
  Paper,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Grid,
  Chip,
  Stack,
  Alert
} from '@mui/material';
import { Add as AddIcon, Check as CheckIcon } from '@mui/icons-material';
import { apiService } from '../services/apiService';

const ClusterCreationWizard = ({ onClusterCreated }) => {
  const [activeStep, setActiveStep] = useState(0);
  const [clusterData, setClusterData] = useState({
    type: '',
    name: '',
    nodeCount: 3,
    purpose: '',
    resources: { cpu: '', memory: '', storage: '' },
    constraints: []
  });
  const [creating, setCreating] = useState(false);
  const [creationError, setCreationError] = useState(null);

  const steps = [
    'Cluster Type Selection',
    'Configuration',
    'Review & Confirm',
    'Creation Progress'
  ];

  const clusterTypes = [
    { id: 'web', name: 'Web Tier', description: 'Frontend servers for web traffic' },
    { id: 'database', name: 'Database Cluster', description: 'Database servers with replication' },
    { id: 'compute', name: 'Compute Pool', description: 'General purpose compute nodes' },
    { id: 'custom', name: 'Custom Configuration', description: 'Fully customizable cluster' }
  ];

  const handleNext = async () => {
    if (activeStep === steps.length - 2) { // Before the last step (creation progress)
      // Validate required fields
      if (!clusterData.name || clusterData.name.trim() === '') {
        setCreationError('Cluster name is required');
        return;
      }
      
      // Create the cluster
      setCreating(true);
      setCreationError(null);
      
      try {
        const clusterPayload = {
          name: clusterData.name,
          configuration: {
            maxNodes: clusterData.nodeCount,
            purpose: clusterData.purpose,
            constraints: clusterData.constraints
          }
        };
        
        // Call the API to create the cluster
        await apiService.createCluster(clusterPayload);
        
        // Notify parent component of successful creation
        if (onClusterCreated) {
          onClusterCreated(clusterPayload);
        }
      } catch (error) {
        setCreationError(`Failed to create cluster: ${error.message || 'Unknown error'}`);
      } finally {
        setCreating(false);
      }
    }
    
    setActiveStep((prevActiveStep) => prevActiveStep + 1);
  };

  const handleBack = () => {
    setActiveStep((prevActiveStep) => prevActiveStep - 1);
  };

  const handleReset = () => {
    setActiveStep(0);
    setClusterData({
      type: '',
      name: '',
      nodeCount: 3,
      purpose: '',
      resources: { cpu: '', memory: '', storage: '' },
      constraints: []
    });
    setCreationError(null);
  };

  const updateClusterData = (field, value) => {
    setClusterData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const updateResourceData = (resource, value) => {
    setClusterData(prev => ({
      ...prev,
      resources: {
        ...prev.resources,
        [resource]: value
      }
    }));
  };

  const addConstraint = (constraint) => {
    if (!clusterData.constraints.includes(constraint)) {
      setClusterData(prev => ({
        ...prev,
        constraints: [...prev.constraints, constraint]
      }));
    }
  };

  const removeConstraint = (constraint) => {
    setClusterData(prev => ({
      ...prev,
      constraints: prev.constraints.filter(c => c !== constraint)
    }));
  };

  const getStepContent = (step) => {
    switch (step) {
      case 0:
        return (
          <Box sx={{ width: '100%' }}>
            <Typography variant="h6" gutterBottom sx={{ color: '#212121' }}>
              Select Cluster Purpose
            </Typography>
            <Grid container spacing={2}>
              {clusterTypes.map((type) => (
                <Grid item xs={12} sm={6} key={type.id}>
                  <Paper 
                    variant={clusterData.type === type.id ? "outlined" : "elevation"} 
                    sx={{ 
                      p: 2, 
                      cursor: 'pointer',
                      borderColor: clusterData.type === type.id ? '#2E7D32' : 'transparent',
                      borderWidth: clusterData.type === type.id ? '2px' : '1px',
                      background: '#FFFFFF',
                      '&:hover': { 
                        backgroundColor: '#f0f8f0' 
                      }
                    }}
                    onClick={() => updateClusterData('type', type.id)}
                  >
                    <Typography variant="subtitle1" sx={{ color: '#212121', fontWeight: 'bold' }}>
                      {type.name}
                    </Typography>
                    <Typography variant="body2" color="textSecondary">
                      {type.description}
                    </Typography>
                  </Paper>
                </Grid>
              ))}
            </Grid>
          </Box>
        );
      case 1:
        return (
          <Box sx={{ width: '100%' }}>
            <Typography variant="h6" gutterBottom sx={{ color: '#212121' }}>
              Configure Cluster Settings
            </Typography>
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Cluster Name"
                  value={clusterData.name}
                  onChange={(e) => updateClusterData('name', e.target.value)}
                  variant="outlined"
                  required
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Purpose/Description"
                  value={clusterData.purpose}
                  onChange={(e) => updateClusterData('purpose', e.target.value)}
                  variant="outlined"
                  multiline
                  rows={2}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  label="Node Count"
                  type="number"
                  value={clusterData.nodeCount}
                  onChange={(e) => updateClusterData('nodeCount', parseInt(e.target.value) || 0)}
                  variant="outlined"
                  InputProps={{ inputProps: { min: 1, max: 100 } }}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  label="CPU per Node"
                  value={clusterData.resources.cpu}
                  onChange={(e) => updateResourceData('cpu', e.target.value)}
                  variant="outlined"
                  placeholder="e.g., 2 cores"
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  label="Memory per Node"
                  value={clusterData.resources.memory}
                  onChange={(e) => updateResourceData('memory', e.target.value)}
                  variant="outlined"
                  placeholder="e.g., 4GB"
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Storage per Node"
                  value={clusterData.resources.storage}
                  onChange={(e) => updateResourceData('storage', e.target.value)}
                  variant="outlined"
                  placeholder="e.g., 50GB"
                />
              </Grid>
              <Grid item xs={12}>
                <Typography variant="subtitle1" sx={{ color: '#212121', mb: 1 }}>
                  Constraints
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {['High Availability', 'GPU Required', 'Storage Optimized', 'Network Optimized'].map((constraint) => (
                    <Chip
                      key={constraint}
                      label={constraint}
                      clickable
                      color={clusterData.constraints.includes(constraint) ? 'primary' : 'default'}
                      onClick={() => 
                        clusterData.constraints.includes(constraint) 
                          ? removeConstraint(constraint) 
                          : addConstraint(constraint)
                      }
                      variant={clusterData.constraints.includes(constraint) ? 'filled' : 'outlined'}
                    />
                  ))}
                </Stack>
              </Grid>
            </Grid>
          </Box>
        );
      case 2:
        return (
          <Box sx={{ width: '100%' }}>
            <Typography variant="h6" gutterBottom sx={{ color: '#212121' }}>
              Review Cluster Configuration
            </Typography>
            <Paper sx={{ p: 3, background: '#F9F9F9' }}>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="textSecondary">Cluster Type</Typography>
                  <Typography variant="body1" sx={{ color: '#212121' }}>
                    {clusterTypes.find(t => t.id === clusterData.type)?.name || 'Not selected'}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="textSecondary">Cluster Name</Typography>
                  <Typography variant="body1" sx={{ color: '#212121' }}>{clusterData.name || 'Not specified'}</Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="textSecondary">Node Count</Typography>
                  <Typography variant="body1" sx={{ color: '#212121' }}>{clusterData.nodeCount}</Typography>
                </Grid>
                <Grid item xs={12}>
                  <Typography variant="subtitle2" color="textSecondary">Purpose</Typography>
                  <Typography variant="body1" sx={{ color: '#212121' }}>{clusterData.purpose || 'Not specified'}</Typography>
                </Grid>
                <Grid item xs={12}>
                  <Typography variant="subtitle2" color="textSecondary">Resources per Node</Typography>
                  <Typography variant="body2" sx={{ color: '#212121' }}>
                    CPU: {clusterData.resources.cpu || 'Not specified'}, 
                    Memory: {clusterData.resources.memory || 'Not specified'}, 
                    Storage: {clusterData.resources.storage || 'Not specified'}
                  </Typography>
                </Grid>
                <Grid item xs={12}>
                  <Typography variant="subtitle2" color="textSecondary">Constraints</Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {clusterData.constraints.map((constraint, index) => (
                      <Chip key={index} label={constraint} size="small" />
                    ))}
                    {clusterData.constraints.length === 0 && (
                      <Typography variant="body2" color="textSecondary">None</Typography>
                    )}
                  </Stack>
                </Grid>
              </Grid>
            </Paper>
          </Box>
        );
      case 3:
        return (
          <Box sx={{ width: '100%', textAlign: 'center', py: 4 }}>
            {creating ? (
              <Box>
                <CheckIcon sx={{ fontSize: 60, color: '#2E7D32', mb: 2 }} />
                <Typography variant="h5" gutterBottom sx={{ color: '#212121' }}>
                  Creating Cluster...
                </Typography>
                <Typography variant="body1" color="textSecondary" paragraph>
                  Your cluster is being created. This may take a few minutes.
                </Typography>
                <Box sx={{ mt: 3 }}>
                  <Paper sx={{ p: 3, background: '#F9F9F9', textAlign: 'left' }}>
                    <Typography variant="body2" color="textSecondary" gutterBottom>
                      Cluster: {clusterData.name || 'New Cluster'}
                    </Typography>
                    <Typography variant="body2" color="textSecondary">
                      Status: Initializing nodes...
                    </Typography>
                  </Paper>
                </Box>
              </Box>
            ) : creationError ? (
              <Alert severity="error" sx={{ mb: 2, textAlign: 'left' }}>
                {creationError}
              </Alert>
            ) : (
              <Box>
                <CheckIcon sx={{ fontSize: 60, color: '#4CAF50', mb: 2 }} />
                <Typography variant="h5" gutterBottom sx={{ color: '#212121' }}>
                  Cluster Created Successfully!
                </Typography>
                <Typography variant="body1" color="textSecondary" paragraph>
                  Your cluster has been created and is ready to use.
                </Typography>
              </Box>
            )}
          </Box>
        );
      default:
        return 'Unknown step';
    }
  };

  return (
    <Box sx={{ width: '100%', mt: 3 }}>
      <Stepper activeStep={activeStep} alternativeLabel>
        {steps.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>
      <Box sx={{ mt: 3, minHeight: 400 }}>
        {creationError && activeStep !== steps.length - 1 && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {creationError}
          </Alert>
        )}
        {getStepContent(activeStep)}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3 }}>
        <Button
          color="inherit"
          disabled={activeStep === 0 || creating}
          onClick={handleBack}
          sx={{ 
            color: '#1976D2',
            borderColor: '#1976D2',
            display: activeStep > 0 ? 'block' : 'none'
          }}
          variant="outlined"
        >
          Back
        </Button>
        <Box>
          {activeStep === steps.length - 1 ? (
            <Button 
              variant="contained" 
              sx={{ 
                background: '#2E7D32',
                '&:hover': { background: '#1B5E20' }
              }}
              onClick={handleReset}
            >
              Create Another Cluster
            </Button>
          ) : (
            <Button 
              variant="contained" 
              endIcon={<AddIcon />}
              sx={{ 
                background: '#2E7D32',
                '&:hover': { background: '#1B5E20' }
              }}
              onClick={handleNext}
              disabled={creating}
            >
              {activeStep === steps.length - 2 ? (creating ? 'Creating...' : 'Create Cluster') : 'Next'}
            </Button>
          )}
        </Box>
      </Box>
    </Box>
  );
};

export default ClusterCreationWizard;