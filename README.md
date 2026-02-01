# Claude Bridge Native CLI

A Telegram bot that bridges Claude Code CLI with Telegram messaging, allowing you to interact with Claude through your mobile device.

## Features

- **Full Claude Code CLI Access**: Interact with Claude through Telegram messages
- **Project Management**: Auto-scan and manage multiple projects
- **Session Management**: Per-chat session state with conversation history
- **Git Integration**: See branch and status for Git repositories
- **File Edit Approval**: Configurable approval for dangerous operations
- **Graceful Shutdown**: Proper cleanup of active processes

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

- `/start` - Initialize the bot
- `/projects` - List all available projects
- `/select` - Select a project with inline keyboard
- `/addproject <path>` - Add a project by absolute path
- `/rmproject <name>` - Remove a project
- `/rescan` - Rescan the projects directory
- `/status` - Show current session info
- `/cancel` - Cancel current operation
- `/help` - Show help message

### Workflow

1. Use `/start` to initialize your session
2. Use `/select` to choose a project
3. Send your prompt as a regular message
4. Claude processes and responds
5. File edits may require approval (configurable)

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
| `CLAUDE_TIMEOUT_MS` | 300000 | Claude process timeout (5 min) |
| `SESSION_TIMEOUT_MS` | 3600000 | Session idle timeout (1 hour) |
| `MAX_CONCURRENT_SESSIONS` | 5 | Maximum concurrent sessions |
| `AUTO_APPROVE_SAFE_EDITS` | true | Auto-approve safe edits |
| `REQUIRE_APPROVAL_FOR_DELETES` | true | Require approval for deletes |
| `MASS_CHANGE_THRESHOLD` | 5 | Files count for "mass change" |
| `LOG_LEVEL` | `info` | Logging level |

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
- Increase `CLAUDE_TIMEOUT_MS` in `.env`
- Check Claude CLI is installed and accessible

### Projects not found
- Verify `PROJECTS_BASE` path exists
- Use `/rescan` to refresh project list

## License

MIT
