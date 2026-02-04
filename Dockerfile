# --- Build Stage ---
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build
    
# --- Production Stage ---
FROM node:20-alpine AS production
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=builder /app/dist ./dist
    
ARG GIT_COMMIT_SHA=unknown
ENV GIT_COMMIT_SHA=${GIT_COMMIT_SHA}
    
USER appuser
    
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1
    
EXPOSE 4000
CMD ["node", "dist/index.js"]