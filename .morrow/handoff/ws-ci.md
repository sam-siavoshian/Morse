# Handoff: Speed up the CI workflow with caching, concurrency, path filters and parallel jobs

w-ncossn2t-ci-e9 stopped (previous worker stopped). w-ncossn2t-ci-e10 takes over on branch morrow/ncossn2t/ci.

Last checkpoint: 8b2c4dfba442eff6714cfb5900accee260ef0c70.

## Requirements
Profile .github/workflows/ci.yml and cut wall-clock time without dropping coverage. Specifically: (1) add a top-level concurrency group keyed on workflow + ref with cancel-in-progress for non-main refs; (2) use actions/setup-node with built-in npm caching (cache-dependency-path covering package-lock.json and desktop-app/package-lock.json) and cache Playwright/Electron/Chromium browser binaries (e.g. ~/.cache/ms-playwright, ~/.cache/electron) keyed on lockfile hashes; (3) prefer npm ci with --prefer-offline --no-audit --no-fund; (4) add paths-ignore so docs-only changes (docs/**, *.md, docs/screenshots/**, docs/showcase/**, CHANGELOG.md) skip heavy jobs, while keeping any required status check satisfiable (e.g. a lightweight always-run summary job); (5) split one long serial job into parallel jobs (lint, unit tests for core/ and daemon/, demo/e2e checks), and shard slow e2e/demo suites with a matrix if the test runner supports it; (6) use shallow checkout (fetch-depth: 1) and skip Git LFS where images are not needed; (7) add timeout-minutes to each job and gate only truly OS-specific jobs behind a matrix, running other jobs on ubuntu-latest only. If test scripts in package.json need a flag for sharding or a split into separate npm scripts, make minimal changes there. Preserve all existing checks. Document the before/after rationale briefly in docs/dev/testing.md.

Whole task: Make CI faster

## Files you own
- .github/workflows/ci.yml
- package.json
- docs/dev/testing.md

## Decisions so far (messages from w-ncossn2t-ci-e9, newest last)
- None recorded.

## Changed files on the branch
- None yet.

## Outstanding tests
- Make `npm test` pass.

## Last error
- None detected.

## Who is who
People (Relay names): h-sam-siavoshian. h-sam-siavoshian created this task and decides when a person has to.
Workstreams:
- ci: Speed up the CI workflow with caching, concurrency, path filters and parallel jobs (branch morrow/ncossn2t/ci, owns .github/workflows/ci.yml, package.json, docs/dev/testing.md). This is you: w-ncossn2t-ci-e10, codex on sam-siavoshian's machine.

## If you stop
Every worker spends a teammate's plan. When a plan hits its usage limit, or a CLI crashes or signs out, Morrow stops that worker, commits and pushes its worktree as a checkpoint, and starts a replacement on another teammate's machine on the same branch. The replacement starts from that checkpoint and a handoff note, so commit working steps often and post decisions in the channel: what is neither committed nor written down is lost. A replacement confirms with ACK <its lease id>.
