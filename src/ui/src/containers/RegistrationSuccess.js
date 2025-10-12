import React from 'react';
import { 
  Container, 
  Box, 
  Paper, 
  Typography, 
  Button
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useNavigate } from 'react-router-dom';

const RegistrationSuccess = () => {
  const navigate = useNavigate();

  const handleContinue = () => {
    navigate('/dashboard');
  };

  return (
    <Container component="main" maxWidth="xs">
      <Box
        sx={{
          marginTop: 8,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Paper elevation={3} sx={{ p: 4, width: '100%', textAlign: 'center' }}>
          <Box sx={{ mb: 2 }}>
            <CheckCircleIcon sx={{ fontSize: 60, color: '#4CAF50' }} />
          </Box>
          
          <Typography component="h1" variant="h5" sx={{ color: '#2E7D32', mb: 2 }}>
            Registration Successful!
          </Typography>
          
          <Typography variant="body1" sx={{ mb: 3 }}>
            Your account has been created successfully. You can now access the AWARE Cluster Management system.
          </Typography>
          
          <Button
            variant="contained"
            sx={{ 
              background: '#2E7D32',
              '&:hover': { background: '#1B5E20' }
            }}
            onClick={handleContinue}
          >
            Continue to Dashboard
          </Button>
        </Paper>
      </Box>
    </Container>
  );
};

export default RegistrationSuccess;