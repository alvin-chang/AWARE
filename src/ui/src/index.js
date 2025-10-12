import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter as Router } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { CssBaseline } from '@mui/material';
import App from './App';
import store from './store';
import './index.css';

// Define the theme based on the front-end spec
const theme = createTheme({
  palette: {
    primary: {
      main: '#2E7D32', // Forest Green
    },
    secondary: {
      main: '#1976D2', // Blue
    },
    warning: {
      main: '#FF9800', // Orange
    },
    error: {
      main: '#D32F2F', // Red
    },
    background: {
      default: '#F5F5F5', // Light Gray
    },
    text: {
      primary: '#212121', // Dark Gray
    },
  },
  typography: {
    fontFamily: 'Roboto, Arial, sans-serif',
    h1: {
      fontFamily: 'Roboto, Arial, sans-serif',
      fontWeight: 'bold',
      fontSize: '24px',
    },
    h2: {
      fontFamily: 'Roboto, Arial, sans-serif',
      fontWeight: 'bold',
      fontSize: '20px',
    },
    h3: {
      fontFamily: 'Roboto, Arial, sans-serif',
      fontWeight: 'bold',
      fontSize: '18px',
    },
    body1: {
      fontFamily: 'Roboto, Arial, sans-serif',
      fontSize: '14px',
    },
    body2: {
      fontFamily: 'Roboto, Arial, sans-serif',
      fontSize: '12px',
    },
    caption: {
      fontFamily: 'Roboto, Arial, sans-serif',
      fontSize: '11px',
      fontWeight: 'medium',
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(
  <React.StrictMode>
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Router>
          <App />
        </Router>
      </ThemeProvider>
    </Provider>
  </React.StrictMode>
);