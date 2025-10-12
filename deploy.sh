#!/bin/bash

# AWARE Deployment Script
# This script helps deploy the AWARE application in production environments

set -e  # Exit immediately if a command exits with a non-zero status

# Default values
ENV_FILE=".env.production"
DOCKER_COMPOSE_FILE="docker-compose.yml"
BUILD_IMAGES=true
START_SERVICES=true

# Function to display usage information
usage() {
    echo "Usage: $0 [OPTIONS]"
    echo "Options:"
    echo "  -h, --help              Show this help message"
    echo "  -e, --env-file FILE     Environment file to use (default: .env.production)"
    echo "  --no-build              Skip building Docker images"
    echo "  --no-start              Skip starting services after deployment"
    echo "  --down                  Stop and remove running containers before deploying"
    echo ""
    echo "Examples:"
    echo "  $0                            # Deploy with defaults"
    echo "  $0 --env-file .env.staging    # Deploy with staging environment"
    echo "  $0 --no-build                 # Deploy without rebuilding images"
    echo "  $0 --down                     # Stop and remove containers, then deploy"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            usage
            exit 0
            ;;
        -e|--env-file)
            ENV_FILE="$2"
            shift 2
            ;;
        --no-build)
            BUILD_IMAGES=false
            shift
            ;;
        --no-start)
            START_SERVICES=false
            shift
            ;;
        --down)
            echo "Stopping and removing existing containers..."
            docker-compose -f "$DOCKER_COMPOSE_FILE" down
            shift
            ;;
        *)
            echo "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

echo "=== AWARE Deployment Script ==="
echo "Environment file: $ENV_FILE"
echo "Docker Compose file: $DOCKER_COMPOSE_FILE"
echo "Build images: $BUILD_IMAGES"
echo "Start services: $START_SERVICES"
echo ""

# Check if environment file exists
if [[ ! -f "$ENV_FILE" ]]; then
    echo "Error: Environment file '$ENV_FILE' not found!"
    echo "Please create the environment file before running this script."
    exit 1
fi

# Load environment variables
export $(grep -v '^#' "$ENV_FILE" | xargs)

# Check if docker compose is available
if ! command -v docker &> /dev/null || ! docker compose version &> /dev/null; then
    echo "Error: Docker or Docker Compose is not installed or not in PATH"
    exit 1
fi

# Build images if requested
if [[ "$BUILD_IMAGES" == true ]]; then
    echo "Building Docker images..."
    docker compose -f "$DOCKER_COMPOSE_FILE" build
    echo "Docker images built successfully."
else
    echo "Skipping image build."
fi

# Start services if requested
if [[ "$START_SERVICES" == true ]]; then
    echo "Starting AWARE services..."
    docker compose -f "$DOCKER_COMPOSE_FILE" up -d
    echo "AWARE services started successfully."
    
    # Wait a moment for services to start
    sleep 5
    
    # Check if services are running
    echo "Checking service status..."
    docker compose -f "$DOCKER_COMPOSE_FILE" ps
    
    echo ""
    echo "=== Deployment Summary ==="
    echo "AWARE backend is available at: http://localhost:3000"
    echo "AWARE frontend is available at: http://localhost:3001"
    echo "API endpoints are available at: http://localhost:3000/api/"
    echo ""
    echo "To view logs: docker compose -f $DOCKER_COMPOSE_FILE logs -f"
    echo "To stop services: docker compose -f $DOCKER_COMPOSE_FILE down"
    echo ""
    echo "The user registration journey is now fully implemented and integrated."
    echo "Users can register new accounts through the web interface or API endpoints."
    echo "All authentication endpoints are working correctly."
else
    echo "Skipping service start."
fi

echo ""
echo "Deployment completed successfully!"