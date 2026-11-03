# Validation status

## Release candidate — November 3, 2026

Version **1.0.0**, maintained by **Eric Busby** (`ericbusby77`). Prepared from a fresh
checkout of the Bitfocus-created repository, without importing earlier local history.
The source includes the official module-check and release workflows, plus CI that runs
source checks and smoke tests against an extracted package.

## Automated checks

A fresh immutable installation passed using Node 26.5.0 and Yarn 4.12.0. Formatting,
ESLint, TypeScript, all **52 tests**, the official module validator, package build and
both extracted-package smoke tests passed. The full locked dependency audit returned
no advisories on November 3, 2026. The validator runs after the build because it loads
compiled output. Hosted GitHub checks remain pending until upload.

Coverage includes authentication, bounded token refresh, redirect rejection, sanitized
errors, malformed responses, routing payloads, per-player serialization, override timers,
replacement and conditional restoration, persisted recovery, dropped responses, shutdown,
large-site limits, CAP arming, exclusive selection, clear-all attempts, bulletin preflight,
complete-record reads, correlated CAP logs and verification failures.

The routing package smoke test authenticates, discovers, routes temporarily, restarts
with an expired snapshot and restores the original channel and schedule through a
loopback mock. The emergency package smoke test selects Shelter and Evacuate separately,
clears both, checks correlated processing and complete bulletin state, and confirms that
denied detail reads block activation. Its requests are handled entirely in memory.

Source and package scans found no assistant attribution, private installation details,
machine paths or recognized credential patterns. Required third-party notices remain.
These checks are useful evidence, not proof that every possible defect or secret is absent.

## Live evidence

Earlier live testing covered player routing, replacement timed overrides, manual and
automatic restoration, restart recovery and schedule restoration. API discovery and
separate CAP activation/clearing were also tested, and the maintainer reported that the
integration worked. Those tests preceded the final bulletin-verification changes.

On November 3, fresh API sessions passed bulletin preflight with **Create – Alert Bulletins**
and **Create – Template Bulletins** assigned directly to the emergency zone. Full Access
was off. A zone-tag assignment of the same role had not permitted the required reads.
The site role supplied System Configuration and Manage Players.

Each alert tag resolved to exactly one complete bulletin, both inactive (`Current_Null`).
Verification using each bulletin's existing historical clear command passed, including
message identifier, target bulletin, processing result and current state. This validates
read access and real response compatibility, not a newly submitted alert command.

The executable is installed on Companion 5.1.1 with a healthy connection, working channel
discovery, no active timed overrides and no reported module or emergency errors. The
three existing alert actions retain their separate selections and protected hold groups.
No production CAP or player-routing commands were sent during final commissioning or
submission preparation.

## Package identity

- Submission archive SHA-256: `eca467500d64c64fbffe3eb4f0c84d878bb9e94d8310902a94225fcba9670b59`.
- Installed archive SHA-256: `47e96c294e44f76e6727421837d47060b9d85e33e3a27b48738b83af28cd7f7c`.
- Both contain the same executable SHA-256: `1e3db4f0750702d88fa43eb2eb9cb1f116a1364b3d9b66a073b28543d9c9db6e`.

The submission archive differs from the installed archive only in HELP, which adds the
tested permission guidance. Both built manifests identify version 1.0.0 and API 2.1.3.

## Remaining acceptance and limits

- A supervised screen test of the final version's selection, switching and clearing is
  still required. Follow [LIVE-TEST.md](LIVE-TEST.md). Server-side verification does not
  establish physical screen output or complete campus coverage.
- Verification is a snapshot at command completion. External writers can change state
  afterward; two CAP commands and multiple displays are not one atomic transaction.
- CAP writes are never retried automatically. After a timeout, inspect Carousel before
  retrying. Tags must be globally unique and channels must subscribe to the alert zone.
- CAP requires HTTPS. Regular API HTTP support exists for legacy/local installations;
  use HTTPS to protect authentication and bearer tokens.
- Companion configuration storage has no durable-write acknowledgment. Abrupt power loss
  can interrupt recovery persistence; no atomic transaction spans Companion and Carousel.
- Conditional restoration checks the observed default channel. External writes between
  the check and update can race with it. Preserved schedules may determine displayed output.
- Detailed player variables cover 20 players sorted by name; `players_json` includes all.
  Automatic routing presets are limited to 100 player/channel combinations.
- Dependency audit results cover locked packages, not the host's bundled Node runtime.
  Use a supported Companion runtime.
