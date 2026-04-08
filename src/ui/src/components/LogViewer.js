import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Typography, 
  Paper, 
  Table, 
  TableBody, 
  TableCell, 
  TableContainer, 
  TableHead, 
  TableRow,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  IconButton,
  Pagination,
  Alert as MuiAlert
} from '@mui/material';
import { FilterList as FilterIcon, Search as SearchIcon } from '@mui/icons-material';

const LogViewer = ({ alerts: propAlerts, loading: propLoading, error: propError, onRefresh }) => {
  const [filteredAlerts, setFilteredAlerts] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [levelFilter, setLevelFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [resolvedFilter, setResolvedFilter] = useState('all');
  const [page, setPage] = useState(1);
  const rowsPerPage = 10;

  // Use prop alerts or empty array
  const [alerts, setAlerts] = useState(propAlerts || []);

  // Update alerts when props change
  useEffect(() => {
    if (propAlerts) {
      setAlerts(propAlerts);
    }
  }, [propAlerts]);

  // Apply filters whenever filters, search term, or alerts change
  useEffect(() => {
    let result = alerts;
    
    // Apply search filter
    if (searchTerm) {
      result = result.filter(alert => 
        alert.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
        alert.source.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    // Apply level filter
    if (levelFilter !== 'all') {
      result = result.filter(alert => alert.level.toLowerCase() === levelFilter.toLowerCase());
    }
    
    // Apply source filter
    if (sourceFilter !== 'all') {
      result = result.filter(alert => alert.source.toLowerCase().includes(sourceFilter.toLowerCase()));
    }
    
    // Apply resolved filter
    if (resolvedFilter !== 'all') {
      const resolvedBool = resolvedFilter === 'true';
      result = result.filter(alert => alert.resolved === resolvedBool);
    }
    
    setFilteredAlerts(result);
    setPage(1); // Reset to first page when filters change
  }, [searchTerm, levelFilter, sourceFilter, resolvedFilter, alerts]);

  // Get unique sources for the filter dropdown
  const sources = ['all', ...new Set(alerts.map(alert => alert.source))];
  
  // Pagination
  const indexOfLastRow = page * rowsPerPage;
  const indexOfFirstRow = indexOfLastRow - rowsPerPage;
  const currentRows = filteredAlerts.slice(indexOfFirstRow, indexOfLastRow);
  const totalPages = Math.ceil(filteredAlerts.length / rowsPerPage);

  const handlePageChange = (event, value) => {
    setPage(value);
  };

  const getLevelColor = (level) => {
    switch(level.toLowerCase()) {
      case 'error': return '#D32F2F';
      case 'warning': return '#FF9800';
      case 'info': return '#2E7D32';
      default: return '#212121';
    }
  };

  return (
    <Box sx={{ width: '100%', mt: 3 }}>
      <Typography variant="h6" gutterBottom sx={{ color: '#212121', mb: 2 }}>
        System Logs and Events
      </Typography>
      
      {propError && (
        <MuiAlert severity="error" sx={{ mb: 2 }}>{propError}</MuiAlert>
      )}
      
      {/* Filters */}
      <Paper sx={{ p: 2, mb: 2, background: '#FFFFFF', display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <TextField
          label="Search Logs"
          variant="outlined"
          size="small"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          InputProps={{
            startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1 }} />,
          }}
          sx={{ minWidth: 250 }}
        />
        
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Level</InputLabel>
          <Select
            value={levelFilter}
            label="Level"
            onChange={(e) => setLevelFilter(e.target.value)}
          >
            <MenuItem value="all">All Levels</MenuItem>
            <MenuItem value="info">Info</MenuItem>
            <MenuItem value="warning">Warning</MenuItem>
            <MenuItem value="error">Error</MenuItem>
          </Select>
        </FormControl>
        
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Source</InputLabel>
          <Select
            value={sourceFilter}
            label="Source"
            onChange={(e) => setSourceFilter(e.target.value)}
          >
            <MenuItem value="all">All Sources</MenuItem>
            {sources.filter(s => s !== 'all').map(source => (
              <MenuItem key={source} value={source}>{source}</MenuItem>
            ))}
          </Select>
        </FormControl>
        
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Resolved</InputLabel>
          <Select
            value={resolvedFilter}
            label="Resolved"
            onChange={(e) => setResolvedFilter(e.target.value)}
          >
            <MenuItem value="all">All</MenuItem>
            <MenuItem value="true">Resolved</MenuItem>
            <MenuItem value="false">Unresolved</MenuItem>
          </Select>
        </FormControl>
      </Paper>
      
      {/* Log Table */}
      <TableContainer component={Paper} sx={{ background: '#FFFFFF' }}>
        <Table sx={{ minWidth: 650 }} aria-label="logs table">
          <TableHead>
            <TableRow>
              <TableCell>Timestamp</TableCell>
              <TableCell>Level</TableCell>
              <TableCell>Source</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Message</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {currentRows.length > 0 ? (
              currentRows.map((alert) => (
                <TableRow
                  key={alert.id}
                  sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                >
                  <TableCell component="th" scope="row" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    {alert.timestamp}
                  </TableCell>
                  <TableCell>
                    <Chip 
                      label={alert.level} 
                      size="small" 
                      sx={{ 
                        backgroundColor: `${getLevelColor(alert.level)}20`, // Lighter background
                        color: getLevelColor(alert.level),
                        fontWeight: 'bold',
                        fontSize: '0.8rem'
                      }} 
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ color: '#212121', fontFamily: 'monospace' }}>
                      {alert.source}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip 
                      label={alert.resolved ? 'Resolved' : 'Unresolved'} 
                      size="small" 
                      color={alert.resolved ? 'success' : 'warning'} 
                      sx={{ fontSize: '0.8rem' }} 
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="textSecondary">
                      {alert.message}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ fontStyle: 'italic', color: '#999' }}>
                  {propLoading ? 'Loading alerts...' : 'No alerts match the current filters'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      
      {/* Pagination */}
      {totalPages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          <Pagination 
            count={totalPages} 
            page={page} 
            onChange={handlePageChange}
            color="primary" 
          />
        </Box>
      )}
    </Box>
  );
};

export default LogViewer;