# cron-list

List all scheduled tasks with their status and next run times.

## Usage

When this command is invoked, Claude will automatically call the `cron_list_tasks` MCP tool to display all tasks.

## Example

```
/cron-list
```

Claude will show you:
- Task IDs
- Schedules (cron expressions)
- Invocation methods (CLI or API)
- Enabled/disabled status
- Registration status
- Last and next run times
