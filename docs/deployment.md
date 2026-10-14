# Деплой add-on'а

Три способа запуска шаблона. Конфигурация и секреты — [configuration.md](./configuration.md).

## Локально (node, из исходников)

```bash
pnpm install
pnpm build
node apps/example/dist/index.js --token dev-token   # HTTP :7100
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

Чарт `charts/synth-addon` содержит только k8s-манифесты и `NOTES.txt`; секретов
в `values.yaml` нет — только имя `existingSecret`. `imagePullSecrets` по умолчанию
пуст (публичный реестр); для приватного реестра укажите Secret
(`kubernetes.io/dockerconfigjson`).
