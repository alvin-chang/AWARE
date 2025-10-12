import React from 'react';
import { Drawer, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Toolbar } from '@mui/material';
import { Dashboard as DashboardIcon, Storage as ClustersIcon, DnsRounded as NodesIcon, Settings as ConfigurationIcon, BarChart as MonitoringIcon, Notifications as AlertsIcon, Help as DocumentationIcon } from '@mui/icons-material';
import { Link, useLocation } from 'react-router-dom';

const drawerWidth = 240;

const Sidebar = () => {
  const location = useLocation();

  const menuItems = [
    { text: 'Dashboard', icon: <DashboardIcon />, path: '/dashboard' },
    { text: 'Clusters', icon: <ClustersIcon />, path: '/clusters' },
    { text: 'Nodes', icon: <NodesIcon />, path: '/nodes' },
    { text: 'Configuration', icon: <ConfigurationIcon />, path: '/configuration' },
    { text: 'Monitoring', icon: <MonitoringIcon />, path: '/monitoring' },
    { text: 'Alerts', icon: <AlertsIcon />, path: '/alerts' },
    { text: 'Documentation', icon: <DocumentationIcon />, path: '/documentation' },
  ];

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: drawerWidth,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: drawerWidth,
          boxSizing: 'border-box',
          background: '#F5F5F5', // Light Gray
          borderRight: '1px solid #e0e0e0',
        },
      }}
    >
      <Toolbar />
      <List>
        {menuItems.map((item, index) => (
          <ListItem key={item.text} disablePadding>
            <ListItemButton 
              component={Link} 
              to={item.path}
              selected={location.pathname === item.path}
              sx={{
                ...(location.pathname === item.path && {
                  backgroundColor: '#2E7D3210', // Light green background for selected item
                  borderRight: '3px solid #2E7D32', // Green border for selected item
                })
              }}
            >
              <ListItemIcon
                sx={{
                  color: location.pathname === item.path ? '#2E7D32' : 'inherit',
                  minWidth: 40
                }}
              >
                {item.icon}
              </ListItemIcon>
              <ListItemText 
                primary={item.text}
                sx={{
                  color: location.pathname === item.path ? '#2E7D32' : 'inherit',
                  fontWeight: location.pathname === item.path ? 'bold' : 'normal'
                }}
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Drawer>
  );
};

export default Sidebar;