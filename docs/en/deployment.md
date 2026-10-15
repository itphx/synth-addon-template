# Add-on deployment

> 🌐 **English** · [Russian](../deployment.md)

Four ways to run the template. Configuration and secrets — [configuration.md](./configuration.md),
the add-on resources (`provides`) — [contract.md](./contract.md) §4.

## Locally (node, from source)

```bash
pnpm install
pnpm build
node apps/example/dist/index.js --token dev-token   # HTTP :7100
node apps/example/dist/index.js --http              # HTTP :7100 + MCP over Streamable HTTP at /mcp
node apps/example/dist/index.js --mcp               # MCP over stdio
node apps/example/dist/index.js --help              # flags
```

## Docker Compose

```bash
cp .env.example .env        # fill in the values (outside git)
docker compose up --build
curl -s http://127.0.0.1:7100/health
```

The service is built from `docker/Dockerfile` (multi-stage: workspace build →
thin runtime). The JSON storage is moved to the named volume `addon-data`.
The image contains `synth.pack`, `skills/` and `scripts/install-into-synth.mjs` — this
is what the auto-install hook Job needs (see below).

## Kubernetes / Helm

```bash
# Build and push the image to your registry, set it in values.yaml
# (image.repository — the placeholder registry.example.com/… by default).

# Secrets — a plain Secret (an example manifest), the name — in existingSecret.
kubectl -n synth apply -f examples/secret.yaml

helm install synth-addon charts/synth-addon \
  --set existingSecret=synth-addon-secrets \
  --set image.repository=registry.example.com/your-addon

# Local chart check
helm lint charts/synth-addon
helm template synth-addon charts/synth-addon
```

The chart `charts/synth-addon` contains k8s manifests, the auto-install hook Job and
`NOTES.txt`; there are no secrets in `values.yaml` — only the names `existingSecret` /
`autoInstall.installerSecretName`. `imagePullSecrets` is empty by default
(a public registry); for a private registry, specify a Secret
(`kubernetes.io/dockerconfigjson`).

### Kinds of add-ons

| Kind | `provides` | Values | What is deployed |
|---|---|---|---|
| Service + MCP + skills | `mcp` + `skills` | default + `autoInstall.enabled=true` | Deployment + Service (+ MCP port) + hook Job |
| MCP only / skills only | one of the two | `service.enabled=false`, `autoInstall.enabled=true`, `autoInstall.mcp`/`autoInstall.skills` | only the hook Job (+ a skills ConfigMap when there is no image) |
| Nothing declarative | — | `service.enabled=false`, `autoInstall.enabled=false` | nothing |

`service.enabled=false` is a valid configuration: Deployment, Service, PVC and
Ingress are not rendered (a companion add-on without a long-running service).

Render check examples:

```bash
# 1) service + auto-install
helm template a charts/synth-addon \
  --set autoInstall.enabled=true \
  --set autoInstall.url=http://synth-backend.synth.svc.cluster.local:5000/api/v2 \
  --set autoInstall.installerSecretName=synth-addon-installer

# 2) without a service (MCP/skills only) — there must be no Deployment
helm template a charts/synth-addon --set service.enabled=false --set autoInstall.enabled=true \
  --set autoInstall.url=http://synth-backend.synth.svc.cluster.local:5000/api/v2 \
  --set autoInstall.installerSecretName=synth-addon-installer \
  | grep -E '^kind:'          # expect only ConfigMap/Job

# 3) nothing
helm template a charts/synth-addon --set service.enabled=false   # empty
```

## Auto-install of resources (MCP/skills)

The chart can **install** the add-on resources into a Synth instance itself: the hook Job
(`templates/install-job.yaml`, hooks `post-install,post-upgrade`,
`hook-delete-policy: before-hook-creation,hook-succeeded`) runs
`scripts/install-into-synth.mjs`, which reads `provides` from `synth.pack` and
idempotently brings the instance to that state:

- **MCP** — `POST /api/v2/mcp/registry`; if the server already exists (`409`) —
  `PUT /api/v2/mcp/servers/:name` (config update);
- **skills** — `POST /api/v2/skills`; if the skill already exists (`409`) —
  `PATCH /api/v2/skills/:name` + `PUT /api/v2/skills/:name/files/*`.

**Standalone** mode is also supported (`--config` + `--data-dir`): merging
`mcp.servers` into `config.yaml` (atomic write) and copying the skill tree into
`{data-dir}/skills/<name>/`. Installation is idempotent, and there is a `--dry-run`.

### Values

```yaml
service:
  enabled: true            # false — an add-on without a service (Deployment/Service/PVC/Ingress are not rendered)
  mcpPort: 0               # the MCP port, if different from service.port (0 — do not publish)

autoInstall:
  enabled: true
  url: "http://synth-backend.synth.svc.cluster.local:5000/api/v2"
  tenant: ""               # substitution of {tenant} into provides.mcp.path
  installerSecretName: "synth-addon-installer"
  installerSecretKey: "token"
  mcp: true                # install the MCP server from provides.mcp
  skills: true             # install the skills from provides.skills
  image: ""                # empty — the chart image (image.repository:image.tag)
  backoffLimit: 3
  # — internal —
  scriptPath: "scripts/install-into-synth.mjs"   # path to the installer in the image
  scriptConfigMap: ""                            # add-on without an image: a ConfigMap with install-into-synth.mjs
  mcpUrl: ""                                     # an explicit MCP URL (otherwise assembled from provides.mcp)
  skillsFromConfigMap:                           # add-on without an image: skill files in values
    enabled: false
    files: {}                                    # "example/SKILL.md": | …
```

### Installer key (Secret)

The key is **not stored in values** — only the name of the Secret and of the key in it. The hook Job
substitutes it through `secretKeyRef` into the `SYNTH_INSTALL_TOKEN` env.

```bash
kubectl -n synth create secret generic synth-addon-installer \
  --from-literal=token='synth_svc_…'
# or a SealedSecret/an external secret manager — example: examples/installer-secret.yaml
```

What key this is: a scoped instance key (AD-052) for machine resource installation.
The target scope is `addons:install`; in the current API v2 `SERVICE_SCOPES` catalog it
does not exist yet, and the MCP registry/skills in managed are gated by the `ADMIN` role
(`POST /mcp/registry` with user HTTP keys is allowed, but
`PUT /mcp/servers/:name` and skills are ADMIN). Therefore, grant the installer key
the `ADMIN` role (or use the instance's `SYNTH_API_KEY` key), and once the
`addons:install` scope appears — narrow the permissions down to it.

### Skills and installer for add-ons without an image

If the add-on has no image (`service.enabled=false` and no build), the hook Job has
nothing to run. The minimal path:

1. **Skills** — from values: `autoInstall.skillsFromConfigMap.enabled=true` and
   `files` (a "path → content" tree). The chart renders a ConfigMap
   (`<release>-skills`), with keys replacing `/` → `__`, and the mount
   restores the tree (`items[].path`); the installer reads it as
   `--skills-dir /etc/synth-addon/skills`.
2. **Installer** — from a ConfigMap: `autoInstall.scriptConfigMap=<name>`, where the key
   is `install-into-synth.mjs`:

   ```bash
   kubectl -n synth create configmap synth-addon-installer-script \
     --from-file=install-into-synth.mjs=scripts/install-into-synth.mjs
   ```
3. **The Job image** — with node (for example, `autoInstall.image=node:22-alpine`).

If an image exists — the skill files and the installer are taken from it
(`scripts/`, `synth.pack`, `skills/` are copied into the image by `docker/Dockerfile`),
and neither of the two options above is needed.

### Verifying the result

```bash
kubectl -n synth get job synth-addon-install
kubectl -n synth logs job/synth-addon-install      # [install] … (the token is not printed)

# in the Synth instance (with a key that has read permissions):
curl -s -H "Authorization: Bearer <key>" \
  http://synth-backend.synth.svc.cluster.local:5000/api/v2/mcp/registry
curl -s -H "Authorization: Bearer <key>" \
  http://synth-backend.synth.svc.cluster.local:5000/api/v2/skills
```

Local installer check without a cluster:

```bash
# plan (changes nothing)
node scripts/install-into-synth.mjs --config ~/.config/synth/config.yaml \
  --data-dir ~/.local/share/synth/data --service-host 127.0.0.1 --dry-run

# standalone config (merge mcp.servers) + skills into {data-dir}/skills
node scripts/install-into-synth.mjs --config ./config.yaml --data-dir ./data \
  --service-host 127.0.0.1
```

`helm uninstall` removes the hook Job per the `hook-delete-policy`; the resources already installed in
Synth (MCP registry entries, skills) remain — remove them deliberately
(by deleting the entry/skill in the instance), as they are the instance's data, not the release's.
