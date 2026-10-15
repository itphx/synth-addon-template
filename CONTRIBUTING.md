# Contributing to synth-addon-template

Thanks for your interest in improving the Synth add-on template! This repository
is the skeleton for **external add-on services** of the [Synth](https://gitverse.ru/itphx/synth)
agent platform.

A Russian version of this document is available: [CONTRIBUTING.ru.md](./CONTRIBUTING.ru.md).

## Development model and pull requests

- **Canonical development happens in GitVerse** —
  <https://gitverse.ru/itphx/synth-addon-template> (branch `master`).
- **GitHub is a public mirror** — <https://github.com/itphx/synth-addon-template>.
  Issues and pull requests are welcome there, but the maintainer does **not** merge
  them on GitHub: accepted changes are **cherry-picked into GitVerse**. Please keep
  the branch rebased on `master` so it applies cleanly.
- One logical change per pull request. Describe what and why.

## Requirements

- **Node.js ≥ 22** (see `engines` in [`package.json`](./package.json)).
- **pnpm ≥ 10** (see `engines`; the repository uses pnpm workspaces).
- Git.

## Getting started

```bash
git clone https://gitverse.ru/itphx/synth-addon-template.git
cd synth-addon-template
pnpm install
```

## Checks

Run all of these from the repository root before opening a pull request. The
command names below are the exact scripts from [`package.json`](./package.json):

| Command | Purpose |
|---|---|
| `pnpm build` | Build every workspace package (`pnpm --recursive run build`) |
| `pnpm typecheck` | Type-check every workspace package |
| `pnpm lint` | ESLint every workspace package |
| `pnpm test` | Run Vitest for every workspace package |
| `pnpm clean` | Remove build output |

Local pre-flight check:

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm test
```

## Branch naming

| Prefix | Use for |
|---|---|
| `feat/*` | New functionality |
| `fix/*` | Bug fixes |
| `docs/*` | Documentation only |
| `chore/*` | Tooling, CI, dependencies, housekeeping |

## Commit messages — Conventional Commits

Use [Conventional Commits](https://www.conventionalcommits.org/) with a **Russian**
description:

```text
<type>(<scope>): <краткое описание в повелительном наклонении>
```

Allowed types: `feat`, `fix`, `docs`, `refactor`, `test`, `ci`, `chore`.
`scope` is optional (for example `feat(example): …`).

Examples:

```text
feat: добавлен тул example_ping для MCP-сервера
fix(config): корректная обработка пустого значения env
docs(contract): уточнён чек-лист готовности add-on'а
```

## Sign-off (DCO)

Every commit must be signed off to certify the
[Developer Certificate of Origin](https://developercertificate.org/):

```bash
git commit -s -m "feat: ..."
```

The `Signed-off-by:` line is required; pull requests without it cannot be accepted.

## The `synth.pack` manifest

`synth.pack` (JSON in the repository root, no file extension) is the single
extension manifest: it declares `kind`, `host`, `contracts` and `provides`
(MCP servers and/or skills).

- If you change the add-on **composition** — add/remove an MCP server or a skill,
  change `kind`/`host`/`contracts` — update `synth.pack` **and** its `version`.
- Keep the manifest in sync with what the Helm chart actually installs.

## Documentation

- User- and integrator-facing documentation lives in `docs/*.md`
  ([contract.md](./docs/contract.md), [configuration.md](./docs/configuration.md),
  [deployment.md](./docs/deployment.md)). Update the relevant page whenever
  behaviour, configuration or deployment changes.
- Keep [README.md](./README.md) consistent with the code.
- Documentation is written in **Russian**.

## Secrets

- **Never commit secrets.** `secrets/`, `.env` and `.env.*` are git-ignored.
- Example manifests under `examples/` must contain **placeholders only**
  (for example `REPLACE_ME`) — never real tokens, keys or certificates.
- Use a Secret manager or `SealedSecret` in production, not committed files.

## Contact

- Email: **admin@itphx.ru**
- Telegram: <https://t.me/synth_dev_admin>

By contributing, you agree that your contributions are licensed under the
[MIT License](./LICENSE).
