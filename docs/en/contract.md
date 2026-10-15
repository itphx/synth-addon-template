# Synth add-on contract

> 🌐 **English** · [Russian](../contract.md)

> **Audience:** authors of external companion services (add-ons) for Synth.
> **Rationale:** [AD-086](https://gitverse.ru/itphx/synth) (the extensibility umbrella,
> the "external companion services" class) and [AD-090](https://gitverse.ru/itphx/synth)
> (Extension API v1: the strict separation Plugin ≠ Add-on ≠ Declarative).
> **Reference sample:** an external demo service (an add-on with its own domain logic).

This document is part of the **common add-on template** and its **canonical source**
for the integration contract: what exactly an external service must do to be
connectable to Synth predictably and safely. The configuration reference —
[configuration.md](./configuration.md), deployment — [deployment.md](./deployment.md).

---

## 1. What an add-on is (and what it is NOT)

**An add-on** is an **external companion service**: a separate process/container with
**its own** repository, release cycle, images and deployment. It talks to Synth
exclusively through **public contracts**: API v2, MCP and external events
([AD-089](https://gitverse.ru/itphx/synth)).

The three Synth extension classes are strictly separated (AD-090) — they must not be mixed:

| Class | What runs | Vehicle | Access to internals |
|---|---|---|---|
| **Plugin** | code **in the core process** | a JS bundle, `import()` through the Extension API | yes (under the permission layer) |
| **Add-on** | an **external service** in its own process | image + `docker-compose`/Helm | **no** |
| **Declarative** | nothing (data) | content files (skills, agents, MCP servers, routes) | no |

What follows from this for an add-on:

- ✅ **the main safe extension path** — a standalone service runs over the already
  hardened boundaries (API v2 / MCP / events) and needs no "third-party code
  inside the core" compromise (AD-090);
- ❌ an add-on **is not mounted into the core process** and **is not a plugin** —
  the terms are not synonyms, a "plugin-service" is forbidden;
- ❌ an add-on **has no hooks or Extension API extension points** (hooks,
  `ToolRegistry`, `ProviderFactory`, UI slots) — those are available to plugins only;
- ❌ an add-on **gets no direct access to the core internals**: neither to `FileStore`,
  nor to `GatewayProvider`, nor to sessions bypassing the API;
- ⚠️ **we do not keep an LLM inside the service:** the Synth agent generates
  text/decisions, while the add-on does deterministic work (registry, storage, rendering,
  publishing, transport). Need an LLM — call it **through Synth**, not your own.

An add-on is allowed in **any mode** (standalone, hybrid, managed) and talks to
Synth at the same addresses as any external client.

---

## 2. Integration points

| Channel | Transport | What it provides | Key points | Authentication |
|---|---|---|---|---|
| **API v2** | HTTP (Hono), base path `/api/v2` | Reading/writing sessions, projects, messages; event ingestion | `GET /health`; `GET /sessions`, `GET/POST /sessions`; `POST /sessions/:id/messages`; `POST /events`; `GET/POST/DELETE /events/bindings` | `Authorization: Bearer <key>` (roles `ADMIN`/`USER`/`LEAD`/`AUDITOR`); health — no auth |
| **MCP** | stdio (for the local engine) or Streamable HTTP | Expose your tools to the agent | MCP tools; names are namespaced `{server}_{tool}` | By the MCP server's rules (token in a header/arguments) |
| **External events (ingest)** | HTTP `POST /api/v2/events` | Bring events into Synth (messenger messages, webhooks) | Body: `source`, `type`, `payload`, `identity`, `dedupKey` | `requireAuth` **or** the binding API key `Authorization: Bearer synth_evt_…` |
| **Event bindings** | HTTP `/api/v2/events/bindings*` | Link a source to a session/project, issue keys | `GET/POST/DELETE /events/bindings`; `POST /bindings/:id/keys`; `PATCH .../keys/:keyId`; `POST .../keys/:keyId/revoke` | `requireAuth` (read), `ADMIN`/`LEAD` (mutations) |
| **Event reading (push)** | SSE `GET /api/v2/events`; WS `/ws/events` | Receive the Synth event stream in real time | — | Require authentication (Bearer/session) |

Notes:

- **API v2 base.** All routes except `GET /health` require authentication;
  without a key — `401`. The base URL in dev — `http://localhost:5000/api/v2`.
  Details — the API v2 documentation in the Synth repository (AD-017).
- **MCP.** An add-on can expose tools to the agent in **two** ways: a local
  **stdio** server (the engine spawns the process itself — `node dist/index.js --mcp`)
  or a **Streamable HTTP** endpoint (an example — `node dist/index.js --http`;
  MCP is served on the same HTTP server, path `/mcp`). Synth registers
  MCP servers in the registry (AD-071) and namespaces the tools as
  `{serverName}_{toolName}` — that is why the `example_ping` tool of the
  `synth-addon-example` server is visible to the agent as `synth-addon-example_example_ping`.
  For an external add-on, the MCP address/port/path are declared in `provides.mcp` (§4.1) and
  registered by auto-install (see [deployment.md](./deployment.md)). An add-on
  serving several environments adds a tenant to the path (`/mcp/{tenant}`).
- **External events (AD-089).** Every call to `POST /api/v2/events` carries at
  least the fields:
  - `source` — the source identifier (for example, `telegram`);
  - `type` — the event type (for example, `message`, `callback_query`);
  - `payload` — an arbitrary body;
  - `identity` — information about the source user (mapping into the profile/RBAC);
  - `dedupKey` — the deduplication key (a repeated call with the same `dedupKey`
    is dropped — **an add-on must send a stable `dedupKey`**).

  Ingest authentication: either a regular user key (`requireAuth`) or the
  **binding API key** (`Authorization: Bearer synth_evt_…`) — then `source`/chat
  are taken from the binding and no user credentials are needed. Key usage
  is written to the Router journal (`GET /api/v2/events/journal`). With
  `events.enabled: false`, ingest responds `503`. The per-key rate limit (`KeyRateLimiter`)
  yields `429 RATE_LIMITED`.
- **Bindings and keys.** An `EventBinding` links a source to a target session;
  a binding key is issued through `POST /events/bindings/:id/keys` (the secret
  `synth_evt_<base64url>` is returned **once**, at rest only the
  sha256 hash is stored). Update/revocation — `PATCH .../keys/:keyId` and
  `POST .../keys/:keyId/revoke`.
- **Event reading.** SSE `GET /api/v2/events` and WS `/ws/events` require
  authentication; use them if an add-on needs to **react** to Synth events,
  not just bring its own.

> **What an add-on does not have.** Lifecycle hooks (`pre_tool_use`, `session_start`,
> …), `ToolRegistry`, `ProviderFactory`, UI slots and in general any access to the
> core process — these are the Extension API of **plugins** (AD-090). An add-on lives
> outside the process and uses only the public contracts listed above.

---

## 3. Mandatory requirements for an add-on

A service is considered a valid add-on if it does everything listed below.

1. **`GET /health` without authentication.** Returns `200` and JSON like
   `{ "status": "ok", "version": "…" }`. Used by deployment (liveness/readiness),
   Helm probes and external monitoring. The other routes may require a
   Bearer token.
2. **Configuration through env (priority CLI flag > env > secrets file >
   default).** Plus the rule: **an empty/whitespace-only string = no
   value**. This is critical for the engine, where the `{env:VAR}` substitution yields an
   empty string when the variable is unset, rather than `undefined`. Implementation — a single
   helper `envOr` (`apps/example/src/config.ts`). The full reference —
   [configuration.md](./configuration.md).
3. **Secrets — outside git and not in logs.** Tokens/keys/passwords are not stored in
   the repository; in K8s — a Secret (`existingSecret`, an example — `examples/secret.yaml`),
   locally — env or a secrets-file directory outside git. Secrets do not get into the
   image or the logs: the log only records whether a secret is set.
4. **Idempotency and input deduplication.** Redelivery of the same event must
   not produce duplicates: the add-on deduplicates input events itself
   (by a stable `dedupKey`/`update_id`/message id) **before** sending to
   Synth, and passes a stable `dedupKey` in `POST /api/v2/events`.
5. **Dry-run without secrets.** Without external-system tokens the service does not
   crash but runs in dry-run mode (methods make no network calls and return a
   predictable result).
6. **Structured logs.** Logs — with the service prefix (`[addon] …`),
   messages in Russian; secrets and full bodies of private messages must not get
   into logs. HTTP errors — the single format `{ error: { code, message } }`.
7. **A clear scope of responsibilities.** Each service is responsible for its narrow domain;
   **we do not drag an LLM into the service** — generation/understanding is done by the Synth engine.
8. **Storage — following the Synth model.** If the service needs state — JSON through
   FileStore (atomic write `*.tmp.<uuid>` → `rename()`, AD-005), not
   scattered hand-rolled formats.
9. **Egress through a proxy (when needed, AD-088).** Outgoing requests to
   the outside world — through the shared egress layer/proxy, if one is set
   (`createProxyAgent` in `packages/example-lib/src/egress.ts`).

---

## 4. Compatibility and versioning

Compatibility with Synth is described by the **`synth.pack`** manifest in the repository root:

```json
{
  "name": "@itphx/synth-addon-example",
  "version": "0.0.0",
  "kind": "addon",
  "host": "^0.9.0",
  "contracts": { "apiV2": "^2", "events": "^1", "mcp": "^1" },
  "description": "Example external companion service for Synth",
  "provides": {
    "mcp": {
      "name": "synth-addon-example",
      "transport": "http",
      "port": 7100,
      "path": "/mcp",
      "description": "Example MCP server of the add-on template (the example_ping tool)"
    },
    "skills": [{ "name": "example", "path": "skills/example" }]
  }
}
```

| Field | Meaning |
|---|---|
| `name` | The full package/service name (matches the application's `package.json`) |
| `version` | The add-on version (semver) |
| `kind` | Always `addon` (the strict AD-090 terminology) |
| `host` | The range of **compatible Synth versions** (a semver range over the core version) |
| `contracts` | Version ranges of the contracts used: `apiV2`, `events`, `mcp` |
| `description` | A short description |
| `provides` | **Optional.** What the add-on installs into Synth: an MCP server and/or skills (see §4.1) |

Rules:

- **Semver.** Breaking changes to the add-on's public contract (routes, event
  format, MCP tool names) are major; backward-compatible additions are minor.
- **`host` and `contracts`** are checked at install/connect time: if the Synth
  version or the contract is out of range — the add-on is considered incompatible.
- **Deprecation window.** A deprecated contract is announced in advance and supported
  for at least one minor core release, by analogy with the AD-086 policy.
- The add-on registry/catalog and the trust/install policy — following AD-068
  (the shared trust infrastructure is reused).

### 4.1 `provides` — what the add-on installs into Synth

`provides` describes the **declarative resources** of the add-on that are installed into
a Synth instance at deploy time (Helm chart auto-install, `autoInstall.enabled=true`;
see [deployment.md](./deployment.md) "Auto-install of resources"). Both fields
are optional and independent:

```json
"provides": {
  "mcp": { "name": "<registry-name>", "transport": "http", "port": 7101, "path": "/mcp/{tenant}", "description": "…" },
  "skills": [{ "name": "<skill-name>", "path": "skills/<skill-name>" }]
}
```

| Field | Meaning |
|---|---|
| `provides.mcp.name` | The MCP server name in the Synth registry (AD-071); the tools are visible to the agent as `{name}_{tool}` |
| `provides.mcp.transport` | `http` (Streamable HTTP) or `sse`; `stdio` is not used for an external add-on |
| `provides.mcp.port` | The MCP server port (matches the chart's `service.mcpPort`/`service.port`) |
| `provides.mcp.path` | The MCP path; `{tenant}` is substituted with the `autoInstall.tenant` value |
| `provides.mcp.description` | A human-readable server description (goes into the prompt's `mcp.servers` block) |
| `provides.skills[].name` | The skill name (AD-046): lowercase Latin letters/digits, hyphen as the separator |
| `provides.skills[].path` | The skill directory with `SKILL.md` (relative to the repository root) |

### 4.2 The three kinds of add-ons

`provides` and `service.enabled` in the chart define three valid configurations:

| Kind | `provides` | `service.enabled` | What is deployed |
|---|---|---|---|
| **Service + MCP + skills** | `mcp` + `skills` | `true` | Deployment + Service (+ MCP port) + install hook Job |
| **MCP only / skills only** | `mcp` only or `skills` only | `false` | only the install hook Job (no service needed) |
| **Nothing declarative** | absent | `false` | nothing (a chart skeleton/image only) |

An add-on **without a service** is a full-fledged configuration: the resources are installed by the hook Job, while
Deployment/Service/PVC/Ingress are not rendered. If the add-on has no image either, the skill
files are passed through a ConfigMap (`autoInstall.skillsFromConfigMap`), and
the installer — through a ConfigMap (`autoInstall.scriptConfigMap`); details —
[deployment.md](./deployment.md).


---

## 5. Repository structure

The template is a pnpm workspace of **two packages** with an explicit example of both roles:
a **service** (`apps/*` — runs) and a **library** (`packages/*` — imported by the
service).

```text
synth-addon-template/
├── synth.pack                  # add-on manifest (kind/host/contracts/provides)
├── package.json                # private, type:module, pnpm scripts
├── pnpm-workspace.yaml         # apps/*, packages/*
├── tsconfig.base.json          # shared strict-TS config
├── tsconfig.json               # project-references to the packages
├── apps/
│   └── example/                # SERVICE (the "app" role): runs, has a bin
│       └── src/
│           ├── index.ts        # bin: HTTP (Hono) + --mcp (stdio) / --http (MCP HTTP) + --help
│           ├── config.ts       # envOr: CLI > env > secrets file > default
│           ├── server.ts       # GET /health + example routes (echo/fetch), auth, mounting /mcp
│           ├── mcp.ts          # MCP: stdio (the example_ping tool) and Streamable HTTP
│           └── file-store.ts   # JSON FileStore (tmp → rename, AD-005)
├── packages/
│   └── example-lib/            # LIBRARY (the "lib" role): does not run
│       └── src/
│           ├── index.ts        # the package's public API
│           └── egress.ts       # createProxyAgent/requestJson (socks/http, AD-088)
├── skills/example/SKILL.md     # an AD-046 skill
├── scripts/
│   └── install-into-synth.mjs  # reference resource (provides) installer into Synth
├── examples/
│   ├── secret.yaml             # example service Secret (a plain manifest, not Helm)
│   └── installer-secret.yaml   # example Secret with the installer key (autoInstall)
├── docker/Dockerfile           # multi-stage service image (node:22-alpine)
├── docker-compose.yml          # local service run + volume for data
├── charts/synth-addon/         # Helm chart (k8s + autoInstall hook Job + NOTES.txt)
│   └── templates/install-job.yaml          # the auto-install hook Job
│   └── templates/install-skills-configmap.yaml  # skills without an image
├── docs/contract.md            # this document (the canonical source)
├── docs/configuration.md       # configuration and secrets
├── docs/deployment.md          # docker/compose/K8s/Helm/auto-install
├── README.md
└── AGENTS.md
```

Directory roles:

| Directory | Purpose |
|---|---|
| `apps/*` | Runnable services (HTTP/MCP). Each service is a separate package with a `bin` |
| `packages/*` | Libraries reused between services (clients, domain, utilities). They do not run, they are imported via `workspace:*` |
| `skills/*` | AD-046 skills (`SKILL.md` + supporting files) — content for the agent |
| `scripts/*` | The resource (`provides`) installer into a Synth instance — the reference implementation |
| `examples/` | Example manifests (Secret, etc.) — outside the Helm templates |
| `docker/` | Service Dockerfile(s) |
| `charts/` | Service Helm chart(s) (+ the auto-install hook Job) |
| `docs/` | Contract, configuration, deployment |

Dependency layers: `packages/*` **do not import** from `apps/*`; applications
import packages, but not the other way around. Between packages — workspace dependencies
(`"@itphx/synth-addon-example-lib": "workspace:*"`).

---

## 6. Add-on readiness checklist

Before releasing an add-on, check:

- [ ] **Health.** `GET /health` responds `200` without auth, JSON `{status, version}`.
- [ ] **Config.** Priority CLI > env > secrets file > default; an empty string = no
      value (`envOr`); all secrets are read from env/file, never hardcoded.
- [ ] **Secrets.** No secrets in the code, image or logs; in Helm —
      `existingSecret`/Secret, not values in `values.yaml`.
- [ ] **Idempotency.** Input events are deduplicated; a stable
      `dedupKey` is passed in `POST /api/v2/events`.
- [ ] **Dry-run.** Without external-system tokens the service starts and runs in
      dry-run without making network calls.
- [ ] **Logs.** Service prefix, messages in Russian, the single error format
      `{error:{code,message}}`, no secrets.
- [ ] **Docker.** `docker/Dockerfile` builds (multi-stage); the image starts the
      service and listens on the expected port.
- [ ] **Compose/Helm.** `docker-compose.yml`, `charts/synth-addon`
      (`helm lint` + `helm template` green).
- [ ] **`provides`.** The add-on resources are described in `synth.pack` (`provides.mcp` /
      `provides.skills`) or explicitly absent; the names match the real ones
      (the MCP server name in the registry, the skill names), the MCP `path` matches the
      service route.
- [ ] **Auto-install.** `helm template` for your kind of add-on (service+MCP+
      skills / without a service / skills only) renders without errors; the hook Job
      is idempotent (a repeated run does not create duplicates, the installer is
      checked with `--dry-run`); the installer key lives in a Secret, not in values.
- [ ] **README/AGENTS.** The purpose, commands, config and boundaries are described.
- [ ] **Compatibility.** `synth.pack` is filled in (`host`, `contracts`, semver);
      the ranges match the contracts actually used.
- [ ] **Build/tests.** `pnpm build && pnpm typecheck && pnpm lint && pnpm test`
      green; there are tests for health, config, storage and the egress layer.
