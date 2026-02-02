# Claude Bridge CLI - Command Guide

A comprehensive guide to all commands for interacting with Claude Code through Telegram.

---

## Quick Start

```
/start      → Initialize the bot
/projects   → See available projects
/select     → Choose a project to work on
```

Then just send your prompts as messages: `"Refactor the auth module"`

---

## Core Commands

### `/start`
Initialize the bot and create your profile.
**Run once** when first setting up.

### `/projects`
List all available projects.
**Use:** When you want to see what projects are configured.

### `/select`
Select a project with inline keyboard.
**Use:** At the start of each session to choose your active project.

### `/addproject <path>`
Add a project by absolute path.
**Example:** `/addproject C:\Users\Name\my-project`
**Use:** When setting up a new project.

### `/rmproject <name>`
Remove a project.
**Example:** `/rmproject my-project`

### `/rescan`
Rescan the projects directory for new projects.

### `/status`
Show current session and project info.
**Shows:** Active project, Claude process status, conversation length.

### `/cancel`
Cancel the current Claude operation.
**Use:** When you want to stop a long-running request.

### `/help`
Show detailed help message.

---

## Brain Commands 🧠

### `/remember <key> <value>`
Store something in memory for future sessions.

**Examples:**
```
/remember api-key Use sk-1234 for dev environment
/remember decision We chose PostgreSQL over MongoDB
/remember pattern Always use Zod for validation
/remember frontend React with Tailwind CSS
```

**When to use:**
- After making architectural decisions
- When setting preferences
- To document important conventions

---

### `/recall <query>`
Search stored memories.

**Examples:**
```
/recall api-key
/recall PostgreSQL
/recall validation
```

**When to use:** To find what you previously told the bot to remember.

---

### `/index <path>`
Index project for context awareness.

**Examples:**
```
/index                      → Index current project
/index C:\Users\Name\project → Index specific project
```

**What it does:**
- Scans all files in your project
- Tracks functions, classes, exports, imports
- Builds a dependency graph
- Enables `/search` and `/file` commands

**When to use:**
- First time working on a project
- After major code changes
- Before starting a complex task

---

### `/search <query>`
Search indexed code.

**Examples:**
```
/search authenticate
/search Database
/search User
/search config
```

**When to use:** After running `/index`, to quickly find files/symbols related to your query.

---

### `/file <path>`
Get detailed info about a specific file.

**Examples:**
```
/file src/auth/login.ts
/file components/Button.tsx
/file lib/db.ts
```

**Shows:**
- Language
- Line count
- Imports
- Exports (functions, classes, types)

---

### `/context`
View project context and decisions.

**Shows:**
- Project name and path
- Recent architectural decisions
- Learned patterns
- Tech stack

**When to use:** To see what the bot knows about your current project.

---

### `/task <description> [--bg]`
Create a new background task.

**Examples:**
```
/task Review all TypeScript files --bg
/task Write tests for auth module
/task Update README documentation
/task Refactor user service
```

**When to use:** For long-running tasks you want to happen in the background while you continue working.

---

### `/tasks`
List all active tasks.

**Shows:** All pending, in-progress, and completed background tasks.

---

### `/agent <type> <task>`
Run a specialized agent for specific work.

**Examples:**
```
/agent scout Find all API endpoints
/agent builder Create a REST API for users
/agent reviewer Check for security issues
/agent tester Write unit tests for auth
/agent deployer Deploy to staging environment
```

**Available Agents:**
| Agent | Purpose |
|-------|---------|
| `scout` | Explores codebase, finds patterns |
| `builder` | Writes and implements code |
| `reviewer` | Reviews code for bugs/issues |
| `tester` | Writes and runs tests |
| `deployer` | Handles deployments |

---

### `/agents`
Show running agents.

**When to use:** Check what specialized agents are currently active.

---

### `/git <command>`
Git operations with AI assistance.

**Examples:**
```
/git commit   → Auto-generate commit message and commit
/git status   → Show git status
/git log      → Show recent commits
/git pr       → Generate pull request description
```

**When to use:** After finishing work, before pushing changes.

---

### `/metrics`
Show today's performance metrics.

**Shows:**
- Tasks completed/failed
- Claude queries made
- Files modified
- Lines of code changed
- Active projects
- Bot uptime

**When to use:** To see what you've accomplished today.

---

### `/profile`
View your profile and preferences.

**Shows:**
- Bot name and emoji
- Your username
- Timezone
- Communication style
- Preferred languages
- Git settings

---

### `/schedule "<cron>" <task>`
Schedule a recurring task with cron.

**Examples:**
```
/schedule "0 2 * * *" Run nightly backup
/schedule "0 */4 * * *" Check server health every 4 hours
/schedule "0 9 * * 1-5" Morning standup report weekdays
```

**Cron format:** `minute hour day month weekday`

| Field | Values |
|-------|--------|
| minute | 0-59 |
| hour | 0-23 |
| day | 1-31 |
| month | 1-12 |
| weekday | 0-6 (Sunday=0) |

**Examples:**
- `0 2 * * *` = 2:00 AM every day
- `*/30 * * * *` = Every 30 minutes
- `0 9 * * 1-5` = 9 AM, Monday-Friday

---

### `/schedules`
List all scheduled tasks.

---

### `/heartbeat`
Manually trigger a heartbeat check.

Shows alerts and runs proactive checks on your projects.

### `/briefing`
Generate the daily briefing manually.

Includes weather, recap, GitHub activity, Twitter digest, project ideas, and error summary.

### `/checks`
Run proactive checks manually.

Checks for unpushed commits, stuck tasks, and code quality alerts.

### `/selfreview`
View your learning log from the self-improvement system.

Shows recent mistakes logged by the AI and how it's learning from them.

---

## Typical Workflows

### Starting a New Project
```
1. /addproject C:\path\to\project
2. /select (choose the project)
3. /index (let it scan the codebase)
4. Start working: "Help me understand the authentication flow"
```

### After Making Important Decisions
```
/remember We implemented JWT with refresh tokens
/remember Frontend uses React, backend uses FastAPI
/remember All API responses follow {success, data, error} format
```

### Before Big Refactors
```
1. /task Analyze dependencies for refactor --bg
2. /agent scout Find all uses of the old API
3. Do the work
4. /git commit
```

### Daily Check-in
```
/status   → See what's active
/metrics  → See what you accomplished
/tasks    → Check background tasks
```

### When Stuck
```
/search <keyword>    → Find related code
/context             → See what's been decided
/recall <topic>      → Find what you remembered
```

---

## Command Reference Summary

| Category | Commands |
|----------|----------|
| **Core** | `/start`, `/projects`, `/select`, `/addproject`, `/rmproject`, `/rescan`, `/status`, `/cancel`, `/help` |
| **Memory** | `/remember`, `/recall`, `/context` |
| **Code Search** | `/index`, `/search`, `/file` |
| **Tasks** | `/task`, `/tasks`, `/agent`, `/agents` |
| **Git** | `/git commit`, `/git status`, `/git log`, `/git pr` |
| **Info** | `/metrics`, `/profile`, `/schedule`, `/schedules` |
| **Self-Improvement** | `/heartbeat`, `/briefing`, `/checks`, `/selfreview` |

---

## Tips

1. **Run `/index`** after major code changes to keep the search index fresh
2. **Use `/remember`** for decisions you'll want to reference later
3. **Use `--bg`** with `/task` for long-running operations
4. **Use `/agent scout`** to explore unfamiliar codebases
5. **Use `/git commit`** for smart, descriptive commit messages

---

For issues or questions, check the project repository or run `/help` in the bot.
