# Use the official Node.js runtime as the base image
# SC-MOD-008 (internal security audit): standardized on node:22-alpine
# to match Dockerfile.coordinator + Dockerfile.gateway.
#
# SC-MOD-005 (internal security audit, B-step): the previous single-
# stage build installed ALL dependencies (including devDeps like eslint,
# jest, c8, nodemon) and shipped them in the production image, inflating
# the attack surface and trivy findings. The new multi-stage build uses
# a `build` stage to compile (needs devDeps for the UI build + tests),
# then a slim `runtime` stage that re-installs ONLY production dependencies.
FROM node:22-alpine AS build

# Set the working directory in the container
WORKDIR /app

# Create non-root user. Same pattern as Dockerfile.coordinator and
# Dockerfile.gateway — runs the node process as 'aware' (UID 10001).
RUN addgroup -S aware && adduser -S aware -G aware

# Copy package manifests first to leverage Docker layer caching.
COPY package*.json ./

# Build stage: install ALL deps (including devDeps needed for the
# UI build + any pre-compilation tooling).
RUN npm install

# Copy the rest of the application code to the working directory
COPY . .

# Ensure scripts directory exists (some hosts .dockerignore it).
RUN mkdir -p scripts

# Build the UI for production (uses react-scripts which is a devDep).
WORKDIR /app/src/ui
RUN npm install && npm run build
WORKDIR /app

# ---------- runtime stage (no devDeps) ------------------------------
FROM node:22-alpine AS runtime

# Re-create the non-root user in the runtime image (multi-stage build
# copies nothing from `build` except the explicit COPY below).
RUN addgroup -S aware && adduser -S aware -G aware

WORKDIR /app

# Copy only the package manifests + the compiled artifacts from build.
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/package-lock.json ./package-lock.json
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts

# SC-MOD-005: install ONLY production dependencies — drops devDeps
# (eslint, jest, c8, nodemon, react-scripts, etc.) from the runtime image.
ENV NODE_ENV=production
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

# Set ownership of the app directory to the non-root user.
RUN chown -R aware:aware /app

# Switch to non-root user for runtime (fixes trivy DS-0002).
USER aware

# Expose the port the app runs on
EXPOSE 3000

# Define the command to run the application
CMD ["npm", "start"]
