# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

**Cron-Claude** - An MCP (Model Context Protocol) server that enables scheduled, automated execution of Claude tasks using Windows Task Scheduler. Define tasks in markdown files, schedule them with cron expressions, and let Claude run them automatically.

**Key Features:**
- 11 MCP tools for complete task lifecycle management
- Windows Task Scheduler integration for reliable execution
- CLI and API invocation modes
- Cryptographic audit logging with HMAC-SHA256 signatures
- Windows toast notifications
- Automatic log storage via memory integration

## Build & Development Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript (tsc) to dist/
npm run dev          # Watch mode (tsc --watch)
npm run mcp          # Run MCP server directly (for testing)
npm run prepack      # Build before publishing
```

## Architecture

**TypeScript ESM project** with NodeNext module resolution. Source in `src/`, compiles to `dist/`.

### MCP Server Entry Point

- **`src/mcp-server.ts`** → **`dist/mcp-server.js`** - Primary entry point
- Registered as `cron-claude-mcp` binary in package.json
- Uses `@modelcontextprotocol/sdk` with stdio transport
- Exposes 11 tools for task management
- Never uses `console.log()` (stdio protocol constraint), only `console.error()` for logging

### Source Module Responsibilities

#### Core Modules

- **`mcp-server.ts`** - MCP server implementation
  - Server initialization and transport setup
  - Tool registration (11 tools)
  - Request handlers for all cron operations
  - Task file management

- **`scheduler.ts`** - Windows Task Scheduler integration
  - Register/unregister tasks with Task Scheduler
  - Enable/disable tasks
  - Query task status and next run times
  - Uses PowerShell commands via Node.js `execSync`

- **`executor.ts`** - Task execution engine
  - Reads task definitions from markdown files
  - Executes via CLI (`claude-code`) or API (Anthropic API)
  - Manages execution lifecycle
  - Integrates with logger and notifier

- **`logger.ts`** - Audit logging with cryptographic signatures
  - HMAC-SHA256 signing of all log entries
  - Stores logs via memory integration (odsp-memory)
  - Fallback to local `./logs/` directory
  - Log verification functionality

- **`notifier.ts`** - Windows toast notifications
  - Shows completion notifications
  - Uses `node-notifier` package
  - Configurable per-task

- **`config.ts`** - Configuration management
  - Loads/saves config from `~/.cron-claude/config.json`
  - Manages secret key for HMAC signing
  - Auto-generates key on first use

- **`types.ts`** - Shared TypeScript types
  - `TaskDefinition`, `TaskMetadata`, `ExecutionLog`
  - `Config`, `NotificationOptions`

### Data Flow

1. **Task Storage**: `tasks/*.md` - Markdown files with YAML frontmatter
2. **Execution**: Task Scheduler → PowerShell → Node.js → `executeTask()`
3. **Logging**: Execution results → Logger → Memory integration or local files
4. **Notifications**: Completion → Notifier → Windows Toast

### Task Definition Format

```markdown
---
id: my-task
schedule: "0 9 * * *"
invocation: cli
notifications:
  toast: true
enabled: true
---

# Task Instructions

Instructions for Claude in markdown format...
```

### Dependencies

- **`@modelcontextprotocol/sdk`** - MCP protocol implementation
- **`gray-matter`** - YAML frontmatter parsing
- **`node-cron`** - Cron expression validation
- **`node-notifier`** - Windows toast notifications
- **`commander`** - CLI parsing (if needed)

## MCP Interface

### Tools (11 total)

**Task Management (6):**
1. `cron_create_task` - Create new task from template
2. `cron_register_task` - Register with Task Scheduler
3. `cron_unregister_task` - Remove from scheduler
4. `cron_enable_task` - Enable task
5. `cron_disable_task` - Disable task
6. `cron_get_task` - Get full task definition

**Execution & Monitoring (3):**
7. `cron_run_task` - Execute immediately
8. `cron_list_tasks` - List all tasks with status
9. `cron_view_logs` - View execution logs

**Verification & Status (2):**
10. `cron_verify_log` - Verify log HMAC signature
11. `cron_status` - System status and configuration

## Plugin Structure

This project is a Claude Code plugin (installed via `claude plugin add`):

- **`.claude-plugin/plugin.json`** - Plugin manifest with metadata
- **`.mcp.json`** - MCP server configuration (npx invocation)
- **`CLAUDE.md`** - This file (project documentation)
- **`skills/cron/SKILL.md`** - Skill documentation and usage
- **`commands/`** - Slash commands (`/cron-status`, `/cron-list`, `/cron-run`)
- **`hooks/`** - Event hooks (SessionStart for startup message)
- **`tasks/`** - Task definition files (*.md)

### SessionStart Hook Behavior

When a new session starts, the `hooks/session-start.sh` hook displays:
1. Welcome message about Cron-Claude availability
2. Quick command reference
3. Available tools list

This helps users discover cron functionality in new sessions.

## Task Categories & Use Cases

**Common Task Types:**
- **Daily summaries** - Morning briefings, calendar reviews
- **Weekly reports** - Aggregated metrics, status updates
- **Hourly monitors** - Health checks, status monitoring
- **Backups** - Periodic data archiving
- **Reminders** - Scheduled notifications

## Invocation Methods

**CLI Mode** (`invocation: cli`)
- Executes: `claude-code --file <task-file>`
- Full Claude environment with all tools
- Best for: Complex tasks requiring multiple tools
- Requires: Claude CLI installed and in PATH

**API Mode** (`invocation: api`)
- Direct Anthropic API calls
- Best for: Simple, contained tasks
- Requires: `ANTHROPIC_API_KEY` environment variable
- Note: May incur API costs

## Audit Logging & Security

**Log Structure:**
```markdown
---
taskId: task-id
executionId: uuid
timestamp: 2024-02-14T10:30:00Z
status: success|failure
signature: hmac-sha256-hex
---

# Execution Log

Log content...
```

**Signature Verification:**
- Uses secret key from `~/.cron-claude/config.json`
- HMAC-SHA256 of log content (excluding signature field)
- Verifiable with `cron_verify_log` tool

## Conventions

- All imports use `.js` extensions (ESM requirement with NodeNext)
- MCP server logs to stderr only (stdio protocol requirement)
- Tasks stored as `tasks/<task-id>.md`
- Windows Task Scheduler names: `CronClaude_<task-id>`
- Logs stored via odsp-memory with category `cron-task`

## Testing

**Manual Testing:**
```bash
npm run build
npm run mcp  # Run server directly
```

Then in another terminal, use the MCP Inspector:
```bash
npx @modelcontextprotocol/inspector node dist/mcp-server.js
```

**Integration Testing:**
1. Install plugin: `claude plugin add <path>`
2. Test tools via Claude Code
3. Verify Task Scheduler registration
4. Run task manually and check logs

## Configuration

**User Config Location:** `~/.cron-claude/config.json`

```json
{
  "secretKey": "base64-encoded-key"
}
```

Generated automatically on first use.

## Windows Task Scheduler Integration

**PowerShell Commands Used:**
- `Register-ScheduledTask` - Create task
- `Unregister-ScheduledTask` - Remove task
- `Enable-ScheduledTask` - Enable
- `Disable-ScheduledTask` - Disable
- `Get-ScheduledTask` - Query status

**Task Configuration:**
- Trigger: Cron schedule converted to Task Scheduler trigger
- Action: `node dist/mcp-server.js` (or similar execution path)
- Principal: Current user
- Settings: Allow on-demand execution, don't start if on batteries (optional)

## Error Handling

All tools return structured MCP responses:
```typescript
{
  content: [{ type: 'text', text: 'Success or error message' }],
  isError: boolean
}
```

Errors are surfaced to Claude with clear, actionable messages.

## Requirements

- **OS:** Windows 10/11 (uses Windows Task Scheduler)
- **Node.js:** >= 18.0.0
- **Claude Code:** With MCP support
- **Claude CLI:** For CLI invocation mode (optional)
- **Anthropic API Key:** For API invocation mode (optional)

## Installation for Users

**Via Claude Code (recommended):**
```bash
claude plugin add @patrick-rodgers/cron-claude
```

**Via npm + manual configuration:**
```bash
npm install -g @patrick-rodgers/cron-claude
```

Then add to `~/.claude/config.json`:
```json
{
  "mcpServers": {
    "cron-claude": {
      "command": "npx",
      "args": ["@patrick-rodgers/cron-claude"]
    }
  }
}
```

## Publishing

Before publishing to npm:
1. Update version in `package.json` and `.claude-plugin/plugin.json`
2. Run `npm run build` to compile
3. Test locally with `npm link`
4. Publish: `npm publish --access public`

## Troubleshooting

**Task not executing:**
- Check Task Scheduler for `CronClaude_<task-id>`
- Verify task is enabled in both file and scheduler
- Check Windows Event Viewer for Task Scheduler errors

**Logs not appearing:**
- Verify odsp-memory integration is working
- Check fallback `./logs/` directory
- Ensure permissions on log directories

**Toast notifications not showing:**
- Check Windows notification settings
- Verify `notifications.toast: true` in task file
- Disable Focus Assist temporarily
