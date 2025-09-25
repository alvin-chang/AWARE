# AWARE - Autonomous Warehouse Automated Resource Engine

AWARE is a clustering system that mimics ant colony behavior to create self-organizing computing clusters. Unlike traditional clusters with pre-defined nodes, AWARE nodes have "DNA" with basic instincts that allow them to dynamically form queen-worker hierarchies.

## Table of Contents
- [Overview](#overview)
- [Architecture](#architecture)
- [Features](#features)
- [Getting Started](#getting-started)
- [Development](#development)
- [Testing](#testing)
- [Configuration](#configuration)
- [API Documentation](#api-documentation)
- [Contributing](#contributing)

## Overview

The AWARE system enables users to specify cluster requirements at a high level (e.g., "a cluster for web traffic with front-end, middleware, database, and storage") without needing to define specific hostnames or MAC addresses. The system automatically provisions and organizes the infrastructure.

Key characteristics:
- Self-organizing clusters with automatic node discovery
- Queen-worker hierarchy with failover capabilities
- Distributed consensus algorithms for leader election
- Secure API for cluster management
- Scalable to 100+ nodes

## Architecture

### Components
- **Node Discovery Service**: Handles node broadcast and detection
- **Election Manager**: Manages queen election process using Raft consensus
- **Cluster API Gateway**: Provides RESTful interface for cluster operations
- **Communication Layer**: Handles secure node-to-node communication
- **Configuration Store**: Maintains cluster configuration and state

### Technology Stack
- **Backend**: Node.js/JavaScript with Express
- **Database**: etcd for distributed configuration storage
- **API**: REST API with JSON payload
- **Infrastructure**: Docker containers for deployment
- **Security**: JWT for authentication

## Features

### Node Discovery
- Automatic broadcast and detection of available nodes
- Support for clusters up to 100 nodes
- Network partition handling
- Node status monitoring

### Queen Election
- Automatic leader election when cluster starts
- Failover mechanism when queen node fails
- Raft-inspired consensus algorithm
- Preservation of cluster state during elections

### API Management
- RESTful API for cluster operations
- JWT-based authentication
- Comprehensive error handling
- Real-time status updates

## Getting Started

### Prerequisites
- Node.js 14+
- Docker (for containerized deployment)
- etcd cluster (for production) or local storage (for development)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/username/aware.git
cd aware
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Start the service:
```bash
npm start
```

### Basic Usage

1. Start the first node (it will become queen):
```bash
NODE_ID=queen-1 NODE_LIST=queen-1,worker-1,worker-2 npm start
```

2. Start worker nodes:
```bash
NODE_ID=worker-1 NODE_LIST=queen-1,worker-1,worker-2 npm start
```

3. Check cluster status:
```bash
curl -H "Authorization: Bearer <token>" http://localhost:3000/cluster/status
```

## Development

### Project Structure
```
src/
├── node-discovery/     # Node discovery service
├── election/          # Election manager implementation
├── api/               # API gateway
├── index.js           # Main application entry point
tests/
├── unit/              # Unit tests
├── integration/       # Integration tests
docs/                  # Documentation
stories/               # Development stories
```

### Running in Development Mode
```bash
npm run dev
```

### Adding New Features
1. Create a feature branch: `git checkout -b feature/new-feature`
2. Follow the story-driven development approach
3. Write unit tests for new functionality
4. Update documentation as needed
5. Submit a pull request

## Testing

### Running Tests
```bash
# Run all tests
npm test

# Run specific test file
npm test tests/unit/node-discovery.test.js

# Run with coverage
npm test -- --coverage
```

### Test Structure
- Unit tests for individual components
- Integration tests for system interactions
- Performance tests for scalability verification

## Configuration

### Environment Variables
- `NODE_ID`: Unique identifier for this node
- `NODE_LIST`: Comma-separated list of all nodes in the cluster
- `DISCOVERY_PORT`: Port for discovery broadcasts (default: 41234)
- `BROADCAST_PORT`: Port for broadcast messages (default: 41235)
- `API_PORT`: Port for API gateway (default: 3000)
- `SECRET_KEY`: JWT secret key

### Configuration Files
- `config/default.json`: Default configuration values
- `config/production.json`: Production-specific settings

## API Documentation

### Authentication
All API endpoints (except `/health` and `/login`) require a JWT token in the Authorization header:
```
Authorization: Bearer <token>
```

### Endpoints

#### Health Check
```
GET /health
```
Returns the health status of the API gateway.

#### Authentication
```
POST /login
```
Requires username and password in request body, returns JWT token.

#### Cluster Status
```
GET /cluster/status
```
Returns the current cluster status including leader information.

#### Node Management
```
GET /nodes
```
Returns a list of all known nodes.

```
GET /nodes/:nodeId
```
Returns information about a specific node.

```
POST /cluster
```
Creates a new cluster (requires cluster configuration in body).

## Contributing

We welcome contributions to the AWARE project! Please see our [Contributing Guide](CONTRIBUTING.md) for details on how to get started.

### Development Guidelines
- Follow the story-driven development approach
- Write comprehensive tests for all functionality
- Maintain high code coverage
- Follow security best practices

## License

This project is licensed under the GPL v3 License - see the [LICENSE](LICENSE) file for details.

## Support

For support, please open an issue in the GitHub repository or contact the maintainers.

---
*Project Status: Active Development*  
*Last Updated: September 25, 2025*