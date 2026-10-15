# Configuration and secrets

> 🌐 **English** · [Russian](../configuration.md)

The single configuration reference for the add-on template. Implementation — in
`apps/example/src/config.ts` (the `envOr` helper).

## Value priority

```text
CLI flag  >  env  >  secrets file  >  default
```

Rule: **an empty/whitespace-only string = no value**. This is critical for the
engine, where the `{env:VAR}` substitution yields an empty string when the
variable is unset, rather than `undefined`; the `envOr` helper returns `fallback`
(or `undefined`) for empty and whitespace values.

## Environment variables and CLI flags

| Env | CLI flag | Default | Purpose |
|---|---|---|---|
| `SYNTH_ADDON_DATA_DIR` | `--data-dir` | `<repo>/data` | JSON storage directory |
| `SYNTH_ADDON_HOST` | `--host` | `127.0.0.1` | HTTP listen address |
| `SYNTH_ADDON_PORT` | `--port` | `7100` | HTTP port |
| `SYNTH_ADDON_TOKEN` | `--token` | — | API Bearer token (auth is off without it) |
| `SYNTH_ADDON_PROXY_URL` | `--proxy` | — | Egress proxy (otherwise `ALL_PROXY`/`HTTPS_PROXY`/`HTTP_PROXY`) |
| `SYNTH_ADDON_SECRETS_DIR` | — | `<repo>/secrets` | Secrets-file directory |

A special launch flag: `--mcp` — start an MCP server over stdio instead of HTTP.
`--help`/`-h` — help.

Egress proxy chain: `SYNTH_ADDON_PROXY_URL` → `ALL_PROXY` → `HTTPS_PROXY` →
`HTTP_PROXY` → secrets file.

## Secrets

Do **not commit** secrets and do **not print them in logs** (the log only records
whether a secret is set or not). There is no `secrets/` directory in the template's
git: this is only a description of the mechanism. The ways to set them:

1. **CLI flag / env** — for a local run (`--token`, `SYNTH_ADDON_TOKEN`).
2. **Secrets files** — the `SYNTH_ADDON_SECRETS_DIR` directory (default
   `<repo>/secrets`), permissions `600`, outside git. The file name = the variable
   name in lowercase:

   | File | Env variable | Purpose |
   |---|---|---|
   | `<secretsDir>/token` | `SYNTH_ADDON_TOKEN` | API Bearer token |
   | `<secretsDir>/proxy_url` | `SYNTH_ADDON_PROXY_URL` | Egress proxy (socks/http) |

   An empty or whitespace-only file is equivalent to no value.

3. **Kubernetes Secret** — the name is set in the chart's `existingSecret` and mounted
   as `envFrom`. An example manifest — [examples/secret.yaml](../../examples/secret.yaml)
   (a plain Secret, NOT a Helm template). In production, use a SealedSecret/an external
   secret manager.

Separate from the service secrets is the **auto-install installer key** (the same
class of secrets, a different purpose): the Secret name is `autoInstall.installerSecretName`,
the key — `autoInstall.installerSecretKey` (default `token`). The hook Job
substitutes the value into the `SYNTH_INSTALL_TOKEN` env; locally the same token is
read by the installer from `--token` / the `SYNTH_INSTALL_TOKEN` env. An example
manifest — [examples/installer-secret.yaml](../../examples/installer-secret.yaml); details —
[deployment.md](./deployment.md) "Auto-install of resources".

Example of populating the secrets directory locally (outside git):

```bash
mkdir -p secrets
printf '%s' 'dev-token'            > secrets/token
printf '%s' 'socks5://proxy:9050'  > secrets/proxy_url
chmod 600 secrets/*
```

## Local docker compose environment

Copy [.env.example](../../.env.example) to `.env` (outside git) and fill in
`SYNTH_ADDON_TOKEN` / `SYNTH_ADDON_PROXY_URL`; an empty string = the value is not set.
Run details — [deployment.md](./deployment.md).
