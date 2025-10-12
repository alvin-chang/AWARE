import React, { useMemo } from 'react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  BarChart,
  Bar,
  ComposedChart,
  Area,
  AreaChart
} from 'recharts';
import { 
  Card, 
  CardContent, 
  CardHeader, 
  Typography, 
  Box,
  Grid,
  Paper
} from '@mui/material';

// MetricsVisualization Component
// This component visualizes cluster metrics
// If metrics are provided via props, it will use real data
// Otherwise, it will use mock data for demonstration

const MetricsVisualization = ({ metrics }) => {
  // Memoize chart data to prevent unnecessary re-renders
  const chartData = useMemo(() => {
    // Generate CPU data
    const cpuData = metrics?.performance?.cpu?.nodes 
      ? Object.entries(metrics.performance.cpu.nodes).map(([nodeName, cpuValue], index) => ({
          name: `Node ${index + 1}`,
          cpu: cpuValue
        }))
      : [
          { name: 'Node 1', cpu: 45.2 },
          { name: 'Node 2', cpu: 60.3 },
          { name: 'Node 3', cpu: 30.1 },
          { name: 'Node 4', cpu: 70.5 },
          { name: 'Node 5', cpu: 25.8 },
        ];

    // Generate memory data
    const memoryData = metrics?.performance?.memory?.nodes 
      ? Object.entries(metrics.performance.memory.nodes).map(([nodeName, memoryValue], index) => ({
          name: `Node ${index + 1}`,
          memory: memoryValue
        }))
      : [
          { name: 'Node 1', memory: 60.1 },
          { name: 'Node 2', memory: 75.4 },
          { name: 'Node 3', memory: 40.2 },
          { name: 'Node 4', memory: 80.3 },
          { name: 'Node 5', memory: 35.7 },
        ];

    // Generate network data
    const networkData = [
      { name: 'Node 1', network: 120 },
      { name: 'Node 2', network: 200 },
      { name: 'Node 3', network: 80 },
      { name: 'Node 4', network: 300 },
      { name: 'Node 5', network: 150 },
    ];

    return { cpuData, memoryData, networkData };
  }, [metrics]);

  return (
    <Box sx={{ width: '100%', mt: 3 }}>
      <Typography variant="h6" gutterBottom sx={{ color: '#212121', mb: 2 }}>
        Metrics Visualization
      </Typography>
      
      <Grid container spacing={3}>
        <Grid item xs={12} lg={6}>
          <Paper sx={{ p: 2, background: '#FFFFFF' }}>
            <Typography variant="subtitle1" sx={{ color: '#212121', mb: 1 }}>CPU Usage (%)</Typography>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={chartData.cpuData}
                margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis unit="%" />
                <Tooltip />
                <Legend />
                <Bar dataKey="cpu" name="CPU Usage (%)" fill="#2E7D32" />
              </BarChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>
        
        <Grid item xs={12} lg={6}>
          <Paper sx={{ p: 2, background: '#FFFFFF' }}>
            <Typography variant="subtitle1" sx={{ color: '#212121', mb: 1 }}>Memory Usage (%)</Typography>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={chartData.memoryData}
                margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis unit="%" />
                <Tooltip />
                <Legend />
                <Bar dataKey="memory" name="Memory Usage (%)" fill="#1976D2" />
              </BarChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>
        
        <Grid item xs={12}>
          <Paper sx={{ p: 2, background: '#FFFFFF' }}>
            <Typography variant="subtitle1" sx={{ color: '#212121', mb: 1 }}>Network Throughput (Mbps)</Typography>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart
                data={chartData.networkData}
                margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis unit="Mbps" />
                <Tooltip />
                <Legend />
                <Bar dataKey="network" name="Network (Mbps)" fill="#FF9800" />
              </BarChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default MetricsVisualization;