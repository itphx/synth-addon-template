# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## About

`synth-addon-template` is the skeleton repository for Synth add-ons. It is a
template with no public releases: the version in `package.json` and `synth.pack`
is `0.0.0`, to be replaced with your own numbering when you start an add-on from
it.

Release notes are published on the **Releases** page:

- GitVerse — <https://gitverse.ru/itphx/synth-addon-template/releases>
- GitHub (mirror) — <https://github.com/itphx/synth-addon-template/releases>

Add-ons are **versioned independently of the Synth core**: their version numbers
are not tied to `@itphx/synth-*`. Compatibility with a core version is declared by
the `host` field in [`synth.pack`](./synth.pack).

## [Unreleased]

### Added

- Community health files (contributing guide, code of conduct, security policy,
  support, changelog, third-party notices) and GitHub templates.

## [0.0.0] - 2026-10-12

### Added

- Initial template: pnpm workspace (`apps/`, `packages/`), sample add-on service
  with MCP (stdio + HTTP) and HTTP API, `synth.pack` manifest, Helm chart with
  auto-install hook, Docker assets and `docs/`.
