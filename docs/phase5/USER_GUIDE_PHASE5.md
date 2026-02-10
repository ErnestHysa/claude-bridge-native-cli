> **Historical note:** This document is preserved for upgrade traceability. For current runtime setup/usage, use `README.md`, `setup.md`, and `GUIDE.md` in the repository root.

# User Guide (Phase 5 Edition)

This guide is focused on the assistant-first workflow after the roadmap upgrades.

## 1) Natural language first

You can now ask for work directly in plain language, for example:

- "Find TypeScript files in auth and explain structure"
- "Run tests and summarize failures"
- "Create an automation to run at 2am every day"

The bridge routes your request to Claude CLI behavior and returns markdown-formatted output in Telegram.

## 2) Automation schedules in plain language

When creating automations, use phrases such as:

- `every 6 hours`
- `weekdays at 8:30am`
- `every monday at 9am`
- `monthly on the 10th at 6pm`

The system converts this to cron internally.

## 3) Reliable operation checks

Run these before production updates:

```bash
npm run typecheck
npm run lint
npm test -- --run
```

## 4) Safety reminders

- Keep permission level at `supervised` unless you explicitly want autonomous writes.
- Keep allowed project paths limited to trusted repositories.
- Review generated plans before approving broad multi-file edits.

## 5) Troubleshooting

- If schedule parsing fails, rewrite with explicit time and cadence (e.g. `daily at 2am`).
- If lint fails due to new rules, fix violations before release.
- If tests fail, block deploy and review the affected subsystem before retry.
