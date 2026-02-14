#!/bin/bash
# Cron-Claude session start hook
# This runs when a new session begins

cat <<'EOF'
## Cron-Claude Available

The Cron-Claude MCP server is active. You can schedule and manage automated Claude tasks.

**Quick commands:**
- `/cron-status` - View system status
- `/cron-list` - List all scheduled tasks
- `/cron-run <task-id>` - Run a task immediately

**Available tools:**
- `cron_create_task` - Create new scheduled tasks
- `cron_register_task` - Register with Windows Task Scheduler
- `cron_list_tasks` - View all tasks
- `cron_run_task` - Execute immediately
- `cron_enable_task` / `cron_disable_task` - Toggle tasks
- `cron_view_logs` - View execution logs
- `cron_verify_log` - Verify log integrity
EOF
