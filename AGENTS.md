# synth-addon-template — соглашения репозитория

> Кратко для агентов и людей. Полный контракт — [docs/contract.md](./docs/contract.md).
> Язык — русский.

## Назначение

Шаблон репозитория add-on'а: **внешний сервис** (вне процесса ядра Synth),
общающийся по публичным контрактам — **API v2**, **MCP**, **внешние события**.
Основание — AD-086 (класс «внешние сервисы-надстройки») и AD-090
(Plugin ≠ Add-on ≠ Declarative).

## Инварианты (не нарушать)

1. **Add-on — не плагин.** Сервис не монтируется в процесс core и не имеет
   Extension API/hooks. Смешивать термины запрещено.
2. **LLM внутрь сервиса не тянем.** Генерацию/понимание делает движок Synth;
   add-on — детерминированная работа (транспорт, реестр, хранение, рендер).
3. **Роли пакетов.** `apps/*` — запускаемые сервисы (с `bin`); `packages/*` —
   библиотеки, импортируются через `workspace:*`. `packages/*` **не импортируют**
   из `apps/*`.
4. **Конфиг** — приоритет CLI-флаг > env > файл секретов > дефолт; пустая/
   whitespace-строка = отсутствие значения (`envOr`).
5. **Секреты — вне git и не в логах** (`600`); в K8s — `existingSecret`.
6. **Хранение — JSON через `FileStore`** (атомарная запись `*.tmp.<uuid>` →
   `rename()`).
7. **`GET /health` — без auth**; остальные маршруты — Bearer-токен (если задан).
8. **Идемпотентность входов** — дедупликация внешних событий; в
   `POST /api/v2/events` передаётся стабильный `dedupKey`.
9. **Коммит — только по явной просьбе пользователя.** Новые зависимости — с
   разрешения.
10. Стиль: strict TS, kebab-case файлы, ESM/NodeNext.

## Границы (что add-on'у НЕДОСТУПНО)

- хуки жизненного цикла, `ToolRegistry`, `ProviderFactory`, UI-слоты — это
  Extension API **плагинов**;
- прямой доступ к internals ядра (`FileStore` ядра, `GatewayProvider`, сессии в
  обход API).

Доступны: API v2, MCP, внешние события (ingest + SSE/WS), привязки событий и
их API-ключи.

## Компоненты

| Путь | Роль |
|---|---|
| `apps/example` | Сервис `@itphx/synth-addon-example`: Hono HTTP + MCP stdio (тул `example_ping`), `bin` |
| `packages/example-lib` | Библиотека `@itphx/synth-addon-example-lib`: egress-слой (прокси) |
| `skills/example` | Пример скилла формата AD-046 |
| `docker/`, `docker-compose.yml`, `charts/synth-addon/`, `examples/` | Деплой и примеры манифестов |

## Команды

```bash
pnpm install
pnpm build && pnpm typecheck && pnpm lint && pnpm test
node apps/example/dist/index.js --help   # HTTP :7100 / --mcp / флаги
```

## Куда смотреть (триггеры)

| Тема | Документ |
|---|---|
| Контракт add-on'а (интеграция, требования, совместимость, чек-лист) | [docs/contract.md](./docs/contract.md) |
| Конфигурация и секреты | [docs/configuration.md](./docs/configuration.md) |
| Деплой (docker/compose/K8s/Helm) | [docs/deployment.md](./docs/deployment.md) |
| Обзор и быстрый старт | [README.md](./README.md) |
| Манифест совместимости | `addon.json` |
| Расширяемость и внешние события Synth (AD-086/089/090) | репозиторий Synth: <https://gitverse.ru/itphx/synth> |
