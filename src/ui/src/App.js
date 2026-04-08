import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Box, CssBaseline } from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { isAuthenticated, getToken } from './utils/authUtils';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import Dashboard from './containers/Dashboard';
import Clusters from './containers/Clusters';
import Nodes from './containers/Nodes';
import Configuration from './containers/Configuration';
import Monitoring from './containers/Monitoring';
import Alerts from './containers/Alerts';
import LoginPage from './containers/LoginPage';
import RegistrationPage from './containers/RegistrationPage';
import RegistrationSuccess from './containers/RegistrationSuccess';

// Protected Route Component
const ProtectedRoute = ({ children }) => {
  const location = useLocation();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuth, setIsAuth] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const authenticated = isAuthenticated();
      setIsAuth(authenticated);
      setAuthChecked(true);
    };

    checkAuth();
  }, []);

  if (!authChecked) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div>Loading...</div>
      </Box>
    );
  }

  if (!isAuth) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
};

const App = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Check if user is already logged in when app loads
    setIsLoggedIn(isAuthenticated());
  }, []);

  const handleLogin = (user) => {
    setIsLoggedIn(true);
    navigate('/dashboard'); // Redirect to dashboard after login
  };

  const handleLogout = () => {
    // In the service, logout removes the token
    // We'll just update the state here since the service handles the token
    setIsLoggedIn(false);
    navigate('/login');
  };

  return (
    <>
      <CssBaseline />
      <Routes>
        <Route 
          path="/login" 
          element={
            isLoggedIn ? <Navigate to="/dashboard" replace /> : <LoginPage onLogin={handleLogin} />
          } 
        />
        <Route 
          path="/register" 
          element={
            isLoggedIn ? <Navigate to="/dashboard" replace /> : <RegistrationPage onLogin={handleLogin} />
          } 
        />
        <Route 
          path="/register-success" 
          element={<RegistrationSuccess />} 
        />
        <Route 
          path="/*" 
          element={
            <ProtectedRoute>
              <Box sx={{ display: 'flex', height: '100vh' }}>
                <Header onLogout={handleLogout} />
                <Sidebar />
                <Box component="main" sx={{ flexGrow: 1, p: 3, mt: 8, overflow: 'auto' }}>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/clusters" element={<Clusters />} />
                    <Route path="/nodes" element={<Nodes />} />
                    <Route path="/configuration" element={<Configuration />} />
                    <Route path="/monitoring" element={<Monitoring />} />
                    <Route path="/alerts" element={<Alerts />} />
                  </Routes>
                </Box>
              </Box>
            </ProtectedRoute>
          } 
        />
      </Routes>
    </>
  );
};

export default App;