# Claude Bridge Native CLI - Usage Guide

Complete guide to commands, workflows, and autonomous AI features with real conversation examples.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Complete Command Reference](#complete-command-reference)
3. [Real Conversation Flows](#real-conversation-flows)
4. [Permission Levels](#permission-levels)
5. [Brain System Components](#brain-system-components)

---

## Quick Start

### First-Time Setup

```
/start                    # Initialize the bot
/profile                  # View/edit your profile
```

### Basic Daily Usage

```
/status                   # Check current project status
/context                  # See active context
/tasks                    # View queued tasks
```

---

## Complete Command Reference

### Core Commands

| Command | Usage | Description |
|---------|-------|-------------|
| `/start` | `/start` | Initialize bot, create brain |
| `/help` | `/help` | Show all available commands |
| `/cancel` | `/cancel` | Cancel current operation |

### Project Management

| Command | Usage | Description |
|---------|-------|-------------|
| `/projects` | `/projects` | List all projects |
| `/select` | `/select` | Set active project (inline keyboard) |
| `/addproject <path>` | `/addproject C:\Projects\my-app` | Add a new project |
| `/rmproject <name>` | `/rmproject old-project` | Remove a project |
| `/rescan` | `/rescan` | Re-index project files |
| `/status` | `/status` | Show active project status |

### Memory & Context

| Command | Usage | Description |
|---------|-------|-------------|
| `/remember <key> <value>` | `/remember api-key Use sk-1234 for dev` | Store a fact |
| `/recall <query>` | `/recall api-key` | Retrieve a fact |
| `/context` | `/context` | Show active context summary |
| `/index [path]` | `/index` | Index project for search |
| `/search <query>` | `/search authentication function` | Semantic code search |
| `/file <path>` | `/file src/auth.ts` | Get file contents |
| `/semantic <query>` | `/semantic user login flow` | Semantic memory search |

### Task & Agent System

| Command | Usage | Description |
|---------|-------|-------------|
| `/task <description> [--bg]` | `/task Fix auth bug --bg` | Queue a new task |
| `/tasks` | `/tasks` | List all tasks |
| `/agent <type> <prompt>` | `/agent scout Analyze auth module` | Delegate to specialist agent |
| `/agents` | `/agents` | List available agents |
| `/git <command>` | `/git commit` | Execute git smart commands |

### Autonomous AI Features

| Command | Usage | Description |
|---------|-------|-------------|
| `/intentions [filter]` | `/intentions active` | View active intentions |
| `/decisions [filter]` | `/decisions today` | View recent AI decisions |
| `/goals [action]` | `/goals list` | Manage goals |
| `/autonomous [status]` | `/autonomous on` | View/set autonomous mode |
| `/permissions [level]` | `/permissions autonomous` | View/set permission level |
| `/approve <id>` | `/approve decision-123` | Approve a pending action |
| `/deny <id> [reason]` | `/deny decision-123 Too risky` | Deny a pending action |

### Self-Improvement

| Command | Usage | Description |
|---------|-------|-------------|
| `/metrics` | `/metrics` | View performance metrics |
| `/profile [action]` | `/profile edit` | Manage agent profile |
| `/schedule "<cron>" <task>` | `/schedule "0 9 * * *" Daily report` | Schedule a task |
| `/schedules` | `/schedules` | List scheduled tasks |
| `/watch [project]` | `/watch` | Toggle test watching |
| `/notifications [action]` | `/notifications quiet` | Manage notifications |
| `/analyze [project]` | `/analyze` | Analyze code quality |
| `/learn` | `/learn` | View learned patterns |

### Self-Improvement Commands

| Command | Usage | Description |
|---------|-------|-------------|
| `/heartbeat` | `/heartbeat` | System health check |
| `/briefing` | `/briefing` | Get daily briefing |
| `/checks` | `/checks` | Run self-checks |
| `/selfreview` | `/selfreview` | Trigger self-review |

### System & Persistence Commands

| Command | Usage | Description |
|---------|-------|-------------|
| `/logs [type] [lines]` | `/logs error 50` | View system logs |
| `/state` | `/state` | View persistence state |
| `/recovery` | `/recovery` | View crash recovery info |
| `/export [format]` | `/export csv` | Export system data |

---

## Real Conversation Flows

### Flow 1: First-Time User Setup

```
User:  /start

Bot:   🤖 Welcome to Claude Bridge!

       Let's set up your profile. First, what should I call you?

       [Reply with your name]

---

User:  Ernest

Bot:   Nice to meet you, Ernest! 🎉

       Your profile has been created.
       Bot name: Claude
       Your timezone: UTC (auto-detected)

       Next, add a project to get started:
       /addproject /path/to/your/project

---

User:  /addproject C:\Users\Ernest\Projects\my-react-app

Bot:   ✅ Project added: my-react-app

       Detected: React, TypeScript, Node.js
       Git repository: Yes
       Branch: main

       Use /select to start working on this project.

---

User:  /select

Bot:   📁 Select a project:

       [1] my-react-app (React • TypeScript • main)
       [2] + Add another project

       [User taps button 1]

---

Bot:   ✅ Selected: my-react-app

       Ready! Send me a message to start working.
       Example: "Explain the authentication flow"
```

---

### Flow 2: Daily Development Routine

```
User:  /briefing

Bot:   📋 Good Morning, Ernest!

       📊 Yesterday's Summary:
       • 3 tasks completed
       • 12 files modified
       • 234 lines of code changed
       • 2 agents deployed

       🌤️ Weather: 72°F, Sunny

       📌 Pending:
       • 1 approval requested
       • 2 background tasks running

       🎯 Goals Progress:
       • test-coverage: 87% → 90% (in progress)

---

User:  /decisions

Bot:   📊 Recent Decisions (5):

       [1] decision-abc123
           Type: test_healing
           Action: Fixed flaky test in auth.spec.ts
           Status: completed
           Risk: low

       [2] decision-def456
           Type: dependency_update
           Action: Update react to 18.3.0
           Status: pending_approval
           Risk: medium

       [3] decision-ghi789
           Type: refactoring
           Action: Simplify UserService
           Status: approved
           Risk: low

---

User:  /approve decision-def456

Bot:   ✅ Decision approved: decision-def456

       Updating react to 18.3.0...
       Running npm install...
       Tests passed ✓

       Changes committed: Update react to 18.3.0

---

User:  /tasks

Bot:   📋 Active Tasks (3):

       • task-001 Review PR #42
       • task-002 Fix navigation bug
       • task-003 Update documentation

       Send a task description to create a new one.

---

User:  /task "Add dark mode toggle" --bg

Bot:   ✅ Task created (background): Add dark mode toggle

       Use /tasks to check progress.
```

---

### Flow 3: Enabling Autonomous Features

```
User:  /permissions

Bot:   🔐 Permission Level: advisory

       Current Settings:
       • Auto-approve: None
       • Requires approval: Code changes, deployments
       • Can execute: Read operations, suggestions

       Available Levels:
       • read_only - View only
       • advisory - Suggest, don't act
       • supervised - Act with approval
       • autonomous - Low-risk auto-approved
       • full - No restrictions

       Change with: /permissions <level>

---

User:  /permissions supervised

Bot:   ✅ Permission level updated: supervised

       The AI can now:
       • Execute low-risk actions automatically
       • Request approval for medium/high-risk actions
       • Fix tests without asking
       • Update non-breaking dependencies

       Requires approval for:
       • Code refactoring
       • API changes
       • Deployments

---

User:  /autonomous on

Bot:   🤖 Autonomous mode enabled

       The AI will now:
       • Proactively detect improvement opportunities
       • Suggest actions based on your goals
       • Work toward objectives without prompts

       Current goals: 1 active
       Use /goals to manage them.

---

User:  /intentions

Bot:   💭 Active Intentions (4):

       [1] intention-001
           Type: improvement
           Priority: high
           Title: Increase test coverage
           Status: active

       [2] intention-002
           Type: maintenance
           Priority: medium
           Title: Update outdated dependencies
           Status: waiting_approval

       [3] intention-003
           Type: refactoring
           Priority: low
           Title: Simplify auth flow
           Status: scheduled
```

---

### Flow 4: Bug Fix Workflow

```
User:  /status

Bot:   📊 Current Status

       Project: my-react-app
       Branch: feature/user-settings
       Session: 23 messages

       Claude Process: Idle
       Background Tasks: 1 running

---

User:  I'm getting an error when users try to change their password.

Bot:   🔍 I'll help you debug this.

       [Claude analyzes code...]

       Found the issue! In src/auth/password.ts:
       - Line 45: Missing await on validatePassword()
       - This causes the promise to not resolve

       Would you like me to fix it?

---

User:  Yes, fix it

Bot:   ✏️ Editing: src/auth/password.ts

       - Line 45: const result = validatePassword(password)
       + Line 45: const result = await validatePassword(password)

       File edited successfully.

       Want me to run the tests?

---

User:  Yes

Bot:   🧪 Running tests...

       PASS src/auth/password.spec.ts (3 tests)
       PASS src/auth/auth.spec.ts (5 tests)

       All tests passed! ✅

       Suggested commit message:
       fix(auth): await password validation

       Use /git commit to commit this fix.

---

User:  /git commit

Bot:   📝 Committing changes...

       Staged files:
       • src/auth/password.ts

       Commit: fix(auth): await password validation

       Push to remote? (y/n)

---

User:  y

Bot:   ✅ Changes pushed to origin/feature/user-settings

       View PR: https://github.com/user/repo/pull/42
```

---

### Flow 5: Learning and Memory

```
User:  /remember architecture We use microservices with REST APIs

Bot:   💾 Saved: architecture

       "We use microservices with REST APIs"

---

User:  /remember db Use PostgreSQL for all user data

Bot:   💾 Saved: db

       "Use PostgreSQL for all user data"

---

User:  /remember pattern Always use Zod for validation

Bot:   💾 Saved: pattern

       "Always use Zod for validation"

---

User:  /context

Bot:   📚 Project Context: my-react-app

       Architecture:
       • We use microservices with REST APIs

       Database:
       • Use PostgreSQL for all user data

       Patterns:
       • Always use Zod for validation

       Tech Stack:
       • React, TypeScript, Node.js
       • Vite, Vitest, Tailwind CSS

---

User:  /recall db

Bot:   🔍 Found 1 memory:

       key: db
       value: "Use PostgreSQL for all user data"
       saved: 2 days ago

---

User:  /semantic database schema

Bot:   🔍 Semantic Search Results:

       1. "Use PostgreSQL for all user data" (94% match)
       2. "Schema: users(id, email, created_at)" (87% match)
       3. "Migration: add_user_preferences.sql" (72% match)
```

---

### Flow 6: Using Agents

```
User:  /agents

Bot:   🤖 Available Agents:

       Agent       | Status | Description
       ------------|--------|---------------------------
       scout       | Idle   | Explores and analyzes code
       builder     | Idle   | Writes and implements code
       reviewer    | Idle   | Reviews for bugs/issues
       tester      | Idle   | Creates and runs tests
       deployer    | Idle   | Handles deployments

---

User:  /agent scout Find all API endpoints in the auth module

Bot:   🤖 Agent: scout

       Task: Find all API endpoints in the auth module

       [Scanning codebase...]

       Found 8 endpoints in src/auth/api/:

       POST   /api/auth/login
       POST   /api/auth/logout
       POST   /api/auth/register
       POST   /api/auth/refresh
       GET    /api/auth/me
       PUT    /api/auth/profile
       POST   /api/auth/change-password
       POST   /api/auth/forgot-password

       Middlewares used:
       • authenticate (7 endpoints)
       • validateRequest (all endpoints)
       • rateLimit (login, register)

       Complexity: Low
       Test coverage: 87%

---

User:  /agent reviewer Check the auth API for security issues

Bot:   🤖 Agent: reviewer

       Task: Check the auth API for security issues

       [Analyzing security...]

       ⚠️ Found 3 issues:

       1. MEDIUM: /api/auth/forgot-password lacks rate limiting
          Location: src/auth/api/forgot-password.ts:15
          Fix: Add rateLimit middleware

       2. LOW: Error messages reveal too much info
          Location: src/auth/api/login.ts:42
          Fix: Use generic error messages

       3. HIGH: refresh token not rotated
          Location: src/auth/api/refresh.ts:23
          Fix: Implement token rotation

       Create tasks to fix these?

---

User:  Yes

Bot:   ✅ Created 3 tasks:

       • task-004 Add rate limiting to forgot-password
       • task-005 Generic error messages for login
       • task-006 Implement refresh token rotation
```

---

### Flow 7: Code Search and Navigation

```
User:  /index

Bot:   📇 Indexing project: my-react-app

       Scanning files...
       • Found 234 TypeScript files
       • Found 45 test files
       • Found 12 config files

       Building dependency graph...
       Extracting symbols...
       Analyzing imports...

       ✅ Index complete!

       Files: 291
       Functions: 1,847
       Components: 156
       Tests: 312

---

User:  /search authentication

Bot:   🔍 Search Results: "authentication"

       Files (15):
       • src/auth/index.ts
       • src/auth/login.tsx
       • src/auth/register.tsx
       • src/auth/api/login.ts
       • src/auth/types.ts
       • src/auth/hooks/useAuth.ts
       • src/auth/providers/AuthProvider.tsx
       ...

       Functions (8):
       • authenticate() - src/auth/index.ts
       • login() - src/auth/api/login.ts
       • logout() - src/auth/api/logout.ts
       • useAuth() - src/auth/hooks/useAuth.ts
       ...

       Components (5):
       • LoginForm - src/auth/login.tsx
       • RegisterForm - src/auth/register.tsx
       • AuthProvider - src/auth/providers/AuthProvider.tsx
       ...

---

User:  /file src/auth/api/login.ts

Bot:   📄 src/auth/api/login.ts

       Language: TypeScript
       Lines: 78
       Complexity: Low (3)

       Imports:
       • { Request, Response } from 'express'
       • { bcryptCompare, generateToken } from './crypto'

       Exports:
       • async function login(req: Request, res: Response)

       Dependencies (used by):
       • src/auth/index.ts
       • src/auth/routes.ts

       [Preview first 20 lines]
       1  import { Request, Response } from 'express';
       2  import { bcryptCompare, generateToken } from './crypto';
       3  import { loginSchema } from './schemas';
       4  import { validateRequest } from '../middleware';
       5
       6  export async function login(req: Request, res: Response) {
       7    const { email, password } = req.body;
       8
       9    // Validate input
      10   const validation = loginSchema.safeParse(req.body);
       11   if (!validation.success) {
       12     return res.status(400).json({ error: 'Invalid input' });
       13   }
       14
       15   // Find user...
```

---

### Flow 8: Goals and Progress

```
User:  /goals

Bot:   🎯 Active Goals (2):

       [1] goal-001
           Title: Increase test coverage to 90%
           Type: quality
           Progress: 87% → 90% (+3% this week)
           Status: in_progress
           Tasks: 2 pending

       [2] goal-002
           Title: Reduce code complexity
           Type: refactor
           Progress: 5/12 files simplified
           Status: in_progress
           Tasks: 7 pending

       Use /goals create:<type> to add a new goal.

---

User:  /goals create:feature Add user settings page

Bot:   🎯 Creating Goal: Add user settings page

       Type: feature

       Please provide:
       1. Description (what should it do?)
       2. Target deadline (optional)
       3. Strategy (autonomous/supervised/manual)

---

User:  User can edit profile, change password, manage notifications. No deadline. Supervised.

Bot:   ✅ Goal created: goal-003

       Title: Add user settings page
       Type: feature
       Strategy: supervised
       Status: planning

       Tasks will be created and require approval before execution.

---

User:  /goals

Bot:   🎯 Active Goals (3):

       [1] goal-001
           Title: Increase test coverage to 90%
           Progress: 87% → 90%
           Status: in_progress

       [2] goal-002
           Title: Reduce code complexity
           Progress: 5/12 files
           Status: in_progress

       [3] goal-003
           Title: Add user settings page
           Status: planning
           Tasks pending: 4

       Summary: 3 goals, 13 total tasks
```

---

### Flow 9: Analyzing Code Quality

```
User:  /analyze

Bot:   🔍 Analyzing code quality...

       Running analysis...
       • Complexity scan: 234 files
       • Security scan: 234 files
       • Duplication scan: 234 files

       📊 Analysis Results:

       Complexity:
       • Average: 8.2 (target: <10)
       • High complexity files: 12
       • Worst: src/auth/password.ts (45)

       Security:
       • No critical issues
       • 3 medium severity issues
       • 8 low severity issues

       Duplication:
       • 4.2% duplicated code
       • 23 duplicate blocks found
       • Largest: 47 lines in src/utils/formatters.ts

       Test Coverage:
       • Overall: 87.3%
       • Uncovered files: 18

       Recommendations:
       1. Refactor src/auth/password.ts (complexity: 45)
       2. Add rate limiting to forgot-password endpoint
       3. Extract duplicate formatters to shared module

       Create tasks for these improvements?

---

User:  /learn

Bot:   📚 Learned Patterns:

       Naming Conventions:
       • Components: PascalCase (UserCard, NavBar)
       • Functions: camelCase (getUserData, validateInput)
       • Constants: UPPER_SNAKE_CASE (API_URL, MAX_RETRIES)

       Code Patterns:
       • Async functions use try-catch-error pattern
       • All API calls wrapped in apiClient wrapper
       • Forms use react-hook-form with Zod validation
       • State: Zustand for global, useState for local

       Library Usage:
       • Styling: Tailwind CSS (95% of components)
       • HTTP: fetch wrapper (apiClient)
       • Validation: Zod schemas in /schemas
       • Testing: Vitest + Testing Library

       These patterns are used for consistency in generated code.
```

---

### Flow 10: Managing Notifications

```
User:  /notifications

Bot:   🔔 Notification Settings

       Current: All notifications enabled

       Quiet Hours: 22:00 - 08:00
       Weekend: Enabled

       Types:
       • Task completed: ✅ On
       • Test failures: ✅ On
       • Security alerts: ✅ On
       • Deployment updates: ✅ On
       • Daily briefing: ✅ On (09:00)

       Options:
       /notifications quiet    - Enable quiet hours
       /notifications loud     - Disable quiet hours
       /notifications off      - Turn off all
       /notifications on       - Turn on all

---

User:  /notifications quiet

Bot:   🔔 Quiet hours enabled

       You will not receive notifications between:
       10:00 PM - 8:00 AM

       Critical alerts (security, deployment failures) will still come through.
```

---

### Flow 11: Test Watching

```
User:  /watch

Bot:   👁️ Test Watch Status: Enabled

       Watching: my-react-app

       Last run: 5 minutes ago
       Result: 312 passed, 0 failed

       On failure, I will:
       1. Analyze the failure
       2. Attempt to fix it
       3. Request approval if risky

       Options:
       /watch off      - Stop watching
       /watch now      - Run tests now

---

[Some time later, a test fails]

Bot:   ❌ Test Failure Detected!

       Test: src/auth/password.spec.ts
       Suite: validatePassword
       Error: Expected true, got false

       🤖 Attempting auto-fix...

       Issue: Test expects error for weak password
       Fix: Update validation to check password strength

       Changes: 1 file, 3 lines

       Approve this fix? Use /approve to apply.

---

User:  /approve

Bot:   ✅ Fix applied!

       Running tests...
       312 passed, 0 failed ✅

       Commit message ready: fix(test): strengthen password validation
```

---

### Flow 12: Scheduling Tasks

```
User:  /schedule "0 9 * * *" Send daily summary

Bot:   ⏰ Task Scheduled

       Cron: 0 9 * * * (Daily at 9:00 AM)
       Task: Send daily summary

       Next run: Tomorrow at 9:00 AM

---

User:  /schedules

Bot:   📅 Scheduled Tasks (2):

       [1] Daily at 09:00
           Task: Send daily summary
           Next: Tomorrow at 9:00 AM

       [2] Weekly on Monday 08:00
           Task: Run full code analysis
           Next: Monday at 8:00 AM

       Use /schedule to add more.
```

---

### Flow 13: Full Autonomous Workflow

```
User:  /autonomous on

Bot:   🤖 Autonomous mode enabled

       The AI will now:
       • Detect improvement opportunities
       • Fix test failures automatically
       • Update safe dependencies
       • Work toward your goals

       Permission level: supervised
       (High-risk actions will require approval)

---

[AI detects an opportunity]

Bot:   💡 Opportunity Detected!

       Type: dependency_update
       Package: eslint (8.45.0 → 8.50.0)
       Risk: low
       Breaking changes: None

       This update includes bug fixes and improvements.

       Approve? /approve opp-001

---

User:  /approve opp-001

Bot:   ✅ Applying update...

       npm install eslint@8.50.0
       Updated 1 package
       Running tests... ✅

       Change committed: chore: update eslint to 8.50.0

---

[AI detects test failure]

Bot:   ❌ Test Failure Detected!

       File: src/utils/date.spec.ts
       Test: formatDateTime
       Error: Expected "2024-01-01" got "2024/01/01"

       🤖 Auto-fixing...

       Issue: Date format mismatch
       Fix: Update format string

       Approve? /approve fix-001

---

User:  /approve fix-001

Bot:   ✅ Fix applied!

       Running tests...
       313 passed, 0 failed ✅

---

[AI works toward goal]

Bot:   🎯 Working on goal: Increase test coverage

       Detected: src/components/Avatar.tsx has no tests
       Action: Generate tests for Avatar component

       Generated: src/components/Avatar.spec.ts
       Coverage: +4.2%

       Progress: 87% → 91.2% ✅ Goal reached!

---

User:  /decisions

Bot:   📋 Recent Decisions (7):

       [✅] decision-001 - Updated eslint to 8.50.0
       [✅] decision-002 - Fixed date formatting test
       [✅] decision-003 - Generated Avatar tests
       [⏳] decision-004 - Refactored UserService (pending approval)
       [❌] decision-005 - API update denied (too risky)
       [✅] decision-006 - Fixed linting errors
       [✅] decision-007 - Updated dependencies

       Summary: 5 approved, 1 denied, 1 pending
```

---

### Flow 14: Checking System State and Logs

```
User:  /state

Bot:   💾 System State

       📊 Checkpoints:
       • Last: 2 minutes ago
       • Total: 1,247 checkpoints
       • Size: 12.4 MB

       🗄️ Database:
       • Sessions: 3 active
       • Tasks: 127 total (8 pending, 2 running)
       • Decisions: 45 total (3 pending)

       📈 Today's Metrics:
       • Tasks completed: 12
       • Claude queries: 34
       • Files modified: 23
       • Lines changed: 456

       ⏱️ Uptime: 3 days, 4 hours

---

User:  /logs error

Bot:   📋 Error Logs (last 50)

       [2024-01-15 14:32:15] ERROR Failed to connect to database: Connection timeout
       [2024-01-15 12:08:43] ERROR Agent task failed: TypeError - Cannot read property 'id'
       [2024-01-15 09:15:22] ERROR File not found: src/missing/file.ts
       [2024-01-14 23:45:01] ERROR Git command failed: merge conflict in package.json

       Use /logs app for all logs or /logs audit for audit trail.

---

User:  /logs audit 20

Bot:   📋 Audit Logs (last 20)

       [2024-01-15 15:20:33] AUDIT user:ernest action:file_edit file:src/auth.ts
       [2024-01-15 15:18:12] AUDIT user:ernest action:task_create task:Fix login bug
       [2024-01-15 15:10:05] AUDIT user:ernest action:decision_approve id:decision-123
       [2024-01-15 14:55:44] AUDIT user:ernest action:agent_deploy type:tester
       [2024-01-15 14:30:00] AUDIT system:auto action:test_heal file:src/date.spec.ts
       ...

---

User:  /recovery

Bot:   🔄 Recovery Information

       Last Shutdown: Clean ✅

       Last Heartbeat:
       • Timestamp: 10 seconds ago
       • PID: 12345
       • Uptime: 3 days, 4 hours
       • Status: running

       Active Sessions: 3
       Active Tasks: 10

       Recent Crashes: None

       The system is running normally. No recovery actions needed.

---

[Bot crashes unexpectedly and restarts]

Bot:   🔄 Recovery Manager

       ⚠️ Unclean Shutdown Detected!

       Previous Run:
       • PID: 12345
       • Uptime: 3 days, 4 hours
       • Crash reason: Heartbeat timeout

       Recovery Actions:
       ✅ Restored 3 active sessions
       ✅ Restarted 2 background tasks
       ✅ Loaded metrics from checkpoint

       Crash report saved: brain/recovery/crash-2024-01-15-16-30.json

       Use /recovery for details.

---

User:  /export

Bot:   📤 Exporting data...

       Generated export: brain/exports/export-2024-01-15.json

       Contents:
       • Sessions: 3
       • Tasks: 127
       • Decisions: 45
       • Metrics: 30 days
       • Memory items: 89

       File size: 2.3 MB
```

---

## Permission Levels

| Level | Description | Auto-Approve | Requires Approval |
|-------|-------------|--------------|-------------------|
| `read_only` | View only, no actions | None | All actions |
| `advisory` | Suggests, doesn't act | None | All actions |
| `supervised` | Acts with approval | Tests, low-risk fixes | Code changes, refactors |
| `autonomous` | Low-risk auto-approved | Low-risk actions | High-risk, deployments |
| `full` | No restrictions | All actions | None |

### Risk Levels

| Risk | Examples |
|------|----------|
| `none` | Read operations, context queries |
| `low` | Test fixes, formatting, linting |
| `medium` | Refactoring, dependency updates |
| `high` | API changes, database changes |
| `critical` | Deployments, destructive operations |

---

## Brain System Components

| Component | Purpose |
|-----------|---------|
| Identity Manager | Agent personality and user preferences |
| Memory Store | Persistent key-value storage |
| Vector Store | Semantic search with embeddings |
| Context Indexer | Project file tracking |
| Task Queue | Task management and execution |
| Agent Orchestrator | Specialist agent coordination |
| Git Automation | Smart git operations |
| Test Watcher | Test monitoring and failure detection |
| Notification Router | Alert management |
| Code Analyzer | Complexity, security, duplication |
| Pattern Learner | Learn coding patterns |
| Outcome Tracker | Track action results for learning |
| Intention Engine | Track and prioritize AI intentions |
| Decision Maker | Autonomous decision logic |
| Context Tracker | Project trends and opportunities |
| Goal System | Long-term objective tracking |
| Permission Manager | Access control per user/project |
| Rollback Manager | Revert autonomous actions |
| Opportunity Detector | Continuous improvement scanning |
| Approval Workflow | Interactive approval system |
| User Feedback Manager | Collect and analyze feedback |
| Transparency Tracker | Log all autonomous actions |
| Morning Briefing | Daily summaries |
| Feature Workflow | Feature implementation pipeline |
| Refactoring Agent | Autonomous refactoring |
| Dependency Manager | Dependency updates |
| Test Healer | Automatic test failure fixes |

---

## Tips & Best Practices

1. **Start Conservative**: Begin with `advisory` mode, gradually increase autonomy
2. **Review Decisions**: Check `/decisions` regularly to understand AI behavior
3. **Set Clear Goals**: Use `/goals` to guide autonomous work
4. **Provide Feedback**: Use `/approve` and `/deny` to teach the AI
5. **Monitor Metrics**: Review `/metrics` to track improvement over time
6. **Use Briefing**: Check `/briefing` daily for summaries
7. **Keep Context Updated**: Use `/remember` for important facts
8. **Index After Changes**: Run `/index` after major code changes
9. **Watch Tests**: Enable `/watch` for automatic test healing
10. **Set Permissions**: Use `/permissions` to control autonomy

---

## All Commands Quick List

```
Core:           /start, /help, /projects, /select, /addproject, /rmproject, /rescan, /status, /cancel
Memory:         /remember, /recall, /context, /semantic
Search:         /index, /search, /file
Tasks:          /task, /tasks, /agent, /agents
Git:            /git
Info:           /metrics, /profile, /schedule, /schedules
Self-Improvement: /watch, /notifications, /analyze, /learn, /heartbeat, /briefing, /checks, /selfreview
System:         /logs, /state, /recovery, /export
Autonomous:     /intentions, /decisions, /goals, /autonomous, /permissions, /approve, /deny
```
