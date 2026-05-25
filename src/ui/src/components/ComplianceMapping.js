import React from 'react';
import { Box, Typography, Card, CardContent, LinearProgress, Chip, Button, List, ListItem, ListItemText, Divider } from '@mui/material';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import DescriptionIcon from '@mui/icons-material/Description';
import CloudDoneIcon from '@mui/icons-material/CloudDone';
import GavelIcon from '@mui/icons-material/Gavel';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

const FRAMEWORKS = [
  { id: 'iso27001', name: 'ISO 27001', icon: <VerifiedUserIcon />, controls: 114, description: 'Information Security Management' },
  { id: 'soc2', name: 'SOC 2', icon: <CloudDoneIcon />, controls: 64, description: 'Service Organization Controls' },
  { id: 'gdpr', name: 'GDPR', icon: <DescriptionIcon />, controls: 99, description: 'Data Protection Regulation' },
  { id: 'aiact', name: 'EU AI Act', icon: <GavelIcon />, controls: 42, description: 'Artificial Intelligence Regulation' },
];

const ComplianceMapping = ({ coverage = {}, evidence = {}, readiness }) => {
  const getCoverage = (frameworkId) => {
    const c = coverage[frameworkId];
    return c != null ? c : 0;
  };

  const getEvidence = (frameworkId) => {
    return evidence[frameworkId] || [];
  };

  return (
    <Box>
      <Box mb={3}>
        <Typography variant="h5" fontWeight={600} gutterBottom>Compliance Mapping</Typography>
        <Typography variant="body2" color="text.secondary">
          Framework coverage, audit readiness, and evidence collection status
        </Typography>
      </Box>

      <Box display="grid" gridTemplateColumns="repeat(auto-fill, minmax(300px, 1fr))" gap={2} mb={3}>
        {FRAMEWORKS.map((fw) => {
          const cov = getCoverage(fw.id);
          return (
            <Card key={fw.id} variant="outlined">
              <CardContent>
                <Box display="flex" alignItems="center" gap={1} mb={1}>
                  {fw.icon}
                  <Typography variant="h6" fontWeight={600}>{fw.name}</Typography>
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{fw.description}</Typography>
                <Box mb={1}>
                  <Box display="flex" justifyContent="space-between" mb={0.5}>
                    <Typography variant="body2">Controls mapped</Typography>
                    <Typography variant="body2" fontWeight={600}>{cov}/{fw.controls}</Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={fw.controls > 0 ? (cov / fw.controls) * 100 : 0}
                    color={cov > fw.controls * 0.9 ? 'success' : cov > fw.controls * 0.7 ? 'warning' : 'error'}
                    sx={{ height: 8, borderRadius: 4 }}
                  />
                </Box>
                <Box display="flex" gap={1} mt={2}>
                  <Chip label={`${fw.controls} controls`} size="small" variant="outlined" />
                  <Chip label={`${getEvidence(fw.id).length} evidence`} size="small" variant="outlined" />
                </Box>
              </CardContent>
            </Card>
          );
        })}
      </Box>

      {readiness && (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" fontWeight={600} gutterBottom>Audit Readiness</Typography>
            <Box display="grid" gridTemplateColumns="repeat(auto-fill, minmax(200px, 1fr))" gap={2}>
              {Object.entries(readiness).map(([framework, ready]) => (
                <Box key={framework} display="flex" alignItems="center" gap={1}>
                  <CheckCircleIcon color={ready ? 'success' : 'disabled'} />
                  <Typography variant="body2">{framework.toUpperCase()}: {ready ? 'Ready' : 'Not Ready'}</Typography>
                </Box>
              ))}
            </Box>
          </CardContent>
        </Card>
      )}
    </Box>
  );
};

export default ComplianceMapping;
