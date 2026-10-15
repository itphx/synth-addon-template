# Как внести вклад в synth-addon-template

Спасибо за интерес к улучшению шаблона add-on'ов Synth! Этот репозиторий — скелет
**внешних сервисов-надстроек** агентной платформы [Synth](https://gitverse.ru/itphx/synth).

Английская (каноничная) версия документа: [CONTRIBUTING.md](./CONTRIBUTING.md).

## Модель разработки и pull request'ы

- **Основная разработка ведётся в GitVerse** —
  <https://gitverse.ru/itphx/synth-addon-template> (ветка `master`).
- **GitHub — публичное зеркало** — <https://github.com/itphx/synth-addon-template>.
  Issues и pull request'ы там приветствуются, но мейнтейнер их **не мержит** на
  GitHub: принятые изменения **переносятся cherry-pick'ом в GitVerse**. Держите
  ветку в актуальном состоянии относительно `master`, чтобы она применялась чисто.
- Один PR — одно логическое изменение. Опишите, что и почему сделано.

## Требования

- **Node.js ≥ 22** (см. `engines` в [`package.json`](./package.json)).
- **pnpm ≥ 10** (см. `engines`; репозиторий использует pnpm workspaces).
- Git.

## Начало работы

```bash
git clone https://gitverse.ru/itphx/synth-addon-template.git
cd synth-addon-template
pnpm install
```

## Проверки

Запускайте всё из корня репозитория перед открытием pull request'а. Имена команд
ниже — точные скрипты из [`package.json`](./package.json):

| Команда | Назначение |
|---|---|
| `pnpm build` | Сборка всех пакетов workspace (`pnpm --recursive run build`) |
| `pnpm typecheck` | Проверка типов во всех пакетах workspace |
| `pnpm lint` | ESLint во всех пакетах workspace |
| `pnpm test` | Vitest во всех пакетах workspace |
| `pnpm clean` | Очистка артефактов сборки |

Локальная проверка перед пушем:

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm test
```

## Именование веток

| Префикс | Для чего |
|---|---|
| `feat/*` | Новая функциональность |
| `fix/*` | Исправление багов |
| `docs/*` | Только документация |
| `chore/*` | Инструменты, CI, зависимости, рутина |

## Сообщения коммитов — Conventional Commits

Используйте [Conventional Commits](https://www.conventionalcommits.org/) с
**русским** описанием:

```text
<type>(<scope>): <краткое описание в повелительном наклонении>
```

Допустимые типы: `feat`, `fix`, `docs`, `refactor`, `test`, `ci`, `chore`.
`scope` — необязателен (например, `feat(example): …`).

Примеры:

```text
feat: добавлен тул example_ping для MCP-сервера
fix(config): корректная обработка пустого значения env
docs(contract): уточнён чек-лист готовности add-on'а
```

## Подпись коммита (DCO)

Каждый коммит должен быть подписан, подтверждая
[Developer Certificate of Origin](https://developercertificate.org/):

```bash
git commit -s -m "feat: ..."
```

Строка `Signed-off-by:` обязательна — pull request'ы без неё не принимаются.

## Манифест `synth.pack`

`synth.pack` (JSON в корне репозитория, без расширения в имени) — единый манифест
расширения: объявляет `kind`, `host`, `contracts` и `provides` (MCP-серверы и/или
скиллы).

- Если меняется **состав** add-on'а — добавлен/убран MCP-сервер или скилл,
  изменены `kind`/`host`/`contracts` — обновите `synth.pack` **и** его `version`.
- Держите манифест в соответствии с тем, что реально ставит Helm-чарт.

## Документация

- Документация для пользователей и интеграторов — в `docs/*.md`
  ([contract.md](./docs/contract.md), [configuration.md](./docs/configuration.md),
  [deployment.md](./docs/deployment.md)). Обновляйте нужную страницу при изменении
  поведения, конфигурации или деплоя.
- Держите [README.md](./README.md) в соответствии с кодом.
- Документация пишется на **русском** языке.

## Секреты

- **Никогда не коммитьте секреты.** `secrets/`, `.env` и `.env.*` — в `.gitignore`.
- Примеры манифестов в `examples/` должны содержать **только плейсхолдеры**
  (например, `REPLACE_ME`) — никаких реальных токенов, ключей и сертификатов.
- В проде используйте секрет-менеджер или `SealedSecret`, а не закоммиченные файлы.

## Контакты

- Email: **admin@itphx.ru**
- Telegram: <https://t.me/synth_dev_admin>

Внося вклад, вы соглашаетесь, что ваш вклад распространяется под
[лицензией MIT](./LICENSE).
