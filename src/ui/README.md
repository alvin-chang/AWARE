# AWARE Web UI

The web-based user interface for AWARE (Autonomous Warehouse Automated Resource Engine) cluster management.

## Overview

This React-based application provides a dashboard for monitoring and managing AWARE clusters. It connects to the AWARE API to provide real-time information about cluster health, node status, and system metrics.

## Features

- **Dashboard**: Overview of all clusters with status indicators
- **Cluster Management**: Create, view, and manage clusters
- **Node Monitoring**: Real-time view of node health and connectivity
- **Configuration**: System settings and preferences
- **Monitoring**: Detailed metrics and logs
- **Alerts**: Notifications and issue tracking

## Prerequisites

Before running this application, ensure you have:

- Node.js (version 16 or higher)
- npm or yarn package manager
- Access to the AWARE API backend

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd aware-ui
   ```

2. Install dependencies:
   ```bash
   npm install
   # or
   yarn install
   ```

3. Create a `.env` file in the root directory with the following content:
   ```
   REACT_APP_API_URL=http://localhost:3000/api
   ```
   
   Replace `http://localhost:3000/api` with the actual URL of your AWARE API.

## Running the Application

### Development Mode
To run the application in development mode with hot reloading:

```bash
npm start
# or
yarn start
```

The application will be accessible at `http://localhost:3000`.

### Production Build
To create a production-ready build:

```bash
npm run build
# or
yarn build
```

The optimized build will be created in the `build` directory.

## Project Structure

```
src/
├── components/          # Reusable UI components
│   ├── Header.js        # Application header
│   ├── Sidebar.js       # Navigation sidebar
│   ├── SummaryCard.js   # Dashboard summary cards
│   └── ...              # Other components
├── containers/          # Page-level components
│   ├── Dashboard.js     # Main dashboard page
│   ├── Clusters.js      # Cluster management page
│   ├── Nodes.js         # Node monitoring page
│   └── ...              # Other pages
├── services/            # API and WebSocket services
│   ├── apiService.js    # API communication
│   └── WebSocketService.js # Real-time updates
├── store/               # Redux store configuration
├── utils/               # Utility functions
├── styles/              # Global styles (if any)
├── App.js               # Main application component
├── index.js             # Application entry point
└── index.css            # Global styles
```

## Technologies Used

- React.js with functional components and hooks
- Material-UI for UI components and styling
- Redux Toolkit for state management
- React Router for navigation
- Axios for API requests
- Recharts for data visualization
- WebSocket for real-time updates

## API Integration

The application communicates with the AWARE backend API using the service layer in `src/services/apiService.js`. It supports:

- Authentication with JWT tokens
- CRUD operations for clusters and nodes
- Real-time updates via WebSocket
- Error handling and retry mechanisms

## Security

- JWT-based authentication
- Secure storage of tokens in localStorage with proper validation
- Request interceptors for adding authentication headers
- Error handling for unauthorized access

## License

This project is part of the AWARE (Autonomous Warehouse Automated Resource Engine) system.