import React, { useEffect, useState } from 'react';
import { Box, Alert, CircularProgress } from '@mui/material';
import ComplianceMapping from '../components/ComplianceMapping';
import { complianceAPI } from '../services/api';

const mockCoverage = {
  iso27001: 89,
  soc2: 72,
  gdpr: 65,
  aiact: 34,
  overall: 65,
};

const mockEvidence = {
  iso27001: ['Agent identity logs', 'Constraint enforcement records', 'Kill switch audit trail'],
  soc2: ['Access control matrix', 'Trust score history'],
  gdpr: ['Data processing register'],
  aiact: ['Risk classification', 'Model card'],
};

const mockReadiness = {
  iso27001: true,
  soc2: false,
  gdpr: false,
  aiact: false,
};

const ComplianceContainer = () => {
  const [coverage, setCoverage] = useState({});
  const [evidence, setEvidence] = useState({});
  const [readiness, setReadiness] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [cRes, rRes] = await Promise.all([
          complianceAPI.getCoverage(),
          complianceAPI.getReadiness(),
        ]);
        setCoverage(cRes.data);
        setReadiness(rRes.data);
      } catch {
        setCoverage(mockCoverage);
        setEvidence(mockEvidence);
        setReadiness(mockReadiness);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) return <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>;

  return <ComplianceMapping coverage={coverage} evidence={evidence} readiness={readiness} />;
};

export default ComplianceContainer;
