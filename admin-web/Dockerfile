FROM node:22-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=http://localhost:3100/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY package.json package-lock.json ./
COPY admin-web/package.json admin-web/package.json
COPY backend/package.json backend/package.json
RUN npm ci
COPY admin-web admin-web
RUN npm run build -w @wms/admin-web

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/admin-web/.next/standalone ./
COPY --from=build /app/admin-web/.next/static ./admin-web/.next/static
COPY --from=build /app/admin-web/public ./admin-web/public
EXPOSE 3000
CMD ["node", "admin-web/server.js"]
