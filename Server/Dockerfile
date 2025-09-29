# Use multi-stage build for optimization
FROM node:22 AS build
WORKDIR /usr/local/apps/citrineos

COPY . .
RUN npm run install-all && npm run build

# Production stage
FROM node:22-slim AS production

WORKDIR /usr/local/apps/citrineos

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
dumb-init \
&& rm -rf /var/lib/apt/lists/* \
&& groupadd -r citrineos && useradd -r -g citrineos citrineos

COPY --from=build --chown=citrineos:citrineos /usr/local/apps/citrineos /usr/local/apps/citrineos

# Switch to non-root user
USER citrineos

EXPOSE 8080 8081 8082 8083 8084 8085

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "run", "start-docker-cloud"]