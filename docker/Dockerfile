# ============================================================================
# Образ сервиса-надстройки Synth (add-on).
# Multi-stage: сборка pnpm-workspace (сервис + библиотека) → тонкий runtime
# только с prod-зависимостями. Базовый образ — node:22-alpine.
# ============================================================================

# --- Этап 1: сборка workspace ---
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /src

# Сначала манифесты — слой установки зависимостей кэшируется при правках кода.
COPY package.json pnpm-workspace.yaml ./
COPY apps/example/package.json apps/example/
COPY packages/example-lib/package.json packages/example-lib/

# lockfile может отсутствовать (шаблон); при наличии — используется автоматически.
RUN pnpm install

# Исходники и сборка (pnpm собирает по графу зависимостей: lib → app).
COPY tsconfig.base.json ./
COPY apps/example apps/example
COPY packages/example-lib packages/example-lib
RUN pnpm build

# --- Этап 2: runtime ---
FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@latest --activate

ENV NODE_ENV=production
WORKDIR /app

# Только prod-зависимости приложения и его workspace-библиотек.
COPY package.json pnpm-workspace.yaml ./
COPY apps/example/package.json apps/example/
COPY packages/example-lib/package.json packages/example-lib/
RUN pnpm install --prod

# Собранный код библиотеки и сервиса.
COPY --from=builder /src/packages/example-lib/dist packages/example-lib/dist
COPY --from=builder /src/apps/example/dist apps/example/dist

# JSON-хранилище (монтируется volume'ом в compose/K8s).
ENV SYNTH_ADDON_HOST=0.0.0.0
ENV SYNTH_ADDON_PORT=7100
ENV SYNTH_ADDON_DATA_DIR=/var/lib/synth-addon/data

VOLUME ["/var/lib/synth-addon/data"]
EXPOSE 7100

ENTRYPOINT ["node", "apps/example/dist/index.js"]
