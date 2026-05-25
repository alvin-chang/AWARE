# Use the official Node.js runtime as the base image
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json (if available) to the working directory
COPY package*.json ./

# Install the application dependencies
RUN npm install

# Copy the rest of the application code to the working directory
COPY . .

# Create scripts directory if it doesn't exist
RUN mkdir -p scripts

# Copy scripts directory
COPY scripts/ scripts/

# Build the UI for production
WORKDIR /app/src/ui
RUN npm install
RUN npm run build

# Go back to main directory
WORKDIR /app

# Expose the port the app runs on
EXPOSE 3000

# Define the command to run the application
CMD ["npm", "start"]