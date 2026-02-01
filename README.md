# Claude Bridge Native CLI

A Telegram bot that bridges Claude Code CLI with Telegram messaging, allowing you to interact with Claude through your mobile device.

## Features

- **Full Claude Code CLI Access**: Interact with Claude through Telegram messages
- **Project Management**: Auto-scan and manage multiple projects
- **Session Management**: Per-chat session state with conversation history
- **Git Integration**: See branch and status for Git repositories
- **File Edit Approval**: Configurable approval for dangerous operations
- **Graceful Shutdown**: Proper cleanup of active processes

### New Features - Brain System

- **Persistent Memory Store**: Store and retrieve facts, decisions, and patterns across sessions
- **Task Queue**: Create and manage background tasks with priority scheduling
- **Agent Orchestrator**: Coordinate multiple specialized agents for complex workflows
- **Context Indexer**: Automatically index and understand project structure
- **Git Automation**: Smart commits and PR management with conventional commits
- **Identity Management**: Customizable agent personality and user preferences
- **Setup Wizard**: Interactive first-time setup for personalized experience
- **Streaming Output**: Real-time Claude responses streamed to Telegram
- **Flexible Timeout**: Configure Claude process timeout (0 = unlimited)

## Setup

### Prerequisites

- Node.js 18+
- Claude Code CLI installed globally
- Telegram Bot Token (get from [@BotFather](https://t.me/botfather))

### Installation

1. Clone and install dependencies:
```bash
cd C:\Users\ErnestHome\DEVPROJECTS\claude-bridge-native-cli
npm install
```

2. Copy `.env.example` to `.env` and configure:
```bash
cp .env.example .env
```

3. Edit `.env` with your settings:
```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_BOT_USERNAME=your_bot_username_here
ALLOWED_USERS=ernest,username1,username2
ALLOWED_USER_IDS=123456789,987654321

PROJECTS_BASE=C:\Users\ErnestHome\DEVPROJECTS
```

### Development

```bash
npm run dev          # Run with tsx watch
npm run build        # Compile TypeScript
npm run start        # Run compiled output
npm run typecheck    # Type check only
npm run lint         # Lint code
```

## Usage

### Telegram Commands

#### Core Commands
- `/start` - Initialize the bot or begin setup wizard
- `/projects` - List all available projects
- `/select` - Select a project with inline keyboard
- `/addproject <path>` - Add a project by absolute path
- `/rmproject <name>` - Remove a project
- `/rescan` - Rescan the projects directory
- `/status` - Show current session info
- `/cancel` - Cancel current operation
- `/help` - Show help message

#### Brain System Commands
- `/remember <key> <value>` - Store information in persistent memory
- `/recall <query>` - Search and retrieve from memory
- `/context` - View current project context and structure
- `/task <type> <description>` - Create a background task
- `/tasks` - List all active and queued tasks
- `/agent <type> <prompt>` - Run a specific agent (orchestrator, scout, builder, reviewer, tester)
- `/agents` - Show running agents and their status
- `/git <command>` - Git operations (commit, pr, status, log)
- `/metrics` - Show performance metrics and statistics

### Workflow

1. Use `/start` to initialize your session (first-time users will go through setup wizard)
2. Use `/select` to choose a project
3. Send your prompt as a regular message
4. Claude processes and responds with streaming output
5. File edits may require approval (configurable)

#### Advanced Workflow with Brain System

1. **Store Context**: Use `/remember` to store project-specific decisions or patterns
2. **Create Tasks**: Use `/task` to queue background work (tests, scans, refactors)
3. **Run Agents**: Use `/agent` to delegate work to specialized agents
4. **Git Operations**: Use `/git commit` for smart commits or `/git pr` for PR creation
5. **Review Metrics**: Use `/metrics` to track productivity and system performance

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | - | Bot token from BotFather |
| `TELEGRAM_BOT_USERNAME` | - | Bot username |
| `ALLOWED_USER_IDS` | - | Comma-separated allowed user IDs |
| `PROJECTS_BASE` | `C:\Users\ErnestHome\DEVPROJECTS` | Base directory for projects |
| `AUTO_SCAN_INTERVAL_MS` | 300000 | Project rescan interval (5 min) |
| `CLAUDE_DEFAULT_MODEL` | `claude-3-5-sonnet` | Default Claude model |
| `CLAUDE_PERMISSION_MODE` | `acceptEdits` | Permission mode for file edits |
| `CLAUDE_TIMEOUT_MS` | 0 | Claude process timeout (0 = unlimited) |
| `SESSION_TIMEOUT_MS` | 3600000 | Session idle timeout (1 hour) |
| `MAX_CONCURRENT_SESSIONS` | 5 | Maximum concurrent sessions |
| `AUTO_APPROVE_SAFE_EDITS` | true | Auto-approve safe edits |
| `REQUIRE_APPROVAL_FOR_DELETES` | true | Require approval for deletes |
| `MASS_CHANGE_THRESHOLD` | 5 | Files count for "mass change" |
| `LOG_LEVEL` | `info` | Logging level |

### Brain System Configuration

The brain system stores data in the `./brain` directory with the following structure:

```
brain/
├── identity/         # Agent identity and personality
├── memory/           # Persistent memory store
├── logs/             # Conversation and activity logs
├── projects/         # Project-specific context
└── heartbeats/       # System metrics and health
```

### Agent Types

The brain system includes several specialized agent types:

- **Orchestrator**: Coordinates complex multi-step workflows
- **Scout**: Explores and analyzes codebases
- **Builder**: Writes and modifies code
- **Reviewer**: Reviews code for quality and issues
- **Tester**: Creates and runs tests
- **Deployer**: Handles deployment operations

## Architecture

```
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│  Telegram   │─────▶│  Bot Handler │─────▶│  Session    │
│     App     │      │              │      │  Manager    │
└─────────────┘      └──────────────┘      └─────────────┘
                            │                      │
                            ▼                      ▼
                     ┌──────────────┐      ┌─────────────┐
                     │   Project    │      │   Claude    │
                     │   Manager    │      │   Spawner   │
                     └──────────────┘      └─────────────┘
                            │                      │
                            └──────────┬───────────┘
                                       ▼
                                ┌─────────────┐
                                │ Claude Code │
                                │     CLI     │
                                └─────────────┘

                     Brain System Layer (New)
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   Memory    │  │   Tasks     │  │   Agents    │
│   Store     │  │   Queue     │  │Orchestrator │
└─────────────┘  └─────────────┘  └─────────────┘
       │                │                │
       └────────────────┴────────────────┘
                        │
                        ▼
                ┌─────────────┐
                │  Identity   │
                │  Manager    │
                └─────────────┘
```

## File Operations Approval

- **Read operations**: Auto-approved
- **Single file edits**: Auto-approved (configurable)
- **Delete operations**: Always require approval
- **Mass changes** (5+ files): Require approval

## Troubleshooting

### Bot doesn't respond
- Check `TELEGRAM_BOT_TOKEN` is correct
- Ensure user is in `ALLOWED_USERS` or `ALLOWED_USER_IDS`

### Claude process times out
- Set `CLAUDE_TIMEOUT_MS` to `0` for unlimited execution time
- Check Claude CLI is installed and accessible
- Verify project path is correct

### Projects not found
- Verify `PROJECTS_BASE` path exists
- Use `/rescan` to refresh project list

### Brain system not working
- Check that `./brain` directory is writable
- Ensure brain system initialized: `/start` command triggers initialization
- Review logs in `./brain/logs/` for errors

### Streaming output not working
- Verify `onOutput` callback is properly configured in spawner
- Check that Claude CLI supports streaming output format
- Review network connectivity to Telegram API

## Brain System API

The brain system provides a comprehensive API for building intelligent, persistent bot behavior.

### Memory Store

```typescript
import { getMemoryStore } from './brain/index.js';

const memory = getMemoryStore();

// Store a fact
await memory.setFact('project:architecture', 'microservices');

// Store a decision
await memory.setDecision({
  id: 'dec-001',
  title: 'Use TypeScript for backend',
  description: 'Chose TS for type safety',
  rationale: 'Reduces runtime errors'
});

// Search memory
const results = await memory.search('architecture');
```

### Task Queue

```typescript
import { getTaskQueue } from './brain/index.js';

const queue = getTaskQueue();

// Add a task
const taskId = await queue.addTask({
  type: 'code_refactor',
  title: 'Refactor auth module',
  description: 'Improve error handling',
  priority: 'medium',
  chatId: 123456
});

// Get task status
const task = await queue.getTask(taskId);
```

### Git Automation

```typescript
import { getGitAutomation } from './brain/index.js';

const git = getGitAutomation();

// Smart commit with auto-generated message
const result = await git.smartCommit(projectPath, {
  autoStage: true,
  conventionalCommits: true,
  push: false
});

// Create PR draft
const pr = await git.createPRDraft(projectPath, 'feature-branch');
```

### Identity Management

```typescript
import { getIdentityManager } from './brain/index.js';

const identity = getIdentityManager();

// Update agent personality
await identity.updatePersonality({
  communication: {
    style: 'concise',
    tone: 'professional',
    useEmojis: false,
    codeBlocks: true
  },
  coding: {
    languages: ['TypeScript', 'Python'],
    conventions: {
      quoteStyle: 'single',
      semicolons: true,
      trailingCommas: true,
      spacing: 2
    }
  }
});
```

## Development Roadmap

- [ ] Multi-user support with isolated brain instances
- [ ] Plugin system for custom agent types
- [ ] Web dashboard for brain system visualization
- [ ] Integration with external memory services (Redis, SQLite)
- [ ] Advanced workflow orchestration with dependencies
- [ ] Real-time collaboration features

## License

MIT
