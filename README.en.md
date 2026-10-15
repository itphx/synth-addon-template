# synth-addon-template

> 🌐 **English** · [Russian](./README.md)
> This is the public GitHub mirror — development happens on [GitVerse](https://gitverse.ru/itphx/synth-addon-template); see [CONTRIBUTING.md](./CONTRIBUTING.md).

**Template of an external companion service (add-on)** for the Synth agent
platform: a skeleton repository, CI, image, `docker-compose`, a Helm chart with
**auto-install** of the add-on's resources, and an **integration contract**
— so that a new add-on comes up fast and uniformly.

## What an add-on is

**An add-on** is an **external service** with its own repository, images and
deployment, which talks to Synth only through public contracts: **API v2**,
**MCP** and **external events**.

It is **not a plugin**: an add-on is not mounted into the core process and gets
no extension points from the Extension API. The terminology is strict — Plugin ≠
Add-on ≠ Declarative; the main safe extension path is the add-on.

The full contract (integration points, mandatory requirements, compatibility,
readiness checklist) — **[docs/contract.md](./docs/en/contract.md)**. Rationale —
AD-086 (the "external companion services" class) and AD-090 (Plugin ≠ Add-on ≠
Declarative) in the Synth repository: <https://gitverse.ru/itphx/synth>.

## What an add-on can declare and install

An add-on describes its declarative resources in the **`synth.pack` → `provides`**
manifest (an MCP server and/or skills), and the Helm chart installs them into a Synth
instance with a hook Job (`autoInstall`) through the reference installer `scripts/install-into-synth.mjs`:

> **Single `synth.pack` manifest.** JSON in the repository root (no extension in the
> name) — shared by **all** extension classes and content packs; the class is set by
> the `kind` field (`plugin` | `gateway` | `addon` | `pack`). For content packs —
> `kind: "pack"` + `packType` (`skills` | `agents` | `mcp` | `themes` | `i18n` |
> `providers` | `prompts` | `automation` | `policies` | `memory` | `ui`).

```json
"provides": {
  "mcp": { "name": "synth-addon-example", "transport": "http", "port": 7100, "path": "/mcp", "description": "…" },
  "skills": [{ "name": "example", "path": "skills/example" }]
}
```

Both fields are optional, hence **three kinds of add-ons**:

| Kind | `provides` | Values |
|---|---|---|
| Service + MCP + skills | `mcp` + `skills` | default values + `autoInstall.enabled=true` |
| MCP only / skills only | one of the two | `service.enabled=false`, `autoInstall.enabled=true` |
| Nothing declarative | — | `service.enabled=false`, `autoInstall.enabled=false` |

An add-on **without a service** is a fully valid case: Deployment/Service/PVC/
Ingress are not rendered, and the Job installs the resources (when there is no
image, the skill files and the installer are taken from a ConfigMap). Installation is
idempotent (a repeated `helm upgrade` updates the config rather than duplicating
it). Details — [docs/contract.md](./docs/en/contract.md) §4.1–4.2 and [docs/deployment.md](./docs/en/deployment.md) "Auto-install of resources".

## Stack

TypeScript (strict, ESM, NodeNext), [pnpm workspaces](https://pnpm.io/workspaces),
[Hono](https://hono.dev/) (HTTP), [MCP SDK](https://github.com/modelcontextprotocol)
(tools for the agent: stdio and Streamable HTTP), [Zod](https://zod.dev/)
(validation), [Vitest](https://vitest.dev/) (tests), ESLint 9 + TypeScript-ESLint, Prettier.

- **Node.js** ≥ 22, **pnpm** ≥ 10.
- A workspace of **two packages** — an example of both roles:
  - `apps/example` — a **service**: it runs (HTTP + MCP stdio/HTTP) and has a `bin`;
  - `packages/example-lib` — a **library**: it does not run, it is imported by the
    service (`workspace:*`) — the shared egress layer (proxy, AD-088).
- Storage — JSON through `FileStore` (atomic write `*.tmp.<uuid>` → `rename()`).
- Config — priority **CLI flag > env > secrets file > default**; an empty string
  = no value (`envOr`).
- Resource installer — `.mjs` **with no external dependencies** (`node:*` + global
  `fetch`), with `--dry-run` and an idempotent upsert.

## How to bring up a new add-on from the template

1. **Copy** the template directory into a new repository:

   ```bash
   cp -r addons/synth-addon-template addons/synth-<your-addon>
   cd addons/synth-<your-addon>
   rm -rf .git && git init
   ```

2. **Rename** the example for your service:
   - `apps/example` → `apps/<your-service>`, `package.json` → `@itphx/synth-addon-<your>`;
   - `packages/example-lib` → `packages/<your-library>`, `package.json` →
     `@itphx/synth-addon-<your>-lib`; update the `workspace:*` import in the service;
   - `synth.pack` → your own `name`, `host`, `contracts`, `description`,
     **`provides`** (MCP/skills; no resources — remove the field);
   - the `SYNTH_ADDON_*` env prefix → your own (for example, `SYNTH_TG_*`);
   - the Helm chart `charts/synth-addon` → `charts/<your-chart>`, update `name` in
     `Chart.yaml` and `_helpers.tpl`.
3. **Implement** the domain: HTTP routes (`apps/*/src/server.ts`), MCP tools
   (`apps/*/src/mcp.ts` — stdio `--mcp` and/or HTTP `--http` on the path from
   `provides.mcp.path`), shared logic — in `packages/*`; if needed — the API v2
   client and sending external events (`POST /api/v2/events`).
4. **Verify** against the checklist in [docs/contract.md](./docs/en/contract.md) §6 and
   render the chart for your kind of add-on (`helm template`, see README
   §"Deployment and auto-install"); locally check the installer with `--dry-run`.
5. **Deploy**: `docker/Dockerfile` → image, Helm chart → cluster (with
   `autoInstall` if needed), or `docker-compose.yml` locally
   (see [docs/deployment.md](./docs/en/deployment.md)).

## Structure

```text
synth-addon-template/
├── synth.pack                  # add-on manifest (kind/host/contracts + provides)
├── apps/example/               # SERVICE (the "app" role): HTTP + MCP (stdio/HTTP), bin
├── packages/example-lib/       # LIBRARY (the "lib" role): shared egress layer
├── skills/example/SKILL.md     # example of an AD-046 skill
├── scripts/install-into-synth.mjs  # resource (provides) installer into Synth
├── examples/                   # example Secrets (service, installer key)
├── docker/Dockerfile           # multi-stage image (synth.pack/skills/scripts inside)
├── docker-compose.yml          # local run + volume for data
├── charts/synth-addon/         # Helm chart: service + autoInstall hook Job
├── docs/contract.md            # add-on contract (canonical source)
├── docs/configuration.md       # configuration and secrets
├── docs/deployment.md          # docker/compose/K8s/Helm/auto-install
├── README.md
└── AGENTS.md
```

## Commands

From the repository root:

```bash
pnpm install
pnpm build        # build all packages (tsc, by dependency graph)
pnpm typecheck    # type checking
pnpm lint         # ESLint
pnpm test         # Vitest
pnpm clean        # clean dist/
```

Running the example (after `pnpm build`):

```bash
# HTTP API (:7100), optionally with a Bearer token and an egress proxy
node apps/example/dist/index.js --token dev-token --proxy socks5://proxy:9050

# HTTP API + MCP over Streamable HTTP at /mcp (matches provides.mcp.path)
node apps/example/dist/index.js --http --port 7100

# MCP server over stdio (for the engine)
node apps/example/dist/index.js --mcp

# Flag reference
node apps/example/dist/index.js --help
```

Example requests:

```bash
curl -s http://127.0.0.1:7100/health
curl -s -H 'Authorization: Bearer dev-token' http://127.0.0.1:7100/api/example/ping
curl -s -X POST -H 'Authorization: Bearer dev-token' -H 'content-type: application/json' \
  -d '{"message":"hello"}' http://127.0.0.1:7100/api/example/echo
```

## Configuration and secrets

Priority: **CLI flag > env > secrets file > default**; an empty string = no
value. The full reference (env/CLI, secrets files, Kubernetes Secret, the
auto-install installer key) — [docs/configuration.md](./docs/en/configuration.md).
An example environment for compose — [.env.example](./.env.example).

## Deployment and auto-install

Locally — `docker compose up --build`; Kubernetes — the Helm chart `charts/synth-addon`
(secrets — through `existingSecret`, the installer key — through
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

The hook Job will install the MCP server and skills from `provides` (idempotently).
Details, how to verify the result, and the "add-on without a service/image" case —
[docs/deployment.md](./docs/en/deployment.md).

## License

MIT — see [LICENSE](./LICENSE).
