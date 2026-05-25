import React, { useEffect, useState } from 'react';
import { Box, Alert, CircularProgress } from '@mui/material';
import AnomalyDetectionAlerts from '../components/AnomalyDetectionAlerts';
import { anomalyAPI } from '../services/api';

const mockAnomalies = [
  { id: 'a1', title: 'Unexpected file access pattern', severity: 'warning', description: 'Agent attempted to access files outside its workspace scope', agentId: 'agent-004', agentName: 'Forge', detectedAt: '2026-05-21T14:30:00Z', metric: 'file_access', deviation: '+340%', acknowledged: false },
  { id: 'a2', title: 'Trust score degradation', severity: 'critical', description: 'Trust score dropped from 88 to 45 over 2 hours', agentId: 'agent-003', agentName: 'Pixel', detectedAt: '2026-05-20T09:10:00Z', metric: 'trust_score', deviation: '-49%', acknowledged: true },
  { id: 'a3', title: 'Network egress spike', severity: 'warning', description: 'Outbound network traffic exceeded baseline by 5x', agentId: 'agent-001', agentName: 'Scout', detectedAt: '2026-05-21T13:15:00Z', metric: 'network_egress', deviation: '+420%', acknowledged: false },
  { id: 'a4', title: 'Tool permission escalation', severity: 'critical', description: 'Agent attempted to use elevated tools without authorization', agentId: 'agent-005', agentName: 'Quinn', detectedAt: '2026-05-21T12:00:00Z', metric: 'tool_usage', deviation: 'Unauthorized', acknowledged: false },
];

const AnomalyDetectionContainer = () => {
  const [anomalies, setAnomalies] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await anomalyAPI.list();
        setAnomalies(res.data);
      } catch {
        setAnomalies(mockAnomalies);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) return <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>;

  return <AnomalyDetectionAlerts anomalies={anomalies} />;
};

export default AnomalyDetectionContainer;
