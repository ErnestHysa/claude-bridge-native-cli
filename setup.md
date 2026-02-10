# Setup Guide

This guide is for the current upgraded architecture of **Claude Bridge Native CLI**.

## 1) Prerequisites

- Node.js `>=20`.
- npm.
- Telegram bot token from `@BotFather`.
- Your Telegram numeric user ID (for allowlist).
- `claude` CLI installed and available in `PATH`.

### Verify prerequisites

```bash
node -v
npm -v
claude --version
```

## 2) Install dependencies

```bash
npm install
```

## 3) Configure environment

Copy and edit environment file:

```bash
cp .env.example .env
```

Required keys:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_USERNAME`
- `ALLOWED_USER_IDS` (recommended) or `ALLOWED_USERS`

Commonly tuned keys:

- `PROJECTS_BASE`
- `CLAUDE_DEFAULT_MODEL`
- `CLAUDE_TIMEOUT_MS` (`0` = no timeout)
- `CLAUDE_PERMISSION_MODE`
- `SESSION_TIMEOUT_MS`
- `MAX_CONCURRENT_SESSIONS`
- `LOG_LEVEL`

> Note: the current spawner uses `--dangerously-skip-permissions` for non-interactive Telegram execution. Keep that in mind for threat modeling and machine trust boundaries.

## 4) Build / run

Development mode:

```bash
npm run dev
```

Production mode:

```bash
npm run build
npm run start
```

## 5) First run in Telegram

1. Open your bot in Telegram.
2. Send `/start`.
3. If first launch, complete setup wizard prompts.
4. Run `/projects` and `/select` (or `/addproject <absolute-path>`).
5. Send a plain text prompt to execute Claude against selected project.

## 6) Validate installation

Local checks:

```bash
npm run typecheck
npm run lint
npm run test
```

Runtime checks from Telegram:

- `/status` should show session/project.
- `/metrics` should return daily counters.
- `/state` and `/recovery` should return persistence/recovery health.
- `/logs app 20` should return recent log lines.

## 7) Runtime storage layout

The app creates and uses `brain/` beneath the project root, including:

- `brain/memory/`
- `brain/projects/`
- `brain/tasks/`
- `brain/sessions/`
- `brain/automations/`
- `brain/logs/`
- `brain/plugins/`
- `brain/database/`
- `brain/checkpoints/`
- `brain/recovery/`

Do not commit runtime artifacts from these paths unless intentionally snapshotting/debugging.

## 8) Troubleshooting

### Bot starts but replies “not authorized”
- Confirm your numeric ID in `ALLOWED_USER_IDS`.
- Restart process after `.env` edits.

### Claude command fails
- Ensure `claude` works from same terminal user (`claude --version`).
- Confirm selected project path exists.

### No projects detected
- Verify `PROJECTS_BASE` exists and contains subfolders.
- Use `/addproject <absolute-path>` for manual registration.

### Unexpected shutdown recovery warnings
- Check `/recovery`.
- Inspect `brain/recovery/` reports and `brain/logs/error-*.log`.

