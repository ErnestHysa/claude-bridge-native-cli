# Claude Bridge Native CLI

A Telegram bot that bridges Claude Code CLI with Telegram messaging, allowing you to interact with Claude through your mobile device.

## Features

- **Full Claude Code CLI Access**: Interact with Claude through Telegram messages
- **Project Management**: Auto-scan and manage multiple projects
- **Session Management**: Per-chat session state with conversation history
- **Git Integration**: See branch and status for Git repositories
- **File Edit Approval**: Configurable approval for dangerous operations
- **Graceful Shutdown**: Proper cleanup of active processes

## Brain System - AI-Powered Development Assistant

This project has evolved into a sophisticated AI development assistant with a comprehensive brain system that provides:

### Core Brain Features

- **Persistent Memory Store**: Store and retrieve facts, decisions, and patterns across sessions with semantic search
- **Vector Store**: Embedding-based semantic search for context-aware memory retrieval
- **Multi-Agent System**: Coordinate specialized AI agents (Scout, Builder, Reviewer, Tester, Deployer)
- **Task Queue**: Create and manage background tasks with priority scheduling and parallel execution
- **Context Indexer**: Automatically index and understand project structure
- **Git Automation**: Smart commits, PR management, and deployment operations
- **Identity Management**: Customizable agent personality and user preferences
- **Setup Wizard**: Interactive first-time setup for personalized experience
- **Streaming Output**: Real-time Claude responses streamed to Telegram
- **Flexible Timeout**: Configure Claude process timeout (0 = unlimited)

### Advanced Brain Capabilities

- **Code Analyzer**: Complexity analysis, security scanning, duplication detection
- **Pattern Learner**: Automatic detection of coding patterns and conventions
- **Notification Router**: Priority-based notification routing with quiet hours
- **Background Workers**: Heartbeat monitoring, daily briefings, proactive checks
- **Project Context Tracking**: Per-project memory and context isolation
- **Session Persistence**: All sessions survive restarts with full state restoration
- **Self-Improvement System**: Continuous learning from interactions and outcomes

### Autonomous AI Vision

The brain system is designed to evolve into a fully autonomous AI assistant that can:
- Initiate actions proactively based on events, time, and patterns
- Self-heal by fixing test failures and managing dependencies
- Work toward user-defined goals with transparency
- Learn from every interaction to improve over time

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

#### Memory & Context Commands
- `/remember <key> <value>` - Store information in persistent memory
- `/recall <query>` - Search and retrieve from memory
- `/semantic <query>` - Semantic memory search using embeddings
- `/context` - View current project context and structure
- `/index <path>` - Index project for context awareness
- `/search <query>` - Search indexed code
- `/file <path>` - Get detailed info about a specific file

#### Task Management Commands
- `/task <description> [--bg]` - Create a background task
- `/tasks` - List all active and queued tasks
- `/schedule "<cron>" <task>` - Schedule a recurring task
- `/schedules` - List all scheduled tasks

#### Agent Commands
- `/agent <type> <prompt>` - Run a specific agent
- `/agents` - Show running agents and their status

**Available Agent Types:**
- `scout` - Explores codebase, finds patterns, analyzes architecture
- `builder` - Writes code, implements features, refactors code
- `reviewer` - Reviews for bugs, security issues, best practices
- `tester` - Runs tests, analyzes coverage, generates test data
- `deployer` - Handles deployments, rollbacks, CI/CD operations

#### Git Commands
- `/git commit` - Smart commit with auto-generated message
- `/git status` - Show git status
- `/git log` - Show recent commits
- `/git pr` - Generate pull request description

#### Information Commands
- `/metrics` - Show performance metrics and statistics
- `/profile` - View your profile and preferences

#### Self-Improvement Commands
- `/heartbeat` - Manually trigger a heartbeat check
- `/briefing` - Generate the daily briefing
- `/checks` - Run proactive checks
- `/selfreview` - View learning log from self-improvement system

### Workflow

1. Use `/start` to initialize your session (first-time users will go through setup wizard)
2. Use `/select` to choose a project
3. Send your prompt as a regular message
4. Claude processes and responds with streaming output
5. File edits may require approval (configurable)

#### Advanced Workflows with Brain System

**Starting a New Project:**
```
1. /addproject C:\path\to\project
2. /select (choose the project)
3. /index (let it scan the codebase)
4. Start working: "Help me understand the authentication flow"
```

**After Making Important Decisions:**
```
/remember We implemented JWT with refresh tokens
/remember Frontend uses React, backend uses FastAPI
/remember All API responses follow {success, data, error} format
```

**Before Big Refactors:**
```
1. /task Analyze dependencies for refactor --bg
2. /agent scout Find all uses of the old API
3. Do the work
4. /git commit
```

**Daily Productivity:**
```
/status   → See what's active
/metrics  → See what you accomplished
/tasks    → Check background tasks
/briefing → Get daily briefing with weather and activity
```

**When Stuck:**
```
/search <keyword>    → Find related code
/context             → See what's been decided
/recall <topic>      → Find what you remembered
/semantic <query>    → Semantic search through memory
```

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
├── identity/              # Agent identity, personality, and user preferences
│   ├── profile.json       # User profile (name, timezone, etc)
│   ├── personality.json   # Bot personality settings
│   └── preferences.json   # User preferences and settings
├── memory/                # Persistent memory store
│   ├── knowledge/         # Stored facts and decisions
│   └── vector-store.ts    # Embedding-based semantic search
├── sessions/              # Persistent chat sessions
├── projects/              # Project-specific context and tracking
├── heartbeats/            # System health monitoring data
├── learning/              # Pattern learning and improvement data
├── notifications/         # Notification routing and preferences
├── analyzer/              # Code analysis tools and results
├── scripts/               # Background workers and automation
├── errors/                # Error tracking and analysis
└── *.md                   # Various documentation and plans
```

### Agent Types

The brain system includes several specialized agent types:

- **Scout**: Explores codebases, finds patterns, analyzes architecture, and creates project maps
- **Builder**: Writes code, implements features, refactors code, and applies patterns
- **Reviewer**: Reviews code for bugs, security issues, and best practices
- **Tester**: Creates tests, runs test suites, analyzes coverage, and generates test data
- **Deployer**: Handles deployments, rollbacks, and CI/CD operations

### Multi-Agent Orchestration

The Agent Orchestrator coordinates multiple agents to work on complex tasks:

- **Workflow Chains**: Agents can work in dependency chains
- **Parallel Processing**: Multiple agents can run simultaneously
- **Intelligent Task Assignment**: Routes tasks to the most appropriate agent
- **Memory Integration**: All agents share persistent memory and learned patterns

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

### Completed ✅
- [x] Multi-agent system with specialized agents
- [x] Persistent memory with semantic search
- [x] Git automation with smart commits
- [x] Task queue with background processing
- [x] Context indexer for code understanding
- [x] Identity management and setup wizard
- [x] Code analyzer with complexity scoring
- [x] Pattern learning system
- [x] Notification routing with priorities
- [x] Background workers and automation

### In Progress 🚧
- [ ] Enhanced autonomous AI capabilities
- [ ] Self-healing test failure recovery
- [ ] Proactive dependency management

### Planned 📋
- [ ] Multi-user support with isolated brain instances
- [ ] Plugin system for custom agent types
- [ ] Web dashboard for brain system visualization
- [ ] Integration with external memory services (Redis, SQLite)
- [ ] Advanced workflow orchestration with dependencies
- [ ] Real-time collaboration features
- [ ] Voice input/output support
- [ ] Integration with more Git providers
- [ ] Custom agent training on user codebase

See `brain/AUTONOMOUS_AI_PLAN.md` for the detailed vision of the autonomous AI system.

## Additional Documentation

- **[GUIDE.md](GUIDE.md)** - Comprehensive command reference and usage guide with detailed examples
- **[brain/AUTONOMOUS_AI_PLAN.md](brain/AUTONOMOUS_AI_PLAN.md)** - Vision for autonomous AI capabilities
- **[brain/HEARTBEAT.md](brain/HEARTBEAT.md)** - Heartbeat monitoring system documentation
- **[brain/MORNING-BRIEFING.md](brain/MORNING-BRIEFING.md)** - Daily briefing system documentation
- **[brain/PROACTIVE-CHECKS.md](brain/PROACTIVE-CHECKS.md)** - Proactive monitoring system documentation

## Key Differentiators

What makes this project unique:

1. **Proactive Intelligence**: Unlike traditional bots, this system anticipates needs and can initiate actions
2. **Persistent Memory**: Remembers past decisions, patterns, and context across sessions
3. **Multi-Agent Coordination**: Multiple specialized AI agents work together on complex tasks
4. **Semantic Understanding**: Vector-based memory enables context-aware responses
5. **Autonomous Operations**: Can perform tasks without direct commands through scheduled tasks
6. **Continuous Learning**: Improves from every interaction through pattern learning
7. **Project Awareness**: Understands codebase structure through intelligent indexing
8. **Mobile Development**: Full Claude Code capabilities from your mobile device via Telegram

## License

MIT
