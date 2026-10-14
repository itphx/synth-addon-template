# Деплой add-on'а

Четыре способа запуска шаблона. Конфигурация и секреты — [configuration.md](./configuration.md),
ресурсы аддона (`provides`) — [contract.md](./contract.md) §4.

## Локально (node, из исходников)

```bash
pnpm install
pnpm build
node apps/example/dist/index.js --token dev-token   # HTTP :7100
node apps/example/dist/index.js --http              # HTTP :7100 + MCP по Streamable HTTP на /mcp
node apps/example/dist/index.js --mcp               # MCP по stdio
node apps/example/dist/index.js --help              # флаги
```

## Docker Compose

```bash
cp .env.example .env        # заполнить значения (вне git)
docker compose up --build
curl -s http://127.0.0.1:7100/health
```

Сервис собирается по `docker/Dockerfile` (multi-stage: workspace-сборка →
тонкий runtime). JSON-хранилище вынесено в именованный volume `addon-data`.
Образ содержит `synth.pack`, `skills/` и `scripts/install-into-synth.mjs` — это
то, что нужно hook-Job'у авто-установки (см. ниже).

## Kubernetes / Helm

```bash
# Собрать и запушить образ в свой реестр, указать его в values.yaml
# (image.repository — по умолчанию плейсхолдер registry.example.com/…).

# Секреты — обычный Secret (пример манифеста), имя — в existingSecret.
kubectl -n synth apply -f examples/secret.yaml

helm install synth-addon charts/synth-addon \
  --set existingSecret=synth-addon-secrets \
  --set image.repository=registry.example.com/your-addon

# Локальная проверка чарта
helm lint charts/synth-addon
helm template synth-addon charts/synth-addon
```

Чарт `charts/synth-addon` содержит k8s-манифесты, hook-Job авто-установки и
`NOTES.txt`; секретов в `values.yaml` нет — только имена `existingSecret` /
`autoInstall.installerSecretName`. `imagePullSecrets` по умолчанию пуст
(публичный реестр); для приватного реестра укажите Secret
(`kubernetes.io/dockerconfigjson`).

### Виды аддонов

| Вид | `provides` | Values | Что разворачивается |
|---|---|---|---|
| Сервис + MCP + скиллы | `mcp` + `skills` | дефолт + `autoInstall.enabled=true` | Deployment + Service (+ порт MCP) + hook-Job |
| Только MCP / только скиллы | одно из двух | `service.enabled=false`, `autoInstall.enabled=true`, `autoInstall.mcp`/`autoInstall.skills` | только hook-Job (+ ConfigMap скиллов при отсутствии образа) |
| Ничего декларативного | — | `service.enabled=false`, `autoInstall.enabled=false` | ничего |

`service.enabled=false` — валидная конфигурация: Deployment, Service, PVC и
Ingress не рендерятся (аддон-надстройка без long-running сервиса).

Примеры проверки рендера:

```bash
# 1) сервис + авто-установка
helm template a charts/synth-addon \
  --set autoInstall.enabled=true \
  --set autoInstall.url=http://synth-backend.synth.svc.cluster.local:5000/api/v2 \
  --set autoInstall.installerSecretName=synth-addon-installer

# 2) без сервиса (только MCP/скиллы) — Deployment'а быть не должно
helm template a charts/synth-addon --set service.enabled=false --set autoInstall.enabled=true \
  --set autoInstall.url=http://synth-backend.synth.svc.cluster.local:5000/api/v2 \
  --set autoInstall.installerSecretName=synth-addon-installer \
  | grep -E '^kind:'          # ожидаем только ConfigMap/Job

# 3) ничего
helm template a charts/synth-addon --set service.enabled=false   # пусто
```

## Авто-установка ресурсов (MCP/скиллы)

Чарт умеет **сам установить** ресурсы аддона в инстанс Synth: hook-Job
(`templates/install-job.yaml`, hooks `post-install,post-upgrade`,
`hook-delete-policy: before-hook-creation,hook-succeeded`) запускает
`scripts/install-into-synth.mjs`, который читает `provides` из `synth.pack` и
идемпотентно приводит инстанс к этому состоянию:

- **MCP** — `POST /api/v2/mcp/registry`; если сервер уже есть (`409`) —
  `PUT /api/v2/mcp/servers/:name` (обновление конфига);
- **скиллы** — `POST /api/v2/skills`; если скилл уже есть (`409`) —
  `PATCH /api/v2/skills/:name` + `PUT /api/v2/skills/:name/files/*`.

Также поддерживается режим **standalone** (`--config` + `--data-dir`): merge
`mcp.servers` в `config.yaml` (атомарная запись) и копирование дерева скилла в
`{data-dir}/skills/<name>/`. Установка идемпотентна, есть `--dry-run`.

### Values

```yaml
service:
  enabled: true            # false — аддон без сервиса (Deployment/Service/PVC/Ingress не рендерятся)
  mcpPort: 0               # порт MCP, если отличается от service.port (0 — не публикуем)

autoInstall:
  enabled: true
  url: "http://synth-backend.synth.svc.cluster.local:5000/api/v2"
  tenant: ""               # подстановка {tenant} в provides.mcp.path
  installerSecretName: "synth-addon-installer"
  installerSecretKey: "token"
  mcp: true                # ставить MCP-сервер из provides.mcp
  skills: true             # ставить скиллы из provides.skills
  image: ""                # пусто — образ чарта (image.repository:image.tag)
  backoffLimit: 3
  # — служебное —
  scriptPath: "scripts/install-into-synth.mjs"   # путь к инсталлятору в образе
  scriptConfigMap: ""                            # аддон без образа: ConfigMap с install-into-synth.mjs
  mcpUrl: ""                                     # явный URL MCP (иначе собирается из provides.mcp)
  skillsFromConfigMap:                           # аддон без образа: файлы скиллов в values
    enabled: false
    files: {}                                    # "example/SKILL.md": | …
```

### Installer-ключ (Secret)

Ключ **не хранится в values** — только имя Secret и ключа в нём. Hook-Job
подставляет его через `secretKeyRef` в env `SYNTH_INSTALL_TOKEN`.

```bash
kubectl -n synth create secret generic synth-addon-installer \
  --from-literal=token='synth_svc_…'
# или SealedSecret/внешний секрет-менеджер — пример: examples/installer-secret.yaml
```

Что за ключ: scoped-ключ инстанса (AD-052) для машинной установки ресурсов.
Целевой скоуп — `addons:install`; в текущем каталоге `SERVICE_SCOPES` API v2 его
ещё нет, и MCP-реестр/скиллы в managed гейтятся ролью `ADMIN`
(`POST /mcp/registry` пользовательскими HTTP-ключами допускается, но
`PUT /mcp/servers/:name` и скиллы — ADMIN). Поэтому выдайте installer-ключу
роль `ADMIN` (или используйте `SYNTH_API_KEY`-ключ инстанса), а когда скоуп
`addons:install` появится — сузьте права до него.

### Скиллы и инсталлятор для аддонов без образа

Если у аддона нет образа (`service.enabled=false` и нет сборки), hook-Job'у
нечего запускать. Минимальный путь:

1. **Скиллы** — из values: `autoInstall.skillsFromConfigMap.enabled=true` и
   `files` (дерево «путь → содержимое»). Чарт рендерит ConfigMap
   (`<release>-skills`), ключи — с заменой `/` → `__`, а монтирование
   восстанавливает дерево (`items[].path`); инсталлятор читает его как
   `--skills-dir /etc/synth-addon/skills`.
2. **Инсталлятор** — из ConfigMap: `autoInstall.scriptConfigMap=<имя>`, где ключ
   `install-into-synth.mjs`:

   ```bash
   kubectl -n synth create configmap synth-addon-installer-script \
     --from-file=install-into-synth.mjs=scripts/install-into-synth.mjs
   ```
3. **Образ Job'а** — с node (например, `autoInstall.image=node:22-alpine`).

Если образ есть — файлы скиллов и инсталлятор берутся из него
(`scripts/`, `synth.pack`, `skills/` копируются в образ по `docker/Dockerfile`),
и обе опции выше не нужны.

### Проверка результата

```bash
kubectl -n synth get job synth-addon-install
kubectl -n synth logs job/synth-addon-install      # [install] … (токен не печатается)

# в инстансе Synth (ключом с правами чтения):
curl -s -H "Authorization: Bearer <ключ>" \
  http://synth-backend.synth.svc.cluster.local:5000/api/v2/mcp/registry
curl -s -H "Authorization: Bearer <ключ>" \
  http://synth-backend.synth.svc.cluster.local:5000/api/v2/skills
```

Локальная проверка инсталлятора без кластера:

```bash
# план (ничего не меняет)
node scripts/install-into-synth.mjs --config ~/.config/synth/config.yaml \
  --data-dir ~/.local/share/synth/data --service-host 127.0.0.1 --dry-run

# конфиг standalone (merge mcp.servers) + скиллы в {data-dir}/skills
node scripts/install-into-synth.mjs --config ./config.yaml --data-dir ./data \
  --service-host 127.0.0.1
```

`helm uninstall` удаляет hook-Job по `hook-delete-policy`; уже установленные в
Synth ресурсы (записи MCP-реестра, скиллы) остаются — убирайте их осознанно
(удалением записи/скилла в инстансе), это данные инстанса, а не релиза.
