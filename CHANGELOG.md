# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-06-10

### Added

- Enum / choice fields: `define` creates and updates them (Directus dropdown +
  choices), and `discover` reads the choices back into `enum`.
- `@skeems/types` package — the shared data model and `SkemAdapter` contract now
  live in one place, breaking the type cycle between the CLI and its adapters.

### Changed

- **Schema document format**: many-to-many relations now live in each
  collection's `relations` map (with optional junction detail) instead of a
  top-level `relations: ["a <-> b"]` string array. Re-run `discover` to migrate
  an existing `.skeem.yaml`. A single `define` can now create m2m on brand-new
  collections, and the two declared sides collapse into one junction.
- `SkemAdapter.updateRelation` now takes `(from, to)` instead of Directus-specific
  `current*` fields; relation changes apply as delete-then-recreate.
- `skeem` and `@skeems/directus` now pin `@skeems/types` exactly; releases are a
  three-package lockstep (publish order: types → directus → cli).

### Fixed

- A field named `status` is now writable — it previously collided with the
  `init --status` boolean flag and the value was dropped.
- `discover` no longer emits ghost collections for relations that reference a
  collection the API did not return.

## [0.1.1] - 2026-06-10

### Fixed

- Stop shipping stale compiled test artifacts in the published packages: `build`
  now cleans `dist/` before compiling, and CI fails if `npm pack` would include
  test files.

### Changed

- README: document npm availability, lead with the coordination primitives, and
  add a short "Where It Fits" comparison.
- CLI reference: document exit-code semantics (`0` success, `1` failure; the
  JSON `error.code` is the programmatic contract).

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

[Unreleased]: https://github.com/ambirex/skeem/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/ambirex/skeem/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/ambirex/skeem/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ambirex/skeem/releases/tag/v0.1.0
