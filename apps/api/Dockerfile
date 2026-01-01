FROM node:20-alpine AS base
WORKDIR /app

RUN npm i -g pnpm@9.15.0

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json eslint.config.mjs prettier.config.cjs ./
COPY apps/api/package.json apps/api/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/exporter/package.json packages/exporter/package.json

RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm -r --filter @pinetree/db prisma:generate
RUN pnpm build --filter @pinetree/api...

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/db/prisma ./packages/db/prisma
COPY --from=build /app/packages/exporter/dist ./packages/exporter/dist

EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
