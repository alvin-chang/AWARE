import React, { useEffect, useState } from 'react';
import { Box, Alert, CircularProgress } from '@mui/material';
import AuditTrailViewer from '../components/AuditTrailViewer';
import { auditAPI } from '../services/api';

const mockDecisions = [
  { id: 'd1', type: 'request', agentId: 'agent-001', agentName: 'Researcher', decision: 'Web search requested', reasoning: 'User requested research on ISO 27001 controls', timestamp: '2026-05-21T15:00:00Z', routedTo: null },
  { id: 'd2', type: 'decision', agentId: 'agent-002', agentName: 'Architect', decision: 'Constraint check: T2', reasoning: 'Agent operating at T2 level - human approval required', timestamp: '2026-05-21T14:55:00Z', routedTo: 'human-approver' },
  { id: 'd3', type: 'response', agentId: 'agent-004', agentName: 'Coder', decision: 'Code implementation', reasoning: 'Constraints verified - proceeding with implementation', timestamp: '2026-05-21T14:50:00Z', routedTo: null },
  { id: 'd4', type: 'request', agentId: 'agent-005', agentName: 'Tester', decision: 'Test execution requested', reasoning: 'Running integration tests on approved code', timestamp: '2026-05-21T14:45:00Z', routedTo: null },
  { id: 'd5', type: 'decision', agentId: 'agent-003', agentName: 'Designer', decision: 'Access denied', reasoning: 'Agent at T4 level - read-only observation only', timestamp: '2026-05-20T09:20:00Z', routedTo: null },
];

const AuditTrailContainer = () => {
  const [decisions, setDecisions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await auditAPI.getTrail({ limit: 100 });
        setDecisions(res.data);
      } catch {
        setDecisions(mockDecisions);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) return <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>;

  return <AuditTrailViewer decisions={decisions} />;
};

export default AuditTrailContainer;