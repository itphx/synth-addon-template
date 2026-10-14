# synth-addon-template

**Шаблон внешнего сервиса-надстройки (add-on)** агентной платформы Synth: скелет
репозитория, CI, образа, `docker-compose`, Helm-чарта и **контракта интеграции** —
чтобы новый add-on поднимался быстро и единообразно.

## Что такое add-on

**Add-on** — **внешний сервис** со своим репозиторием, образами и деплоем, который
общается с Synth только по публичным контрактам: **API v2**, **MCP** и **внешние
события**.

Это **не плагин**: add-on не монтируется в процесс ядра и не получает точек
расширения Extension API. Терминология жёсткая — Plugin ≠ Add-on ≠ Declarative;
основной безопасный путь расширения — именно add-on.

Полный контракт (точки интеграции, обязательные требования, совместимость,
чек-лист готовности) — **[docs/contract.md](./docs/contract.md)**. Основание —
AD-086 (класс «внешние сервисы-надстройки») и AD-090 (Plugin ≠ Add-on ≠ Declarative)
в репозитории Synth: <https://gitverse.ru/itphx/synth>.

## Стек

TypeScript (strict, ESM, NodeNext), [pnpm workspaces](https://pnpm.io/workspaces),
[Hono](https://hono.dev/) (HTTP), [MCP SDK](https://github.com/modelcontextprotocol)
(инструменты агенту), [Zod](https://zod.dev/) (валидация),
[Vitest](https://vitest.dev/) (тесты), ESLint 9 + TypeScript-ESLint, Prettier.

- **Node.js** ≥ 22, **pnpm** ≥ 10.
- Воркспейс из **двух пакетов** — пример обеих ролей:
  - `apps/example` — **сервис**: запускается (HTTP + MCP stdio), имеет `bin`;
  - `packages/example-lib` — **библиотека**: не запускается, импортируется сервисом
    (`workspace:*`) — общий egress-слой (прокси, AD-088).
- Хранение — JSON через `FileStore` (атомарная запись `*.tmp.<uuid>` → `rename()`).
- Конфиг — приоритет **CLI-флаг > env > файл секретов > дефолт**; пустая строка
  = отсутствие значения (`envOr`).

## Как поднять новый add-on по шаблону

1. **Скопировать** каталог шаблона в новый репозиторий:

   ```bash
   cp -r addons/synth-addon-template addons/synth-<ваш-addon>
   cd addons/synth-<ваш-addon>
   rm -rf .git && git init
   ```

2. **Переименовать** пример под свой сервис:
   - `apps/example` → `apps/<ваш-сервис>`, `package.json` → `@itphx/synth-addon-<ваш>`;
   - `packages/example-lib` → `packages/<ваша-библиотека>`, `package.json` →
     `@itphx/synth-addon-<ваша>-lib`; обновить импорт `workspace:*` в сервисе;
   - `addon.json` → своё `name`, `host`, `contracts`, `description`;
   - префикс env `SYNTH_ADDON_*` → свой (например, `SYNTH_TG_*`);
   - Helm-чарт `charts/synth-addon` → `charts/<ваш-чарт>`, обновить `name` в
     `Chart.yaml` и `_helpers.tpl`.
3. **Реализовать** домен: HTTP-роуты (`apps/*/src/server.ts`), MCP-тулы
   (`apps/*/src/mcp.ts`), общую логику — в `packages/*`; при необходимости —
   клиент API v2 и отправку внешних событий (`POST /api/v2/events`).
4. **Проверить** по чек-листу [docs/contract.md](./docs/contract.md) §6.
5. **Задеплоить**: `docker/Dockerfile` → образ, Helm-чарт → кластер, либо
   `docker-compose.yml` локально (см. [docs/deployment.md](./docs/deployment.md)).

## Структура

```text
synth-addon-template/
├── addon.json                  # манифест add-on'а (kind/host/contracts)
├── apps/example/               # СЕРВИС (роль «app»): HTTP + MCP stdio, bin
├── packages/example-lib/       # БИБЛИОТЕКА (роль «lib»): общий egress-слой
├── skills/example/SKILL.md     # пример скилла формата AD-046
├── examples/secret.yaml        # пример Secret (обычный манифест, не Helm)
├── docker/Dockerfile           # multi-stage образ сервиса (node:22-alpine)
├── docker-compose.yml          # локальный запуск + volume для data
├── charts/synth-addon/         # Helm-чарт (только k8s + NOTES.txt)
├── docs/contract.md            # контракт add-on'а (канонический источник)
├── docs/configuration.md       # конфигурация и секреты
├── docs/deployment.md          # docker/compose/K8s/Helm
├── README.md
└── AGENTS.md
```

## Команды

Из корня репозитория:

```bash
pnpm install
pnpm build        # сборка всех пакетов (tsc, по графу зависимостей)
pnpm typecheck    # проверка типов
pnpm lint         # ESLint
pnpm test         # Vitest
pnpm clean        # очистка dist/
```

Запуск примера (после `pnpm build`):

```bash
# HTTP API (:7100), опционально с Bearer-токеном и egress-прокси
node apps/example/dist/index.js --token dev-token --proxy socks5://proxy:9050

# MCP-сервер по stdio (для движка)
node apps/example/dist/index.js --mcp

# Справка по флагам
node apps/example/dist/index.js --help
```

Пример запросов:

```bash
curl -s http://127.0.0.1:7100/health
curl -s -H 'Authorization: Bearer dev-token' http://127.0.0.1:7100/api/example/ping
curl -s -X POST -H 'Authorization: Bearer dev-token' -H 'content-type: application/json' \
  -d '{"message":"привет"}' http://127.0.0.1:7100/api/example/echo
```

## Конфигурация и секреты

Приоритет: **CLI-флаг > env > файл секретов > дефолт**; пустая строка = отсутствие
значения. Полный справочник (env/CLI, секрет-файлы, Kubernetes Secret) —
[docs/configuration.md](./docs/configuration.md). Пример окружения для compose —
[.env.example](./.env.example).

## Деплой

Локально — `docker compose up --build`; Kubernetes — Helm-чарт `charts/synth-addon`
(секреты — через `existingSecret`). Подробности —
[docs/deployment.md](./docs/deployment.md).

## Лицензия

MIT — см. [LICENSE](./LICENSE).
