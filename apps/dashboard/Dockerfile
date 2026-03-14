FROM node:20-alpine AS build
WORKDIR /app

RUN npm i -g pnpm@9.15.0

# Install deps first for layer caching
COPY package.json ./
RUN pnpm install --ignore-scripts

# Vite bakes these into the bundle at build time
ARG VITE_API_BASE_URL
ARG VITE_API_KEY

COPY . .
RUN pnpm build

FROM nginx:alpine AS runner
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=build /app/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
