# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-04-29

Initial release.

### Added

- `skeem` — relational-aware CLI for headless backends, built for AI agents.
- `@skeems/directus` — Directus adapter for the skeem CLI.
- Discovery (`ls`, `describe`, `discover`), CRUD (`create`, `find`, `update`, `delete`),
  relation-aware writes (`upsert`, `link`, `unlink`), and compound `exec`.
- Schema management: `discover`, `diff`, `define`.
- System features: aliases, provenance, versions, trash, claims, annotations,
  idempotency.
- Stable JSON envelopes for agent-friendly output.
- End-to-end smoke harness against a local Directus fixture.

[Unreleased]: https://github.com/ambirex/skeem/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ambirex/skeem/releases/tag/v0.1.0
