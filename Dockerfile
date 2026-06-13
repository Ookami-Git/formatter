# Use a lightweight, secure Node.js base image
FROM node:20-alpine AS runner

# Install git for repository cloning
RUN apk add --no-cache git

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000
ENV CONFIG_PATH=/app/examples/schema.yaml

# Create application directory
WORKDIR /app

# Copy dependency definition and install packages
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy application source code
COPY server.js ./
COPY lib ./lib
COPY public ./public

# Copy default schema configuration
COPY examples ./examples

# Ensure the config folder has appropriate permissions so that if mounted it can be accessed
RUN chmod -R 755 /app

# Create a writable directory for Git clone (owned by node user)
RUN mkdir -p /app/git-repos && chown node:node /app/git-repos

# Run as non-root user for security in Kubernetes
USER node

# Expose server port
EXPOSE 3000

# Health check instructions for Docker
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); http.get('http://localhost:' + (process.env.PORT || 3000) + '/healthz', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }).on('error', () => { process.exit(1); });"

# Start application
CMD ["node", "server.js"]
