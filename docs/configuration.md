# Конфигурация и секреты

Единый справочник конфигурации шаблона add-on'а. Реализация — в
`apps/example/src/config.ts` (хелпер `envOr`).

## Приоритет значений

```text
CLI-флаг  >  env  >  файл секретов  >  дефолт
```

Правило: **пустая/whitespace-only строка = отсутствие значения**. Это критично
для движка, где подстановка `{env:VAR}` при незаданной переменной даёт пустую
строку, а не `undefined`; хелпер `envOr` возвращает `fallback` (или `undefined`)
для пустых и пробельных значений.

## Переменные окружения и CLI-флаги

| Env | CLI-флаг | Дефолт | Назначение |
|---|---|---|---|
| `SYNTH_ADDON_DATA_DIR` | `--data-dir` | `<repo>/data` | Каталог JSON-хранилища |
| `SYNTH_ADDON_HOST` | `--host` | `127.0.0.1` | Адрес прослушивания HTTP |
| `SYNTH_ADDON_PORT` | `--port` | `7100` | Порт HTTP |
| `SYNTH_ADDON_TOKEN` | `--token` | — | Bearer-токен API (без него auth выключена) |
| `SYNTH_ADDON_PROXY_URL` | `--proxy` | — | Egress-прокси (иначе `ALL_PROXY`/`HTTPS_PROXY`/`HTTP_PROXY`) |
| `SYNTH_ADDON_SECRETS_DIR` | — | `<repo>/secrets` | Каталог секрет-файлов |

Особый флаг запуска: `--mcp` — запустить MCP-сервер по stdio вместо HTTP.
`--help`/`-h` — справка.

Цепочка egress-прокси: `SYNTH_ADDON_PROXY_URL` → `ALL_PROXY` → `HTTPS_PROXY` →
`HTTP_PROXY` → секрет-файл.

## Секреты

Секреты **не коммитить** и **не печатать в логах** (в лог — только факт
«задан/не задан»). Каталога `secrets/` в git шаблона нет: это лишь описание
механизма. Способы задания:

1. **CLI-флаг / env** — для локального запуска (`--token`, `SYNTH_ADDON_TOKEN`).
2. **Файлы секретов** — каталог `SYNTH_ADDON_SECRETS_DIR` (по умолчанию
   `<repo>/secrets`), права `600`, вне git. Имя файла = имя переменной в нижнем
   регистре:

   | Файл | Env-переменная | Назначение |
   |---|---|---|
   | `<secretsDir>/token` | `SYNTH_ADDON_TOKEN` | Bearer-токен API |
   | `<secretsDir>/proxy_url` | `SYNTH_ADDON_PROXY_URL` | Egress-прокси (socks/http) |

   Пустой или whitespace-only файл эквивалентен отсутствию значения.

3. **Kubernetes Secret** — имя указывается в `existingSecret` чарта, подключается
   как `envFrom`. Пример манифеста — [examples/secret.yaml](../examples/secret.yaml)
   (обычный Secret, НЕ Helm-шаблон). В проде используйте SealedSecret/внешний
   секрет-менеджер.

Пример локального наполнения каталога секретов (вне git):

```bash
mkdir -p secrets
printf '%s' 'dev-token'            > secrets/token
printf '%s' 'socks5://proxy:9050'  > secrets/proxy_url
chmod 600 secrets/*
```

## Локальное окружение docker compose

Скопируйте [.env.example](../.env.example) в `.env` (вне git) и заполните
`SYNTH_ADDON_TOKEN` / `SYNTH_ADDON_PROXY_URL`; пустая строка = значение не задано.
Подробности запуска — [deployment.md](./deployment.md).
