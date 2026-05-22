import React from 'react';
import { Box } from '@mui/material';
import { Outlet } from 'react-router-dom';
import AppHeader from '../components/AppHeader';
import AppSidebar from '../components/AppSidebar';

const DRAWER_WIDTH = 260;

const MainLayout = () => {
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppSidebar />
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          ml: `${DRAWER_WIDTH}px`,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <AppHeader />
        <Box sx={{ p: 3, flexGrow: 1 }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
};

export default MainLayout;
