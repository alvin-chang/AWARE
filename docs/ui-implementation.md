# AWARE Web User Interface

## Overview
The AWARE Web UI is a React-based dashboard for managing and monitoring AWARE clusters. It provides an intuitive interface for DevOps engineers to monitor cluster status, manage nodes, configure clusters, and troubleshoot issues.

## Features Implemented
- **Dashboard**: Overview with summary cards and cluster health visualization
- **Cluster Management**: Create and manage clusters with a multi-step wizard
- **Node Monitoring**: Real-time node connectivity status
- **Metrics Visualization**: Charts for CPU, memory, and network usage
- **Log Viewer**: Filterable system logs and events
- **Configuration Management**: System settings and cluster configuration
- **Authentication**: JWT token-based authentication with login page
- **Responsive Design**: Works across desktop and tablet devices

## Architecture
- **Frontend Framework**: React.js with JavaScript
- **UI Library**: Material-UI components
- **State Management**: Redux Toolkit
- **Routing**: React Router
- **API Communication**: Axios with REST API
- **Real-time Updates**: WebSocket connections
- **Charts**: Recharts library

## Design Compliance
The UI follows the specifications outlined in the front-end specification document (docs/front-end-spec.md):
- Color palette: Forest Green (#2E7D32), Blue (#1976D2), Orange (#FF9800), Red (#D32F2F)
- Typography: Roboto family with specified sizes
- Component library: Material Design components
- Accessibility: WCAG 2.1 AA compliance

## File Structure
```
src/ui/
├── components/          # Reusable UI components
│   ├── Header.js        # Application header with logout
│   ├── Sidebar.js       # Navigation sidebar
│   ├── SummaryCard.js   # Dashboard summary cards
│   ├── ClusterHealthOverview.js  # Cluster visualization
│   ├── NodeConnectivityStatus.js # Node status display
│   ├── MetricsVisualization.js  # Charts for metrics
│   └── LogViewer.js     # Filterable log display
├── containers/          # Page-level components
│   ├── App.js           # Main application with routing
│   ├── Dashboard.js     # Dashboard with real-time data
│   ├── Clusters.js      # Cluster management page
│   ├── Nodes.js         # Node monitoring page
│   ├── Configuration.js # System configuration page
│   ├── Monitoring.js    # Metrics visualization page
│   ├── Alerts.js        # Alert management page
│   └── LoginPage.js     # Authentication page
├── services/            # API and WebSocket services
│   ├── apiService.js    # API communication service
│   └── WebSocketService.js # WebSocket for real-time updates
├── utils/               # Utility functions
│   └── authUtils.js     # Authentication utilities
├── store/               # Redux store configuration
├── styles/              # Global styles (if any)
├── index.js             # Application entry point
└── index.css            # Global styles
```

## API Integration
The UI connects to the AWARE backend API to fetch real-time data:

### Endpoints Used:
- `/api/cluster/status` - Get cluster status information
- `/api/cluster/config` - Get/update cluster configuration
- `/api/cluster/metrics` - Get cluster performance metrics
- `/api/nodes` - Get list of all nodes
- `/api/nodes/:nodeId` - Get specific node information
- `/api/alerts` - Get/list system alerts
- `/api/cluster` - Create new clusters
- `/login` - Authentication endpoint (public)

### Authentication Flow:
1. User accesses `/login` page
2. Credentials are sent to `/login` endpoint
3. Server returns JWT token
4. Token is stored in localStorage
5. Token is included in Authorization header for all subsequent requests
6. On logout, token is removed from localStorage

## Testing
The UI includes comprehensive test coverage:
- Unit tests for individual components
- Integration tests for UI flows
- API tests for backend endpoints

### Test Files:
- `tests/ui-unit.test.js` - Unit tests for UI components
- `tests/ui-integration.test.js` - Integration tests for UI flows
- `tests/api.test.js` - API endpoint tests

## Security Features
- JWT token-based authentication
- Protected routes that require authentication
- Secure storage of tokens in localStorage
- Request interceptors for adding authentication headers
- Route-based access control

## Performance Optimizations
- Loading states for better UX during API calls
- Data refresh intervals to keep information current
- Efficient component rendering and state management
- Pagination for large data sets (alerts logs)

## Next Steps
1. Deploy the application for production use
2. Implement additional security measures
3. Add more advanced monitoring features
4. Expand node management capabilities
5. Add user roles and permissions system