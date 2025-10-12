# AWARE - Autonomous Warehouse Automated Resource Engine

AWARE (Autonomous Warehouse Automated Resource Engine) is a sophisticated distributed systems management platform that implements ant colony-inspired algorithms for cluster coordination and resource optimization. It features a self-organizing architecture that dynamically elects leaders, distributes workloads, and maintains system resilience.

## 🏗️ System Architecture

The AWARE system implements a distributed architecture with the following key components:

1. **Node Discovery Service**: Discovers and tracks nodes in the distributed system
2. **Leader Election Mechanism**: Implements Raft consensus algorithm for leader election
3. **Resource Management**: Coordinates distributed computing resources using ant-inspired algorithms
4. **API Gateway**: RESTful API service for cluster management operations
5. **Web UI**: React-based dashboard for cluster monitoring and management
6. **Authentication Service**: JWT-based authentication for secure access

## 🚀 Deployment

The system has been successfully deployed with Docker Compose and is available at:

- **Backend API Service**: http://localhost:3000
- **Frontend UI Service**: http://localhost:3001

### Deployment Commands

```bash
# Deploy the system
./deploy.sh

# View logs
docker compose logs -f

# Stop services
docker compose down

# Restart services
docker compose down && docker compose up -d
```

## 📡 API Endpoints

All API endpoints are documented in the DEPLOYMENT_SUMMARY.md file. Key endpoints include:

- Authentication: `/login`, `/register`
- Cluster Management: `/api/cluster/*`
- Node Management: `/api/nodes/*`
- Alert Management: `/api/alerts/*`
- Resource Management: `/api/resources/*`

## 🔐 Authentication

The system uses JWT-based authentication with the following default credentials:

- **Username**: admin
- **Password**: password

## 🛠️ Technologies Used

### Backend
- Node.js with Express.js
- JWT for authentication
- Raft consensus algorithm for leader election
- Ant colony-inspired algorithms for resource coordination

### Frontend
- React with Material-UI
- Responsive design for desktop and tablet
- Real-time cluster monitoring dashboard

### Infrastructure
- Docker for containerization
- Docker Compose for orchestration
- Nginx for frontend serving

## 📋 Key Features

### 1. Cluster Management Dashboard
- Real-time cluster health overview
- Node status visualization
- System metrics display
- Alert notifications

### 2. Node Discovery Service
- Automatic node discovery in the network
- Node status tracking (connected/disconnected)
- Node role identification (leader/follower)
- Response time monitoring

### 3. Leader Election Mechanism
- Raft consensus-based leader election
- Automatic failover when leader goes offline
- Term-based voting system
- Heartbeat mechanism for leader health checks

### 4. Resource Management
- Distributed computing resource coordination
- Ant colony-inspired allocation algorithms
- Resource status monitoring
- Utilization tracking

### 5. Alert System
- Cluster event notifications
- System health alerts
- Node status changes
- Resource utilization warnings

### 6. Authentication & Authorization
- JWT-based secure authentication
- Role-based access control
- Session management
- Credential validation

## 📄 Documentation

Detailed documentation for each component is available in the project's documentation files:

- System Architecture: `docs/system-architecture.md`
- API Documentation: `docs/api-documentation.md`
- Deployment Guide: `docs/deployment-guide.md`
- User Manual: `docs/user-manual.md`

## 🤝 Contributing

Contributions are welcome! Please read our contributing guidelines before submitting pull requests.

## 📄 License

This project is licensed under the GPL-3.0 License - see the LICENSE file for details.