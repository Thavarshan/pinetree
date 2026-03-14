FROM node:20-alpine AS base
WORKDIR /app

RUN npm i -g pnpm@9.15.0

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/exporter/package.json packages/exporter/package.json

RUN pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build
# Vite bakes these into the bundle at build time
ARG VITE_API_BASE_URL
ARG VITE_API_KEY
COPY . .
RUN pnpm -r --filter @pinetree/db prisma:generate
RUN pnpm build --filter @pinetree/dashboard

FROM nginx:alpine AS runner
COPY --from=build /app/apps/dashboard/dist /usr/share/nginx/html
COPY --from=build /app/apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
