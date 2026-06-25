import React, { useState } from 'react';
import { Box, Typography, Card, CardContent, Chip, Button, Collapse, Alert, Badge, Tabs, Tab } from '@mui/material';
import WarningIcon from '@mui/icons-material/Warning';
import ErrorIcon from '@mui/icons-material/Error';
import InfoIcon from '@mui/icons-material/Info';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';

const AnomalyDetectionAlerts = ({ anomalies = [] }) => {
  const [expanded, setExpanded] = useState({});
  const [filter, setFilter] = useState('all');

  const filtered = filter === 'all'
    ? anomalies
    : anomalies.filter((a) => a.severity === filter);

  const stats = {
    critical: anomalies.filter((a) => a.severity === 'critical').length,
    warning: anomalies.filter((a) => a.severity === 'warning').length,
    info: anomalies.filter((a) => a.severity === 'info').length,
    acknowledged: anomalies.filter((a) => a.acknowledged).length,
  };

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'critical': return <ErrorIcon color="error" />;
      case 'warning': return <WarningIcon color="warning" />;
      default: return <InfoIcon color="info" />;
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'error';
      case 'warning': return 'warning';
      default: return 'info';
    }
  };

  const toggleExpand = (id) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <Box>
      <Box mb={3}>
        <Typography variant="h5" fontWeight={600} gutterBottom>Anomaly Detection Alerts</Typography>
        <Typography variant="body2" color="text.secondary">
          Behavioral deviations detected by the AWARE monitoring layer
        </Typography>
      </Box>

      <Box display="flex" gap={2} mb={3}>
        <Card sx={{ flex: 1, bgcolor: 'background.paper' }}>
          <CardContent>
            <Typography variant="h3" color="error.main">{stats.critical}</Typography>
            <Typography variant="body2" color="text.secondary">Revieweral</Typography>
          </CardContent>
        </Card>
        <Card sx={{ flex: 1, bgcolor: 'background.paper' }}>
          <CardContent>
            <Typography variant="h3" color="warning.main">{stats.warning}</Typography>
            <Typography variant="body2" color="text.secondary">Warnings</Typography>
          </CardContent>
        </Card>
        <Card sx={{ flex: 1, bgcolor: 'background.paper' }}>
          <CardContent>
            <Typography variant="h3" color="success.main">{stats.acknowledged}</Typography>
            <Typography variant="body2" color="text.secondary">Acknowledged</Typography>
          </CardContent>
        </Card>
      </Box>

      <Tabs value={filter} onChange={(e, v) => setFilter(v)} sx={{ mb: 2 }}>
        <Tab value="all" label={`All (${anomalies.length})`} />
        <Tab value="critical" label={`Revieweral (${stats.critical})`} />
        <Tab value="warning" label={`Warning (${stats.warning})`} />
        <Tab value="info" label={`Info (${stats.info})`} />
      </Tabs>

      <Box display="flex" flexDirection="column" gap={1}>
        {filtered.map((anomaly) => (
          <Card key={anomaly.id} variant="outlined" sx={{
            borderLeft: `4px solid`,
            borderColor: `${getSeverityColor(anomaly.severity)}.main`,
            opacity: anomaly.acknowledged ? 0.6 : 1,
          }}>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Box display="flex" alignItems="center" gap={1}>
                  {getSeverityIcon(anomaly.severity)}
                  <Typography variant="subtitle2" fontWeight={600}>{anomaly.title}</Typography>
                  {anomaly.acknowledged && <Chip label="Ack" size="small" color="success" />}
                </Box>
                <Box display="flex" alignItems="center" gap={1}>
                  <Typography variant="caption" color="text.secondary">{new Date(anomaly.detectedAt).toLocaleString()}</Typography>
                  <Button size="small" onClick={() => toggleExpand(anomaly.id)}>
                    {expanded[anomaly.id] ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                  </Button>
                </Box>
              </Box>
              <Collapse in={expanded[anomaly.id]}>
                <Box mt={1} p={1} bgcolor="background.default" borderRadius={1}>
                  <Typography variant="body2" color="text.secondary" gutterBottom>{anomaly.description}</Typography>
                  <Box display="flex" gap={1} mt={1}>
                    <Chip label={`Agent: ${anomaly.agentName}`} size="small" />
                    <Chip label={anomaly.metric} size="small" />
                    <Chip label={`Deviation: ${anomaly.deviation}`} size="small" color="error" />
                  </Box>
                  {!anomaly.acknowledged && (
                    <Box mt={1}>
                      <Button size="small" variant="outlined" startIcon={<CheckCircleIcon />}>
                        Acknowledge
                      </Button>
                    </Box>
                  )}
                </Box>
              </Collapse>
            </CardContent>
          </Card>
        ))}
      </Box>
    </Box>
  );
};

export default AnomalyDetectionAlerts;
