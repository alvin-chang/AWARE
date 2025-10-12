import React from 'react';
import { AppBar, Toolbar, Typography, IconButton, Badge, Button } from '@mui/material';
import { Menu as MenuIcon, Notifications as NotificationsIcon, ExitToApp as LogoutIcon } from '@mui/icons-material';

const Header = ({ onLogout }) => {
  return (
    <AppBar
      position="fixed"
      sx={{
        zIndex: (theme) => theme.zIndex.drawer + 1,
        background: '#2E7D32', // Forest Green
      }}
    >
      <Toolbar>
        <IconButton
          edge="start"
          color="inherit"
          aria-label="menu"
          sx={{ mr: 2 }}
        >
          <MenuIcon />
        </IconButton>
        <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1 }}>
          AWARE - Cluster Management Dashboard
        </Typography>
        <IconButton color="inherit">
          <Badge badgeContent={4} color="secondary">
            <NotificationsIcon />
          </Badge>
        </IconButton>
        <Button 
          color="inherit" 
          startIcon={<LogoutIcon />}
          onClick={onLogout}
          sx={{ ml: 2 }}
        >
          Logout
        </Button>
      </Toolbar>
    </AppBar>
  );
};

export default Header;