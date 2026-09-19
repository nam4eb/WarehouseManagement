FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY packages/openapi/package.json packages/openapi/package.json
RUN npm ci
COPY backend backend
COPY packages packages
RUN npm run build -w backend

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY packages/openapi/package.json packages/openapi/package.json
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/backend/migrations backend/migrations
EXPOSE 3000
CMD ["node", "backend/dist/main.js"]
