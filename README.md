# synth-addon-template

**Шаблон внешнего сервиса-надстройки (add-on)** агентной платформы Synth: скелет
репозитория, CI, образа, `docker-compose`, Helm-чарта с **авто-установкой**
ресурсов аддона, и **контракта интеграции** — чтобы новый add-on поднимался
быстро и единообразно.

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

## Что аддон умеет объявлять и ставить

Аддон описывает свои декларативные ресурсы в манифесте **`synth.pack` → `provides`**
(MCP-сервер и/или скиллы), а Helm-чарт ставит их в инстанс Synth hook-Job'ом
(`autoInstall`) через референсный инсталлятор `scripts/install-into-synth.mjs`:

> **Единый манифест `synth.pack`.** JSON в корне репозитория (без расширения в имени)
> — общий для **всех** классов расширений и контент-паков; класс задаётся полем
> `kind` (`plugin` | `gateway` | `addon` | `pack`). Для контент-паков — `kind: "pack"`
> + `packType` (`skills` | `agents` | `mcp` | `themes` | `i18n` | `providers` |
> `prompts` | `automation` | `policies` | `memory` | `ui`).

```json
"provides": {
  "mcp": { "name": "synth-addon-example", "transport": "http", "port": 7100, "path": "/mcp", "description": "…" },
  "skills": [{ "name": "example", "path": "skills/example" }]
}
```

Оба поля необязательны, отсюда **три вида аддонов**:

| Вид | `provides` | Values |
|---|---|---|
| Сервис + MCP + скиллы | `mcp` + `skills` | значения по умолчанию + `autoInstall.enabled=true` |
| Только MCP / только скиллы | одно из двух | `service.enabled=false`, `autoInstall.enabled=true` |
| Ничего декларативного | — | `service.enabled=false`, `autoInstall.enabled=false` |

Аддон **без сервиса** — полноценный кейс: Deployment/Service/PVC/Ingress не
рендерятся, ресурсы ставит Job (файлы скиллов и инсталлятор при отсутствии образа
берутся из ConfigMap). Установка идемпотентна (повторный `helm upgrade` обновляет
конфиг, а не плодит дубликаты). Подробности — [docs/contract.md](./docs/contract.md)
§4.1–4.2 и [docs/deployment.md](./docs/deployment.md) «Авто-установка ресурсов».

## Стек

TypeScript (strict, ESM, NodeNext), [pnpm workspaces](https://pnpm.io/workspaces),
[Hono](https://hono.dev/) (HTTP), [MCP SDK](https://github.com/modelcontextprotocol)
(инструменты агенту: stdio и Streamable HTTP), [Zod](https://zod.dev/) (валидация),
[Vitest](https://vitest.dev/) (тесты), ESLint 9 + TypeScript-ESLint, Prettier.

- **Node.js** ≥ 22, **pnpm** ≥ 10.
- Воркспейс из **двух пакетов** — пример обеих ролей:
  - `apps/example` — **сервис**: запускается (HTTP + MCP stdio/HTTP), имеет `bin`;
  - `packages/example-lib` — **библиотека**: не запускается, импортируется сервисом
    (`workspace:*`) — общий egress-слой (прокси, AD-088).
- Хранение — JSON через `FileStore` (атомарная запись `*.tmp.<uuid>` → `rename()`).
- Конфиг — приоритет **CLI-флаг > env > файл секретов > дефолт**; пустая строка
  = отсутствие значения (`envOr`).
- Инсталлятор ресурсов — `.mjs` **без внешних зависимостей** (`node:*` + global
  `fetch`), с `--dry-run` и идемпотентным upsert'ом.

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
   - `synth.pack` → своё `name`, `host`, `contracts`, `description`,
     **`provides`** (MCP/скиллы; нет ресурсов — уберите поле);
   - префикс env `SYNTH_ADDON_*` → свой (например, `SYNTH_TG_*`);
   - Helm-чарт `charts/synth-addon` → `charts/<ваш-чарт>`, обновить `name` в
     `Chart.yaml` и `_helpers.tpl`.
3. **Реализовать** домен: HTTP-роуты (`apps/*/src/server.ts`), MCP-тулы
   (`apps/*/src/mcp.ts` — stdio `--mcp` и/или HTTP `--http` на пути из
   `provides.mcp.path`), общую логику — в `packages/*`; при необходимости —
   клиент API v2 и отправку внешних событий (`POST /api/v2/events`).
4. **Проверить** по чек-листу [docs/contract.md](./docs/contract.md) §6 и
   отрендерить чарт для своего вида аддона (`helm template`, см. README §«Деплой
   и авто-установка»); локально проверить инсталлятор с `--dry-run`.
5. **Задеплоить**: `docker/Dockerfile` → образ, Helm-чарт → кластер (при
   необходимости с `autoInstall`), либо `docker-compose.yml` локально
   (см. [docs/deployment.md](./docs/deployment.md)).

## Структура

```text
synth-addon-template/
├── synth.pack                  # манифест add-on'а (kind/host/contracts + provides)
├── apps/example/               # СЕРВИС (роль «app»): HTTP + MCP (stdio/HTTP), bin
├── packages/example-lib/       # БИБЛИОТЕКА (роль «lib»): общий egress-слой
├── skills/example/SKILL.md     # пример скилла формата AD-046
├── scripts/install-into-synth.mjs  # инсталлятор ресурсов (provides) в Synth
├── examples/                   # примеры Secret'ов (сервис, installer-ключ)
├── docker/Dockerfile           # multi-stage образ (synth.pack/skills/scripts внутри)
├── docker-compose.yml          # локальный запуск + volume для data
├── charts/synth-addon/         # Helm-чарт: сервис + autoInstall hook-Job
├── docs/contract.md            # контракт add-on'а (канонический источник)
├── docs/configuration.md       # конфигурация и секреты
├── docs/deployment.md          # docker/compose/K8s/Helm/авто-установка
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

# HTTP API + MCP по Streamable HTTP на /mcp (совпадает с provides.mcp.path)
node apps/example/dist/index.js --http --port 7100

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
значения. Полный справочник (env/CLI, секрет-файлы, Kubernetes Secret,
installer-ключ авто-установки) — [docs/configuration.md](./docs/configuration.md).
Пример окружения для compose — [.env.example](./.env.example).

## Деплой и авто-установка

Локально — `docker compose up --build`; Kubernetes — Helm-чарт `charts/synth-addon`
(секреты — через `existingSecret`, installer-ключ — через
`autoInstall.installerSecretName`).

```bash
helm lint charts/synth-addon
helm install synth-addon charts/synth-addon \
  --set existingSecret=synth-addon-secrets \
  --set image.repository=registry.example.com/your-addon \
  --set autoInstall.enabled=true \
  --set autoInstall.url=http://synth-backend.synth.svc.cluster.local:5000/api/v2 \
  --set autoInstall.installerSecretName=synth-addon-installer
```

Hook-Job поставит MCP-сервер и скиллы из `provides` (идемпотентно). Подробности,
проверка результата и случай «аддон без сервиса/образа» —
[docs/deployment.md](./docs/deployment.md).

## Лицензия

MIT — см. [LICENSE](./LICENSE).
