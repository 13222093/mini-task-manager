# Production image: the backend runs with tsx and also serves the built frontend.
# bookworm (glibc) because better-sqlite3 downloads a prebuilt glibc binary at install.

# Build stage: install every workspace and build the frontend bundle.
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Package files first, so the npm ci layer is reused until dependencies change.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci
# Vite reads frontend/tsconfig.json for the JSX setting, and it extends this file.
COPY tsconfig.base.json ./
COPY shared shared
COPY frontend frontend
RUN npm run build

# Runtime stage: production dependencies of the backend, the source tsx runs, and the bundle.
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
RUN npm ci --omit=dev --workspace backend && npm cache clean --force
COPY shared/src shared/src
COPY backend/src backend/src
COPY --from=build /app/frontend/dist frontend/dist
# The SQLite file lives here. /app belongs to root, so the node user needs this directory.
RUN mkdir backend/data && chown node:node backend/data
USER node
WORKDIR /app/backend
EXPOSE 8080
# Same command as npm run start. npm forwards SIGTERM, so the container stops when Cloud Run asks.
CMD ["npm", "run", "start"]
