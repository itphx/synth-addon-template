# Security Policy

We take the security of Synth add-ons seriously. Thank you for helping keep the
project and its users safe.

A Russian version of this document is available: [SECURITY.ru.md](./SECURITY.ru.md).

## Reporting a vulnerability

**Please do not open a public issue for security problems.** Report privately:

- Email: **admin@itphx.ru**
- Telegram: <https://t.me/synth_dev_admin>

If possible, encrypt or otherwise limit distribution of any exploit details until
a fix is available.

## What to include

To help us triage quickly, please provide:

- **Add-on version** (`version` in `package.json` / `synth.pack`, or the git tag).
- **Synth version** the add-on was used with.
- **Environment** — OS, deployment method (Docker / Helm / `synth.pack`
  auto-install), Node.js version, and relevant configuration (redact secrets).
- **Steps to reproduce** — a minimal sequence that triggers the issue.
- **Proof of concept** — logs, requests, or a small script where possible.
- **Impact** — what an attacker could achieve.

## Response timeline

These are **best-effort** targets for a small maintainer team:

| Stage | Target |
|---|---|
| Acknowledgement of the report | within **72 hours** |
| Initial assessment and severity triage | within **7 days** |
| Fix or mitigation | as soon as practical, coordinated with you |

We will keep you informed of progress and credit you in the release notes unless
you prefer to remain anonymous.

## Scope

**In scope:**

- Code in this repository (`apps/`, `packages/`, scripts, Docker and Helm assets).
- The add-on's integration surface: authentication/authorization handling,
  secret handling, input validation, and misconfiguration that leads to a
  security impact.

**Out of scope:**

- Vulnerabilities in the **Synth core** itself — report those to the main
  repository instead: <https://gitverse.ru/itphx/synth>.
- Vulnerabilities in **third-party dependencies** — report them to the upstream
  project; we will still update the dependency once a fix is released.
- Issues that require an already-compromised host, or that stem purely from
  intentional misconfiguration (for example, exposing the service publicly when
  the documentation says not to).
- Social engineering, physical access, and denial-of-service by resource
  exhaustion on self-hosted deployments.

## Secrets policy

- Secrets (tokens, API keys, client secrets, certificates) must **never** be
  committed. `secrets/` and `.env` are git-ignored; see
  [CONTRIBUTING.md](./CONTRIBUTING.md).
- Example manifests under `examples/` contain **placeholders only** (for example
  `REPLACE_ME`) and must never hold real values.
- If you believe a secret was committed by accident, treat it as compromised:
  rotate it immediately and notify us at the contacts above.
