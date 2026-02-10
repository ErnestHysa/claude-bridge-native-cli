# Claude Bridge Native CLI

Claude Bridge Native CLI is a TypeScript Telegram bot that lets you run Claude Code workflows from Telegram while preserving project context, memory, automation, and recovery state between restarts.

## What this version includes

- Telegram chat bridge to local `claude` CLI execution.
- Multi-project management with auto-discovery and Git metadata.
- Per-chat sessions with cancellation and idle-session cleanup.
- Persistent "brain" subsystems (memory, tasks, automations, plugins, approvals, recovery, metrics, SQLite).
- Agentic workflows for docs, dependencies, refactors, features, CI/CD checks, and autonomous intentions/decisions.
- Setup wizard + user identity/preferences persistence.

## Quick start

1. Follow [`setup.md`](./setup.md).
2. Start the bot:

```bash
npm run dev
```

3. In Telegram: `/start` then `/help`.

## Command surface (high level)

### Core bot
`/start`, `/help`, `/projects`, `/select`, `/addproject`, `/rmproject`, `/rescan`, `/status`, `/cancel`.

### Brain and workflow
`/remember`, `/recall`, `/semantic`, `/context`, `/index`, `/search`, `/file`, `/task`, `/tasks`, `/agent`, `/agents`, `/git`, `/history`, `/metrics`, `/profile`, `/schedule`, `/schedules`, `/watch`, `/notifications`, `/analyze`, `/learn`, `/plugins`.

### Advanced automation
`/docs`, `/dependencies`, `/feature`, `/refactor`, `/cicd`, `/heartbeat`, `/briefing`, `/checks`, `/selfreview`, `/intentions`, `/decisions`, `/goals`, `/autonomous`, `/inactivehours`, `/continue`, `/handoff`, `/permissions`, `/setautonomousprefs`, `/approve`, `/deny`, `/logs`, `/state`, `/recovery`, `/export`.

For examples and usage notes, see [`GUIDE.md`](./GUIDE.md).

## Architecture overview

- `src/index.ts`: app bootstrap, session cleanup timer, graceful shutdown.
- `src/telegram-bot.ts`: Telegram command routing + chat workflows.
- `src/claude-spawner.ts`: safe process spawning of `claude --print` with streaming output.
- `src/session-manager.ts`: per-chat session lifecycle and active process tracking.
- `src/project-manager-class.ts` and `src/project-manager.ts`: discovery, Git status, project selection.
- `src/brain/**`: persistence, memory/vector search, tasks, automations, orchestration, approvals, recovery, dashboards, plugins.

## Runtime data

The app creates runtime state under `brain/` (logs, memory, tasks, sessions, automations, DB, checkpoints, recovery heartbeat/crash reports, plugin state).

## Scripts

```bash
npm run dev        # run in watch mode (tsx)
npm run build      # compile TypeScript
npm run start      # run compiled output
npm run typecheck  # TypeScript type-check only
npm run lint       # ESLint
npm run test       # Vitest
```

## Documentation map

- [`setup.md`](./setup.md): full local setup, configuration, and verification.
- [`GUIDE.md`](./GUIDE.md): command reference and practical workflows.
- [`example_usecase.md`](./example_usecase.md): end-to-end scenario.
- [`docs/`](./docs): engineering audits/plans from upgrade phases.
