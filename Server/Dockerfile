# Use multi-stage build for optimization
FROM node:22-slim AS base
WORKDIR /usr/local/apps/citrineos
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Build stage
FROM base AS build
COPY . .
# Install all dependencies and build the entire workspace
RUN npm install --verbose && npm run build

# Production stage
FROM node:22-slim AS production
WORKDIR /usr/local/apps/citrineos

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r citrineos && useradd -r -g citrineos citrineos

# Copy built application
COPY --from=build --chown=citrineos:citrineos /usr/local/apps/citrineos ./

# Switch to non-root user
USER citrineos

EXPOSE 8080 8081 8082 8083 8084 8085

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "run", "start-docker-cloud"]