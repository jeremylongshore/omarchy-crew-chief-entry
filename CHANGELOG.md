# Changelog

Notable changes to Crew Chief.

Entries are derived from this repository's commit history, so every line
corresponds to a real change. The format follows Keep a Changelog and the
project uses Semantic Versioning.

## [Unreleased]

Nothing yet.

## [1.0.0] - 2026-08-22

### Security

- Bound every row Text and pin it to PlainText, and clear the dash voice
- Bound the spool read so agent-controlled growth cannot exhaust shell memory

### Added

- Crew Chief v1.0.0: Claude Code fleet attention router for the Omarchy bar
- Every make and model: harness-agnostic fleet via protocol, adapters, and Herdr sync

### Fixed

- State what the plugin actually does instead of naming one harness

### Internal

Tooling and repository changes with no effect on the shipped plugin.

- Rewrite taglines in plain English
- Promote static checks into a blocking CI job
- Pin the vendored lane to a manifest and refuse to run it unverified
- Re-sync the vendored lane and add an advisory freshness check
- Vendor c40, the panel design gate, and repair the sync that dropped it
- Vendor rig-render, which loads the plugin into a real shell
