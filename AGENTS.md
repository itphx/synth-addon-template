# synth-addon-template — соглашения репозитория

> Кратко для агентов и людей. Полный контракт — [docs/contract.md](./docs/contract.md).
> Язык — русский.

## Назначение

Шаблон репозитория add-on'а: **внешний сервис** (вне процесса ядра Synth),
общающийся по публичным контрактам — **API v2**, **MCP**, **внешние события**.
Основание — AD-086 (класс «внешние сервисы-надстройки») и AD-090
(Plugin ≠ Add-on ≠ Declarative).

Шаблон также умеет **ставить свои декларативные ресурсы** (MCP-серверы, скиллы)
в инстанс Synth при деплое — Helm-чарт (`autoInstall`) + референсный инсталлятор
`scripts/install-into-synth.mjs` по манифесту `synth.pack.provides`.

**Единый манифест расширения — `synth.pack`** (JSON в корне репозитория, без
расширения в имени; пришёл на смену разрозненным манифестам). Он используется
**всеми** классами
расширений и контент-паков, класс задаётся полем `kind`
(`plugin` | `gateway` | `addon` | `pack`). Для контент-паков дополнительно
задаётся `kind: "pack"` + `packType`
(`skills` | `agents` | `mcp` | `themes` | `i18n` | `providers` | `prompts` |
`automation` | `policies` | `memory` | `ui`).

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
9. **Декларативный контракт ресурсов — `synth.pack.provides`.** Что аддон даёт
   Synth (MCP-сервер и/или скиллы), описывается в манифесте, а не в коде
   установки: `provides.mcp` (имя/транспорт/порт/путь/описание) и
   `provides.skills[]` (`name` + `path` к дереву скилла). Имена совпадают с
   реальными (реестр MCP, имена скиллов); `{tenant}` в `path` — единственное
   место подстановки среды.
10. **Авто-установка — через чарт и идемпотентный инсталлятор.** Установка
    ресурсов в инстанс Synth — hook-Job чарта (`autoInstall` →
    `templates/install-job.yaml`) и `scripts/install-into-synth.mjs`; повторный
    `helm upgrade`/запуск **обновляет** конфиг (409 → update), а не плодит
    дубликаты. Никакого ручного редактирования реестра MCP/скиллов в обход API.
11. **Токены установки — не в git и не в логах.** Installer-ключ
    (`autoInstall.installerSecretName` → env `SYNTH_INSTALL_TOKEN`) и заголовки
    MCP лежат в Secret; в values — только имена; в вывод инсталлятора попадает
    лишь факт «задан/не задан».
12. **Аддон без сервиса валиден.** `service.enabled=false` (без Deployment/
    Service/PVC/Ingress) + `autoInstall.enabled=true` — штатная конфигурация
    вида «только MCP» / «только скиллы». Виды аддонов: *сервис+MCP+скиллы*,
    *только MCP*, *только скиллы*; отсутствие `provides` — тоже валидно.
13. **Коммит — только по явной просьбе пользователя.** Новые зависимости — с
    разрешения.
14. Стиль: strict TS, kebab-case файлы, ESM/NodeNext; инсталлятор — `.mjs` без
    внешних зависимостей (`node:*` + global `fetch`).

## Границы (что add-on'у НЕДОСТУПНО)

- хуки жизненного цикла, `ToolRegistry`, `ProviderFactory`, UI-слоты — это
  Extension API **плагинов**;
- прямой доступ к internals ядра (`FileStore` ядра, `GatewayProvider`, сессии в
  обход API).

Доступны: API v2, MCP, внешние события (ingest + SSE/WS), привязки событий и
их API-ключи. Авто-установка пользуется только публичным API v2 (MCP-реестр,
скиллы) либо файлами standalone-инстанса (`--config`/`--data-dir`).

## Компоненты

| Путь | Роль |
|---|---|
| `apps/example` | Сервис `@itphx/synth-addon-example`: Hono HTTP + MCP (stdio `--mcp` и Streamable HTTP `--http`, тул `example_ping`), `bin` |
| `packages/example-lib` | Библиотека `@itphx/synth-addon-example-lib`: egress-слой (прокси) |
| `skills/example` | Пример скилла формата AD-046 |
| `scripts/install-into-synth.mjs` | Референсный инсталлятор `provides` в Synth: managed (API v2) и standalone (`--config`/`--data-dir`), `--dry-run`, идемпотентный |
| `synth.pack` | Манифест: `kind`/`host`/`contracts` + `provides` (MCP/скиллы) |
| `charts/synth-addon/` | Helm-чарт: сервис (`service.enabled`) + авто-установка (`autoInstall`) |
| `charts/synth-addon/templates/install-job.yaml` | Hook-Job (`post-install,post-upgrade`) авто-установки |
| `charts/synth-addon/templates/install-skills-configmap.yaml` | ConfigMap скиллов — для аддонов без образа |
| `docker/`, `docker-compose.yml` | Образ и локальный запуск (в образ копируются `synth.pack`/`skills`/`scripts`) |
| `examples/secret.yaml`, `examples/installer-secret.yaml` | Примеры Secret'ов: сервис и installer-ключ |
| `charts/`, `docs/` | Деплой, контракт, конфигурация |

## Команды

```bash
pnpm install
pnpm build && pnpm typecheck && pnpm lint && pnpm test
node apps/example/dist/index.js --help   # HTTP :7100 / --mcp / --http / флаги

# Авто-установка ресурсов (локальная проверка, без кластера):
node scripts/install-into-synth.mjs --config ./config.yaml --data-dir ./data \
  --service-host 127.0.0.1 --dry-run

# Чарт:
helm lint charts/synth-addon
helm template a charts/synth-addon --set autoInstall.enabled=true \
  --set autoInstall.url=http://synth-backend:5000/api/v2 \
  --set autoInstall.installerSecretName=synth-addon-installer
```

## Куда смотреть (триггеры)

| Тема | Документ |
|---|---|
| Контракт add-on'а (интеграция, требования, совместимость, чек-лист) | [docs/contract.md](./docs/contract.md) |
| Ресурсы аддона в Synth (`provides`, три вида аддонов) | [docs/contract.md](./docs/contract.md) §4.1–4.2 |
| Авто-установка (values, installer-ключ, hook-Job, проверка) | [docs/deployment.md](./docs/deployment.md) «Авто-установка ресурсов» |
| Конфигурация и секреты (включая installer-ключ) | [docs/configuration.md](./docs/configuration.md) |
| Деплой (docker/compose/K8s/Helm) | [docs/deployment.md](./docs/deployment.md) |
| Обзор и быстрый старт | [README.md](./README.md) |
| Манифест совместимости и `provides` | `synth.pack` |
| Инсталлятор | `scripts/install-into-synth.mjs` (`--help`) |
| Расширяемость и внешние события Synth (AD-086/089/090) | репозиторий Synth: <https://gitverse.ru/itphx/synth> |
