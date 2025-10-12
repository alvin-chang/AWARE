// Resource service to handle distributed system resource-related operations

class ResourceService {
  constructor() {
    // In a real implementation, this would connect to actual distributed computing resources
    // For now, we'll use mock data
    this.resources = [
      { id: 1, name: 'Compute Node A', location: 'Datacenter 1', status: 'active', type: 'compute', utilization: 65, capacity: 100 },
      { id: 2, name: 'Storage Node B', location: 'Datacenter 2', status: 'active', type: 'storage', utilization: 80, capacity: 100 },
      { id: 3, name: 'Load Balancer C', location: 'Datacenter 3', status: 'maintenance', type: 'network', utilization: 0, capacity: 200 },
      { id: 4, name: 'Database Node D', location: 'Datacenter 4', status: 'active', type: 'database', utilization: 45, capacity: 50 },
      { id: 5, name: 'Cache Node E', location: 'Datacenter 5', status: 'active', type: 'cache', utilization: 70, capacity: 80 }
    ];
  }

  // Get all available resources
  getResources() {
    return this.resources;
  }

  // Get a specific resource by ID
  getResourceById(id) {
    return this.resources.find(resource => resource.id === parseInt(id));
  }

  // Update resource status
  updateResourceStatus(id, status) {
    const resourceIndex = this.resources.findIndex(resource => resource.id === parseInt(id));
    if (resourceIndex !== -1) {
      this.resources[resourceIndex].status = status;
      return this.resources[resourceIndex];
    }
    return null;
  }

  // Get active resources only
  getActiveResources() {
    return this.resources.filter(resource => resource.status === 'active');
  }
}

module.exports = new ResourceService();