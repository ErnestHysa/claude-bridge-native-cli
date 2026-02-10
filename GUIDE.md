# User Guide (Current Version)

This guide reflects the upgraded bot/brain architecture in `src/`.

## Core usage flow

1. `/start`
2. `/projects` (or `/addproject <absolute-path>`)
3. `/select`
4. Send natural-language prompt (non-command text) to run Claude in selected project
5. Use `/cancel` for long-running jobs

## Command reference

## 1) Core bot

- `/start` - initialize chat session and setup wizard when needed
- `/help` - full command list
- `/projects` - list discovered projects
- `/select` - pick active project
- `/addproject <path>` - add project manually
- `/rmproject <name>` - remove project
- `/rescan` - rescan base directory
- `/status` - session + project + process status
- `/cancel` - stop active Claude process

## 2) Memory and context

- `/remember <key> <value>`
- `/recall <query>`
- `/semantic <query>`
- `/context`
- `/index [project-path]`
- `/search <query>`
- `/file <relative-path>`

## 3) Tasking and agents

- `/task <description> [--bg]`
- `/tasks`
- `/agent <type> <task>`
- `/agents`
- `/history <query>`

## 4) Git and delivery

- `/git <status|log|commit|...>`
- `/cicd <status|add|remove|builds|...>`
- `/docs <...>`
- `/dependencies <...>`
- `/feature <...>`
- `/refactor <...>`

## 5) Health, persistence, and observability

- `/metrics`
- `/logs [app|error|audit] [lines]`
- `/state`
- `/recovery`
- `/export`
- `/heartbeat`
- `/briefing`
- `/checks`
- `/selfreview`

## 6) Preferences, plugins, and automation

- `/profile`
- `/schedule`
- `/schedules`
- `/automation`
- `/automations`
- `/watch [project]`
- `/notifications <...>`
- `/analyze`
- `/learn`
- `/plugins [list|run ...]`

## 7) Autonomous mode & approvals

- `/intentions [filter]`
- `/decisions [filter]`
- `/goals [action]`
- `/autonomous <on|off|status>`
- `/inactivehours <...>`
- `/continue [target]`
- `/handoff [summary]`
- `/permissions [level]`
- `/setautonomousprefs <...>`
- `/approve <id>`
- `/deny <id> [reason]`

## Typical workflows

### A) Daily coding from phone

1. `/select`
2. Ask: “review auth module and suggest simplification”
3. `/task refactor auth middleware --bg`
4. `/tasks` to monitor
5. `/git status` and `/git commit`

### B) Project onboarding

1. `/addproject /absolute/path`
2. `/remember current-project /absolute/path`
3. `/index`
4. `/search entrypoint`
5. `/file src/index.ts`

### C) Autonomous review loop

1. `/permissions supervised`
2. `/autonomous on`
3. `/intentions`
4. `/decisions`
5. `/approve <id>` or `/deny <id> reason`

## Safety notes

- Authorization is enforced via configured user IDs/usernames.
- Long-running Claude jobs are cancelable.
- High-risk autonomous actions should stay in supervised/advisory modes unless machine trust boundaries are well controlled.
- Keep `.env`, logs, and exported state secured.
