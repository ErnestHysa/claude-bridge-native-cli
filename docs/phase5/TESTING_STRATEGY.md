> **Historical note:** This document is preserved for upgrade traceability. For current runtime setup/usage, use `README.md`, `setup.md`, and `GUIDE.md` in the repository root.

# Phase 5 - Testing Strategy and Completion Notes

This document records the Phase 5 testing pass for the Upgrade roadmap (Polish & Testing).

## Scope executed

- Added repeatable quality gates (`typecheck`, `lint`, `test`) to validate core behavior on every change.
- Extended automated test coverage for the scheduling stack that underpins autonomous agents:
  - Natural-language schedule conversion (`nl-to-cron`).
  - Automation markdown parser (`automation-parser`).
  - Cron parser/time computation (`cron-utils`).
- Kept existing dashboard, plugin, and image-analysis tests active as regression coverage.

## Test matrix

### Unit tests

| Module | Coverage intent |
|---|---|
| `nl-to-cron.ts` | Parse user schedule language into deterministic cron output and fail loudly for ambiguous input |
| `automation-parser.ts` | Verify frontmatter parsing, scalar/list coercion, and section extraction |
| `cron-utils.ts` | Verify cron parsing + timezone-aware next-run calculation |

### Integration confidence

The autonomous scheduler path depends on these modules in sequence:

1. User text schedule → `convertNaturalLanguageToCron`
2. Automation markdown frontmatter/body parsing → `parseAutomationMarkdown`
3. Runtime next-run computation → `getNextCronRun`

By covering these three components with deterministic tests, we reduce runtime scheduling drift and parsing regressions.

## Remaining E2E recommendation

A Telegram-connected E2E suite (real bot token + isolated Claude CLI fixture) should be run in CI secrets-enabled pipelines. This repository currently does not include an emulator for Telegram webhooks/polling sessions, so full network E2E is documented as an operational follow-up.
