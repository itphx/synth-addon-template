# Контракт add-on'а Synth

> **Аудитория:** авторы внешних сервисов-надстроек (add-on'ов) Synth.
> **Основание:** [AD-086](https://gitverse.ru/itphx/synth) (зонтик расширяемости,
> класс «внешние сервисы-надстройки») и [AD-090](https://gitverse.ru/itphx/synth)
> (Extension API v1: жёсткое разделение Plugin ≠ Add-on ≠ Declarative).
> **Эталон-образец:** внешний сервис-демонстратор (add-on со своей доменной логикой).

Этот документ — часть **общего шаблона add-on'а** и его **канонический источник**
по контракту интеграции: что именно должен делать внешний сервис, чтобы его можно
было подключать к Synth предсказуемо и безопасно. Справочник конфигурации —
[configuration.md](./configuration.md), деплой — [deployment.md](./deployment.md).

---

## 1. Что такое add-on (и чем он НЕ является)

**Add-on** — это **внешний сервис-надстройка**: отдельный процесс/контейнер со
**своим** репозиторием, релизным циклом, образами и деплоем. Он общается с Synth
исключительно по **публичным контрактам**: API v2, MCP и внешние события
([AD-089](https://gitverse.ru/itphx/synth)).

Три класса расширений Synth разведены жёстко (AD-090) — их нельзя смешивать:

| Класс | Что запускается | Носитель | Доступ к internals |
|---|---|---|---|
| **Plugin** | код **в процессе core** | JS-бандл, `import()` через Extension API | да (под permission-слоем) |
| **Add-on** | **внешний сервис** в своём процессе | образ + `docker-compose`/Helm | **нет** |
| **Declarative** | ничего (данные) | файлы контента (скиллы, агенты, MCP-сервера, маршруты) | нет |

Что из этого следует для add-on'а:

- ✅ **основной безопасный путь расширения** — вынесенный сервис работает по уже
  отлаженным границам (API v2 / MCP / события) и не требует компромисса
  «сторонний код внутри ядра» (AD-090);
- ❌ add-on **не монтируется в процесс core** и **не является плагином** —
  термины не синонимы, «плагин-сервис» запрещён;
- ❌ add-on **не имеет хуков и точек расширения Extension API** (hooks,
  `ToolRegistry`, `ProviderFactory`, UI-слоты) — это доступно только плагинам;
- ❌ add-on **не получает прямого доступа к internals** ядра: ни к `FileStore`,
  ни к `GatewayProvider`, ни к сессиям в обход API;
- ⚠️ **LLM внутри сервиса не держим:** текст/решения генерирует агент Synth, а
  add-on делает детерминированную работу (реестр, хранение, рендер, публикация,
  транспорт). Нужен LLM — вызывайте его **через Synth**, а не поднимайте свой.

Add-on разрешён в **любом режиме** (standalone, hybrid, managed) и общается с
Synth по тем же адресам, что и любой внешний клиент.

---

## 2. Точки интеграции

| Канал | Транспорт | Что даёт | Ключевые точки | Аутентификация |
|---|---|---|---|---|
| **API v2** | HTTP (Hono), базовый путь `/api/v2` | Чтение/запись сессий, проектов, сообщений; приём событий | `GET /health`; `GET /sessions`, `GET/POST /sessions`; `POST /sessions/:id/messages`; `POST /events`; `GET/POST/DELETE /events/bindings` | `Authorization: Bearer <ключ>` (роли `ADMIN`/`USER`/`LEAD`/`AUDITOR`); health — без auth |
| **MCP** | stdio (для локального движка) или Streamable HTTP | Отдать агенту свои инструменты | Тулы MCP; имена неймспейсятся `{server}_{tool}` | По правилам MCP-сервера (токен в заголовке/аргументах) |
| **Внешние события (ingest)** | HTTP `POST /api/v2/events` | Приносить события в Synth (сообщения мессенджера, вебхуки) | Тело: `source`, `type`, `payload`, `identity`, `dedupKey` | `requireAuth` **или** API-ключ привязки `Authorization: Bearer synth_evt_…` |
| **Привязки событий** | HTTP `/api/v2/events/bindings*` | Связать источник с сессией/проектом, выпустить ключи | `GET/POST/DELETE /events/bindings`; `POST /bindings/:id/keys`; `PATCH .../keys/:keyId`; `POST .../keys/:keyId/revoke` | `requireAuth` (чтение), `ADMIN`/`LEAD` (мутации) |
| **Чтение событий (push)** | SSE `GET /api/v2/events`; WS `/ws/events` | Получать поток событий Synth в реальном времени | — | Требуют аутентификации (Bearer/сессия) |

Пояснения:

- **База API v2.** Все маршруты, кроме `GET /health`, требуют аутентификации;
  без ключа — `401`. Базовый URL в dev — `http://localhost:5000/api/v2`.
  Подробности — документация API v2 в репозитории Synth (AD-017).
- **MCP.** Add-on может отдать агенту инструменты **двумя** способами: локальный
  **stdio**-сервер (движок сам спавнит процесс — `node dist/index.js --mcp`)
  либо **Streamable HTTP**-эндпоинт (пример — `node dist/index.js --http`;
  MCP отдаётся на том же HTTP-сервере, путь `/mcp`). Synth регистрирует
  MCP-серверы в реестре (AD-071) и неймспейсит инструменты как
  `{serverName}_{toolName}` — поэтому тул `example_ping` сервера
  `synth-addon-example` виден агенту как `synth-addon-example_example_ping`.
  Для внешнего аддона адрес/порт/путь MCP объявляются в `provides.mcp` (§4.1) и
  регистрируются авто-установкой (см. [deployment.md](./deployment.md)). Аддон,
  обслуживающий несколько сред, добавляет в путь тенант (`/mcp/{tenant}`).
- **Внешние события (AD-089).** Каждый вызов `POST /api/v2/events` несёт как
  минимум поля:
  - `source` — идентификатор источника (например, `telegram`);
  - `type` — тип события (например, `message`, `callback_query`);
  - `payload` — произвольное тело;
  - `identity` — сведения о пользователе источника (маппинг в профиль/RBAC);
  - `dedupKey` — ключ дедупликации (повторный вызов с тем же `dedupKey`
    отбрасывается — **add-on обязан присылать стабильный `dedupKey`**).

  Аутентификация приёма: либо обычный пользовательский ключ (`requireAuth`), либо
  **API-ключ привязки** (`Authorization: Bearer synth_evt_…`) — тогда `source`/чат
  берутся из привязки, а пользовательские креды не нужны. Использование ключа
  пишется в журнал Router (`GET /api/v2/events/journal`). При
  `events.enabled: false` приём отвечает `503`. Per-key лимит (`KeyRateLimiter`)
  даёт `429 RATE_LIMITED`.
- **Привязки и ключи.** `EventBinding` связывает источник с целевой сессией;
  ключ привязки выпускается через `POST /events/bindings/:id/keys` (секрет
  `synth_evt_<base64url>` отдаётся **один раз**, at-rest хранится только
  sha256-хеш). Обновление/отзыв — `PATCH .../keys/:keyId` и
  `POST .../keys/:keyId/revoke`.
- **Чтение событий.** SSE `GET /api/v2/events` и WS `/ws/events` требуют
  аутентификации; используйте их, если add-on'у нужно **реагировать** на события
  Synth, а не только приносить свои.

> **Чего у add-on'а нет.** Хуки жизненного цикла (`pre_tool_use`, `session_start`,
> …), `ToolRegistry`, `ProviderFactory`, UI-слоты и вообще любой доступ к процессу
> ядра — это Extension API **плагинов** (AD-090). Add-on живёт вне процесса и
> пользуется только перечисленными выше публичными контрактами.

---

## 3. Обязательные требования к add-on'у

Сервис считается корректным add-on'ом, если выполняет всё перечисленное.

1. **`GET /health` без аутентификации.** Возвращает `200` и JSON вида
   `{ "status": "ok", "version": "…" }`. Используется деплоем (liveness/readiness),
   Helm-пробами и внешним мониторингом. Остальные маршруты могут требовать
   Bearer-токен.
2. **Конфигурация через env (приоритет CLI-флаг > env > файл секретов >
   дефолт).** Плюс правило: **пустая/whitespace-only строка = отсутствие
   значения**. Это критично для движка, где подстановка `{env:VAR}` при незаданной
   переменной даёт пустую строку, а не `undefined`. Реализация — единый хелпер
   `envOr` (`apps/example/src/config.ts`). Полный справочник —
   [configuration.md](./configuration.md).
3. **Секреты — вне git и не в логах.** Токены/ключи/пароли не хранятся в
   репозитории; в K8s — Secret (`existingSecret`, пример — `examples/secret.yaml`),
   локально — env или каталог секрет-файлов вне git. В образ и в логи секреты не
   попадают: вывод в лог — только факт «секрет задан/не задан».
4. **Идемпотентность и дедупликация входов.** Повторная доставка одного и того
   же события не должна порождать дубликатов: add-on сам дедуплицирует входные
   события (по стабильному `dedupKey`/`update_id`/id сообщения) **до** отправки в
   Synth, а в `POST /api/v2/events` передаёт стабильный `dedupKey`.
5. **Dry-run без секретов.** Без токенов внешней системы сервис не падает, а
   работает в режиме dry-run (методы не делают сетевых вызовов, возвращают
   предсказуемый результат).
6. **Структурированные логи.** Логи — с префиксом сервиса (`[addon] …`),
   сообщения на русском; в логи не попадают секреты и полные тела приватных
   сообщений. Ошибки HTTP — единый формат `{ error: { code, message } }`.
7. **Явный круг обязанностей.** Каждый сервис отвечает за свой узкий домен;
   **LLM внутрь сервиса не тянем** — генерацию/понимание делает движок Synth.
8. **Хранение — по модели Synth.** Если сервису нужно состояние — JSON через
   FileStore (атомарная запись `*.tmp.<uuid>` → `rename()`, AD-005), а не
   разрозненные самодельные форматы.
9. **Egress через прокси (при необходимости, AD-088).** Исходящие запросы к
   внешнему миру — через единый egress-слой/прокси, если он задан
   (`createProxyAgent` в `packages/example-lib/src/egress.ts`).

---

## 4. Совместимость и версионирование

Совместимость с Synth описывается манифестом **`synth.pack`** в корне репозитория:

```json
{
  "name": "@itphx/synth-addon-example",
  "version": "0.0.0",
  "kind": "addon",
  "host": "^0.9.0",
  "contracts": { "apiV2": "^2", "events": "^1", "mcp": "^1" },
  "description": "Пример внешнего сервиса-надстройки Synth",
  "provides": {
    "mcp": {
      "name": "synth-addon-example",
      "transport": "http",
      "port": 7100,
      "path": "/mcp",
      "description": "Пример MCP-сервера шаблона add-on'а (тул example_ping)"
    },
    "skills": [{ "name": "example", "path": "skills/example" }]
  }
}
```

| Поле | Смысл |
|---|---|
| `name` | Полное имя пакета/сервиса (совпадает с `package.json` приложения) |
| `version` | Версия add-on'а (semver) |
| `kind` | Всегда `addon` (жёсткая терминология AD-090) |
| `host` | Диапазон **совместимых версий Synth** (semver-range по версии ядра) |
| `contracts` | Диапазоны версий используемых контрактов: `apiV2`, `events`, `mcp` |
| `description` | Краткое описание |
| `provides` | **Необязательно.** Что аддон ставит в Synth: MCP-сервер и/или скиллы (см. §4.1) |

Правила:

- **Semver.** Ломающие изменения публичного контракта add-on'а (маршруты, формат
  событий, имена MCP-тулов) — это major; обратно совместимые добавления — minor.
- **`host` и `contracts`** проверяются при установке/подключении: если версия
  Synth или контракта вне диапазона — add-on считается несовместимым.
- **Окно deprecation.** Устаревший контракт объявляется заранее и поддерживается
  как минимум один минорный релиз ядра, по аналогии с политикой AD-086.
- Реестр/каталог add-on'ов и trust/install-policy — по образцу AD-068
  (переиспользуется единая инфраструктура доверия).

### 4.1 `provides` — что аддон ставит в Synth

`provides` описывает **декларативные ресурсы** аддона, которые устанавливаются в
инстанс Synth при деплое (авто-установка Helm-чарта, `autoInstall.enabled=true`;
см. [deployment.md](./deployment.md) «Авто-установка ресурсов»). Оба поля
необязательны и независимы:

```json
"provides": {
  "mcp": { "name": "<registry-name>", "transport": "http", "port": 7101, "path": "/mcp/{tenant}", "description": "…" },
  "skills": [{ "name": "<skill-name>", "path": "skills/<skill-name>" }]
}
```

| Поле | Смысл |
|---|---|
| `provides.mcp.name` | Имя MCP-сервера в реестре Synth (AD-071); тулы видны агенту как `{name}_{tool}` |
| `provides.mcp.transport` | `http` (Streamable HTTP) или `sse`; `stdio` для внешнего аддона не используется |
| `provides.mcp.port` | Порт MCP-сервера (совпадает с `service.mcpPort`/`service.port` чарта) |
| `provides.mcp.path` | Путь MCP; `{tenant}` подставляется значением `autoInstall.tenant` |
| `provides.mcp.description` | Человекочитаемое описание сервера (попадает в блок `mcp.servers` промпта) |
| `provides.skills[].name` | Имя скилла (AD-046): строчные латинские буквы/цифры, разделитель — дефис |
| `provides.skills[].path` | Каталог скилла с `SKILL.md` (относительно корня репозитория) |

### 4.2 Три вида аддонов

`provides` и `service.enabled` в чарте задают три валидных конфигурации:

| Вид | `provides` | `service.enabled` | Что разворачивается |
|---|---|---|---|
| **Сервис + MCP + скиллы** | `mcp` + `skills` | `true` | Deployment + Service (+ MCP-порт) + hook-Job установки |
| **Только MCP / только скиллы** | только `mcp` или только `skills` | `false` | только hook-Job установки (сервис не нужен) |
| **Ничего декларативного** | отсутствует | `false` | ничего (чарт-заготовка/только образ) |

Аддон **без сервиса** — полноценная конфигурация: ресурсы ставит hook-Job, а
Deployment/Service/PVC/Ingress не рендерятся. Если у аддона нет и образа, файлы
скиллов передаются через ConfigMap (`autoInstall.skillsFromConfigMap`), а
инсталлятор — через ConfigMap (`autoInstall.scriptConfigMap`); подробности —
[deployment.md](./deployment.md).


---

## 5. Структура репозитория

Шаблон — pnpm-воркспейс из **двух пакетов** с явным примером обеих ролей:
**сервис** (`apps/*` — запускается) и **библиотека** (`packages/*` — импортируется
сервисом).

```text
synth-addon-template/
├── synth.pack                  # манифест add-on'а (kind/host/contracts/provides)
├── package.json                # private, type:module, pnpm-скрипты
├── pnpm-workspace.yaml         # apps/*, packages/*
├── tsconfig.base.json          # общий strict-TS конфиг
├── tsconfig.json               # project-references на пакеты
├── apps/
│   └── example/                # СЕРВИС (роль «app»): запускается, имеет bin
│       └── src/
│           ├── index.ts        # bin: HTTP (Hono) + --mcp (stdio) / --http (MCP HTTP) + --help
│           ├── config.ts       # envOr: CLI > env > секрет-файл > дефолт
│           ├── server.ts       # GET /health + примеры роутов (echo/fetch), auth, монтаж /mcp
│           ├── mcp.ts          # MCP: stdio (тул example_ping) и Streamable HTTP
│           └── file-store.ts   # JSON FileStore (tmp → rename, AD-005)
├── packages/
│   └── example-lib/            # БИБЛИОТЕКА (роль «lib»): не запускается
│       └── src/
│           ├── index.ts        # публичный API пакета
│           └── egress.ts       # createProxyAgent/requestJson (socks/http, AD-088)
├── skills/example/SKILL.md     # скилл формата AD-046
├── scripts/
│   └── install-into-synth.mjs  # референсный инсталлятор ресурсов (provides) в Synth
├── examples/
│   ├── secret.yaml             # пример Secret сервиса (обычный манифест, не Helm)
│   └── installer-secret.yaml   # пример Secret с installer-ключом (autoInstall)
├── docker/Dockerfile           # multi-stage образ сервиса (node:22-alpine)
├── docker-compose.yml          # локальный запуск сервиса + volume для data
├── charts/synth-addon/         # Helm-чарт (k8s + autoInstall hook-Job + NOTES.txt)
│   └── templates/install-job.yaml          # hook-Job авто-установки
│   └── templates/install-skills-configmap.yaml  # скиллы без образа
├── docs/contract.md            # этот документ (канонический источник)
├── docs/configuration.md       # конфигурация и секреты
├── docs/deployment.md          # docker/compose/K8s/Helm/авто-установка
├── README.md
└── AGENTS.md
```

Роли каталогов:

| Каталог | Назначение |
|---|---|
| `apps/*` | Запускаемые сервисы (HTTP/MCP). Каждый сервис — отдельный пакет с `bin` |
| `packages/*` | Переиспользуемые библиотеки между сервисами (клиенты, домен, утилиты). Не запускаются, импортируются через `workspace:*` |
| `skills/*` | Скиллы формата AD-046 (`SKILL.md` + supporting-файлы) — контент для агента |
| `scripts/*` | Инсталлятор ресурсов (`provides`) в инстанс Synth — референсная реализация |
| `examples/` | Примеры манифестов (Secret и т. п.) — вне Helm-шаблонов |
| `docker/` | Dockerfile(ы) сервисов |
| `charts/` | Helm-чарт(ы) сервисов (+ hook-Job авто-установки) |
| `docs/` | Контракт, конфигурация, деплой |

Слои зависимостей: `packages/*` **не импортируют** из `apps/*`; приложения
импортируют пакеты, но не наоборот. Между пакетами — workspace-зависимости
(`"@itphx/synth-addon-example-lib": "workspace:*"`).

---

## 6. Чек-лист готовности add-on'а

Перед выпуском add-on'а проверьте:

- [ ] **Health.** `GET /health` отвечает `200` без auth, JSON `{status, version}`.
- [ ] **Конфиг.** Приоритет CLI > env > секрет-файл > дефолт; пустая строка = нет
      значения (`envOr`); все секреты читаются из env/файла, не хардкодятся.
- [ ] **Секреты.** Секретов нет в коде, образе и логах; в Helm —
      `existingSecret`/Secret, не значения в `values.yaml`.
- [ ] **Идемпотентность.** Входные события дедуплицируются; в
      `POST /api/v2/events` передаётся стабильный `dedupKey`.
- [ ] **Dry-run.** Без токенов внешней системы сервис стартует и работает в
      dry-run, не делая сетевых вызовов.
- [ ] **Логи.** Префикс сервиса, русские сообщения, единый формат ошибок
      `{error:{code,message}}`, без секретов.
- [ ] **Docker.** `docker/Dockerfile` собирается (multi-stage); образ запускает
      сервис и слушает ожидаемый порт.
- [ ] **Compose/Helm.** `docker-compose.yml`, `charts/synth-addon`
      (`helm lint` + `helm template` зелёные).
- [ ] **`provides`.** Ресурсы аддона описаны в `synth.pack` (`provides.mcp` /
      `provides.skills`) или явно отсутствуют; имена совпадают с реальными
      (имя MCP-сервера в реестре, имена скиллов), `path` MCP совпадает с
      маршрутом сервиса.
- [ ] **Авто-установка.** `helm template` для своего вида аддона (сервис+MCP+
      скиллы / без сервиса / только скиллы) рендерится без ошибок; hook-Job
      идемпотентен (повторный запуск не плодит дубликаты, инсталлятор
      проверен с `--dry-run`); installer-ключ лежит в Secret, не в values.
- [ ] **README/AGENTS.** Описаны назначение, команды, конфиг и границы.
- [ ] **Совместимость.** Заполнены `synth.pack` (`host`, `contracts`, semver);
      диапазоны соответствуют реально используемым контрактам.
- [ ] **Сборка/тесты.** `pnpm build && pnpm typecheck && pnpm lint && pnpm test`
      зелёные; есть тесты на health, конфиг, хранилище и egress-слой.
