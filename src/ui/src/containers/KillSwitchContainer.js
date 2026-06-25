import React, { useEffect, useState } from 'react';
import { Box, Alert, CircularProgress } from '@mui/material';
import KillSwitchControls from '../components/KillSwitchControls';
import { agentAPI, killSwitchAPI } from '../services/api';

const mockAgents = [
  { id: 'agent-001', name: 'Researcher', status: 'active', trustScore: 92 },
  { id: 'agent-002', name: 'Architect', status: 'active', trustScore: 88 },
  { id: 'agent-003', name: 'Designer', status: 'revoked', trustScore: 45, revokedAt: '2026-05-20T09:15:00Z', revokeReason: 'Trust score dropped below threshold' },
  { id: 'agent-004', name: 'Coder', status: 'active', trustScore: 85 },
  { id: 'agent-005', name: 'Tester', status: 'active', trustScore: 78 },
];

const KillSwitchContainer = () => {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await agentAPI.list();
        setAgents(res.data);
      } catch {
        setAgents(mockAgents);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleRevoke = async (agentId, reason) => {
    await killSwitchAPI.revoke(agentId, reason);
    setAgents((prev) => prev.map((a) => a.id === agentId ? { ...a, status: 'revoked', revokedAt: new Date().toISOString(), revokeReason: reason } : a));
  };

  const handleRestore = async (agentId) => {
    await killSwitchAPI.restore(agentId);
    setAgents((prev) => prev.map((a) => a.id === agentId ? { ...a, status: 'active' } : a));
  };

  const handleEmergencyShutdown = async (agentId) => {
    await killSwitchAPI.emergencyShutdown(agentId);
    setAgents((prev) => prev.map((a) => a.id === agentId ? { ...a, status: 'shutdown' } : a));
  };

  if (loading) return <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>;

  return <KillSwitchControls agents={agents} onRevoke={handleRevoke} onRestore={handleRestore} onEmergencyShutdown={handleEmergencyShutdown} />;
};

export default KillSwitchContainer;
