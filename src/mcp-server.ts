#!/usr/bin/env node
/**
 * Cron-Claude MCP Server
 * Exposes scheduled task management via Model Context Protocol
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';
import { registerTask, unregisterTask, enableTask, disableTask, getTaskStatus } from './scheduler.js';
import { executeTask } from './executor.js';
import { verifyLogFile } from './logger.js';
import { loadConfig, getConfigDir } from './config.js';
import { execSync } from 'child_process';

// Get project root (ESM equivalent of __dirname)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');
const TASKS_DIR = join(PROJECT_ROOT, 'tasks');

// Read version from package.json
const packageJson = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8'));
const VERSION = packageJson.version;

// Ensure tasks directory exists
if (!existsSync(TASKS_DIR)) {
  mkdirSync(TASKS_DIR, { recursive: true });
}

/**
 * Helper functions
 */
function getTaskFiles(): string[] {
  try {
    return readdirSync(TASKS_DIR).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
}

function parseTask(filename: string): any {
  const filePath = join(TASKS_DIR, filename);
  const content = readFileSync(filePath, 'utf-8');
  const parsed = matter(content);
  return { filePath, ...parsed.data, instructions: parsed.content };
}

/**
 * Define MCP tools
 */
const tools: Tool[] = [
  {
    name: 'cron_create_task',
    description: 'Create a new scheduled task from a template or custom definition',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Unique identifier for the task',
        },
        schedule: {
          type: 'string',
          description: 'Cron expression (e.g., "0 9 * * *" for 9 AM daily)',
          default: '0 9 * * *',
        },
        invocation: {
          type: 'string',
          enum: ['cli', 'api'],
          description: 'Execution method: cli (Claude CLI) or api (Anthropic API)',
          default: 'cli',
        },
        instructions: {
          type: 'string',
          description: 'Task instructions in markdown format',
        },
        toast_notifications: {
          type: 'boolean',
          description: 'Enable Windows toast notifications',
          default: true,
        },
        enabled: {
          type: 'boolean',
          description: 'Enable task immediately',
          default: true,
        },
      },
      required: ['task_id', 'instructions'],
    },
  },
  {
    name: 'cron_register_task',
    description: 'Register a task with Windows Task Scheduler',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Task ID to register',
        },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'cron_unregister_task',
    description: 'Unregister a task from Windows Task Scheduler',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Task ID to unregister',
        },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'cron_list_tasks',
    description: 'List all scheduled tasks with their status',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'cron_enable_task',
    description: 'Enable a task in Windows Task Scheduler',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Task ID to enable',
        },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'cron_disable_task',
    description: 'Disable a task in Windows Task Scheduler',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Task ID to disable',
        },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'cron_run_task',
    description: 'Manually execute a task immediately (does not wait for schedule)',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Task ID to run',
        },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'cron_view_logs',
    description: 'View execution logs for a task from the memory skill',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Task ID to view logs for',
        },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'cron_verify_log',
    description: 'Verify the cryptographic signature of a log file',
    inputSchema: {
      type: 'object',
      properties: {
        log_content: {
          type: 'string',
          description: 'Full markdown content of the log file including frontmatter',
        },
      },
      required: ['log_content'],
    },
  },
  {
    name: 'cron_status',
    description: 'Show system status and configuration',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'cron_get_task',
    description: 'Get the full definition of a specific task',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Task ID to retrieve',
        },
      },
      required: ['task_id'],
    },
  },
];

/**
 * Initialize MCP server
 */
const server = new Server(
  {
    name: 'cron-claude',
    version: VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * List available tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

/**
 * Handle tool calls
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'cron_create_task': {
        const { task_id, schedule, invocation, instructions, toast_notifications, enabled } =
          args as any;

        const template = `---
id: ${task_id}
schedule: "${schedule || '0 9 * * *'}"
invocation: ${invocation || 'cli'}
notifications:
  toast: ${toast_notifications !== false}
enabled: ${enabled !== false}
---

${instructions}
`;

        const filename = `${task_id}.md`;
        const filePath = join(TASKS_DIR, filename);

        if (existsSync(filePath)) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: Task "${task_id}" already exists. Use a different ID or delete the existing task first.`,
              },
            ],
          };
        }

        writeFileSync(filePath, template, 'utf-8');

        return {
          content: [
            {
              type: 'text',
              text: `✓ Task created successfully: ${task_id}\n\nLocation: ${filePath}\n\nNext step: Register it with:\ncron_register_task(task_id="${task_id}")`,
            },
          ],
        };
      }

      case 'cron_register_task': {
        const { task_id } = args as any;
        const filename = `${task_id}.md`;
        const filePath = join(TASKS_DIR, filename);

        if (!existsSync(filePath)) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: Task file not found: ${filename}`,
              },
            ],
          };
        }

        const task = parseTask(filename);

        if (!task.schedule) {
          return {
            content: [
              {
                type: 'text',
                text: 'Error: Task must have a schedule defined',
              },
            ],
          };
        }

        registerTask(task_id, filePath, task.schedule, PROJECT_ROOT);

        return {
          content: [
            {
              type: 'text',
              text: `✓ Task "${task_id}" registered successfully with Windows Task Scheduler\n\nSchedule: ${task.schedule}\nNext run will occur according to the schedule.`,
            },
          ],
        };
      }

      case 'cron_unregister_task': {
        const { task_id } = args as any;
        unregisterTask(task_id);

        return {
          content: [
            {
              type: 'text',
              text: `✓ Task "${task_id}" unregistered successfully`,
            },
          ],
        };
      }

      case 'cron_list_tasks': {
        const files = getTaskFiles();

        if (files.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No tasks found. Create one with cron_create_task.',
              },
            ],
          };
        }

        let output = 'Scheduled Tasks:\n\n';

        for (const file of files) {
          try {
            const task = parseTask(file);
            const status = getTaskStatus(task.id);

            output += `📋 ${task.id}\n`;
            output += `   Schedule: ${task.schedule}\n`;
            output += `   Method: ${task.invocation}\n`;
            output += `   Enabled (file): ${task.enabled ? '✓' : '✗'}\n`;

            if (status.exists) {
              output += `   Registered: ✓\n`;
              output += `   Status: ${status.enabled ? 'Enabled' : 'Disabled'}\n`;
              if (status.lastRunTime && status.lastRunTime !== '12/30/1899 12:00:00 AM') {
                output += `   Last run: ${status.lastRunTime}\n`;
              }
              if (status.nextRunTime) {
                output += `   Next run: ${status.nextRunTime}\n`;
              }
            } else {
              output += `   Registered: ✗ (use cron_register_task)\n`;
            }

            output += '\n';
          } catch (error) {
            output += `Error parsing ${file}: ${error}\n\n`;
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: output,
            },
          ],
        };
      }

      case 'cron_enable_task': {
        const { task_id } = args as any;
        enableTask(task_id);

        return {
          content: [
            {
              type: 'text',
              text: `✓ Task "${task_id}" enabled`,
            },
          ],
        };
      }

      case 'cron_disable_task': {
        const { task_id } = args as any;
        disableTask(task_id);

        return {
          content: [
            {
              type: 'text',
              text: `✓ Task "${task_id}" disabled`,
            },
          ],
        };
      }

      case 'cron_run_task': {
        const { task_id } = args as any;
        const filename = `${task_id}.md`;
        const filePath = join(TASKS_DIR, filename);

        if (!existsSync(filePath)) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: Task file not found: ${filename}`,
              },
            ],
          };
        }

        // Execute task
        await executeTask(filePath);

        return {
          content: [
            {
              type: 'text',
              text: `✓ Task "${task_id}" executed successfully\n\nCheck logs with: cron_view_logs(task_id="${task_id}")`,
            },
          ],
        };
      }

      case 'cron_view_logs': {
        const { task_id } = args as any;

        try {
          const result = execSync(`odsp-memory recall --category=cron-task "${task_id}"`, {
            encoding: 'utf-8',
          });

          return {
            content: [
              {
                type: 'text',
                text: result || `No logs found for task: ${task_id}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Error fetching logs: ${error}`,
              },
            ],
          };
        }
      }

      case 'cron_verify_log': {
        const { log_content } = args as any;
        const result = verifyLogFile(log_content);

        if (result.valid) {
          let output = '✓ Signature is valid - log has not been tampered with\n\n';
          if (result.log) {
            output += `Task: ${result.log.taskId}\n`;
            output += `Execution: ${result.log.executionId}\n`;
            output += `Status: ${result.log.status}\n`;
          }

          return {
            content: [
              {
                type: 'text',
                text: output,
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: 'text',
                text: `✗ Signature verification failed!\n\n${result.error}`,
              },
            ],
          };
        }
      }

      case 'cron_status': {
        const config = loadConfig();
        const taskCount = getTaskFiles().length;

        const output = `Cron-Claude System Status

Version: ${VERSION}
Config directory: ${getConfigDir()}
Tasks directory: ${TASKS_DIR}
Total tasks: ${taskCount}
Secret key: ${config.secretKey ? '✓ Configured' : '✗ Not configured'}

Node version: ${process.version}
Platform: ${process.platform}

Available tools:
- cron_create_task - Create new scheduled tasks
- cron_register_task - Register with Task Scheduler
- cron_list_tasks - View all tasks
- cron_run_task - Execute immediately
- cron_enable/disable_task - Toggle tasks
- cron_view_logs - View execution history
- cron_verify_log - Verify log signatures
`;

        return {
          content: [
            {
              type: 'text',
              text: output,
            },
          ],
        };
      }

      case 'cron_get_task': {
        const { task_id } = args as any;
        const filename = `${task_id}.md`;
        const filePath = join(TASKS_DIR, filename);

        if (!existsSync(filePath)) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: Task file not found: ${filename}`,
              },
            ],
          };
        }

        const content = readFileSync(filePath, 'utf-8');
        const task = parseTask(filename);
        const status = getTaskStatus(task_id);

        let output = `Task: ${task_id}\n\n`;
        output += `Schedule: ${task.schedule}\n`;
        output += `Method: ${task.invocation}\n`;
        output += `Enabled: ${task.enabled}\n`;
        output += `Notifications: ${task.notifications?.toast ? 'Yes' : 'No'}\n`;
        output += `Registered: ${status.exists ? 'Yes' : 'No'}\n\n`;
        output += `Full Definition:\n\n${content}`;

        return {
          content: [
            {
              type: 'text',
              text: output,
            },
          ],
        };
      }

      default:
        return {
          content: [
            {
              type: 'text',
              text: `Unknown tool: ${name}`,
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

/**
 * Start the server
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is reserved for MCP protocol)
  console.error('Cron-Claude MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
