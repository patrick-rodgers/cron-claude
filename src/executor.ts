/**
 * Task execution engine
 * Executes tasks via CLI or API based on task configuration
 */

import { spawn } from 'child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import matter from 'gray-matter';
import { TaskDefinition, ExecutionResult, TaskLog } from './types.js';
import { createLog, addLogStep, finalizeLog } from './logger.js';
import { sendNotification } from './notifier.js';

/**
 * Parse task definition from markdown file
 */
export function parseTaskDefinition(filePath: string): TaskDefinition {
  const content = readFileSync(filePath, 'utf-8');
  const parsed = matter(content);

  const taskDef: TaskDefinition = {
    id: parsed.data.id || 'unknown',
    schedule: parsed.data.schedule || '0 0 * * *',
    invocation: parsed.data.invocation || 'cli',
    notifications: parsed.data.notifications || { toast: false },
    enabled: parsed.data.enabled !== false, // Default to true
    instructions: parsed.content,
  };

  return taskDef;
}

/**
 * Execute task via Claude CLI
 */
async function executeViaCLI(
  task: TaskDefinition,
  log: TaskLog,
  claudeCodePath?: string
): Promise<ExecutionResult> {
  addLogStep(log, 'Starting CLI execution');

  return new Promise((resolve) => {
    try {
      // Create a temporary file with the instructions
      const tempFile = `${process.env.TEMP || '/tmp'}/cron-claude-task-${task.id}-${Date.now()}.md`;
      writeFileSync(tempFile, task.instructions, 'utf-8');

      addLogStep(log, 'Created temporary task file', tempFile);

      // Spawn claude/claude-code process
      // Priority: 1. Passed argument, 2. CLAUDE_CODE_PATH env var, 3. 'claude-code' or 'claude' from PATH
      const claudeCommand = claudeCodePath || process.env.CLAUDE_CODE_PATH || 'claude-code';
      addLogStep(log, 'Spawning Claude CLI process', `Using: ${claudeCommand}`);

      const claude = spawn(claudeCommand, [tempFile], {
        stdio: 'pipe',
        shell: true,
      });

      let output = '';
      let errorOutput = '';

      claude.stdout?.on('data', (data) => {
        const text = data.toString();
        output += text;
        addLogStep(log, 'CLI output', text);
      });

      claude.stderr?.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;
        addLogStep(log, 'CLI error output', text);
      });

      claude.on('close', (code) => {
        // Clean up temp file
        try {
          unlinkSync(tempFile);
          addLogStep(log, 'Cleaned up temporary file');
        } catch (e) {
          addLogStep(log, 'Warning: Could not clean up temp file', undefined, String(e));
        }

        if (code === 0) {
          addLogStep(log, 'CLI execution completed successfully');
          resolve({
            success: true,
            output,
            steps: log.steps,
          });
        } else {
          addLogStep(log, 'CLI execution failed', undefined, `Exit code: ${code}`);
          resolve({
            success: false,
            output,
            error: errorOutput || `Process exited with code ${code}`,
            steps: log.steps,
          });
        }
      });

      claude.on('error', (err) => {
        addLogStep(log, 'CLI execution error', undefined, err.message);
        resolve({
          success: false,
          output,
          error: err.message,
          steps: log.steps,
        });
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      addLogStep(log, 'Execution setup failed', undefined, errorMsg);
      resolve({
        success: false,
        output: '',
        error: errorMsg,
        steps: log.steps,
      });
    }
  });
}

/**
 * Execute task via Claude API
 */
async function executeViaAPI(
  task: TaskDefinition,
  log: TaskLog
): Promise<ExecutionResult> {
  addLogStep(log, 'Starting API execution');

  try {
    // Check for API key
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable not set');
    }

    addLogStep(log, 'API key found, making request');

    // Make API call using fetch
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: task.instructions,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} ${errorText}`);
    }

    const data: any = await response.json();
    const output = data.content?.[0]?.text || JSON.stringify(data);

    addLogStep(log, 'API request completed', output);

    return {
      success: true,
      output,
      steps: log.steps,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    addLogStep(log, 'API execution failed', undefined, errorMsg);

    return {
      success: false,
      output: '',
      error: errorMsg,
      steps: log.steps,
    };
  }
}

/**
 * Execute a task
 */
export async function executeTask(taskFilePath: string, claudeCodePath?: string): Promise<void> {
  // Parse task definition
  const task = parseTaskDefinition(taskFilePath);

  // Create log
  const log = createLog(task.id);
  addLogStep(log, 'Task execution started', `Task: ${task.id}, Method: ${task.invocation}`);

  // Check if task is enabled
  if (!task.enabled) {
    addLogStep(log, 'Task skipped - disabled');
    finalizeLog(log, false);
    return;
  }

  // Execute based on invocation method
  let result: ExecutionResult;

  if (task.invocation === 'cli') {
    result = await executeViaCLI(task, log, claudeCodePath);
  } else if (task.invocation === 'api') {
    result = await executeViaAPI(task, log);
  } else {
    addLogStep(log, 'Invalid invocation method', undefined, `Unknown method: ${task.invocation}`);
    finalizeLog(log, false);
    return;
  }

  // Finalize log
  finalizeLog(log, result.success);

  // Send notification if enabled
  if (task.notifications.toast) {
    try {
      await sendNotification(
        `Task ${task.id} ${result.success ? 'completed' : 'failed'}`,
        result.success
          ? `Task executed successfully`
          : `Task failed: ${result.error || 'Unknown error'}`
      );
    } catch (error) {
      console.error('Failed to send notification:', error);
    }
  }
}

/**
 * Entry point for scheduled task execution
 * Called by Windows Task Scheduler
 */
export async function main() {
  // Get task file path and optional claude-code path from command line arguments
  const taskFile = process.argv[2];
  const claudeCodePath = process.argv[3]; // Optional: full path to claude-code executable

  if (!taskFile) {
    console.error('Usage: node executor.js <task-file-path> [claude-code-path]');
    process.exit(1);
  }

  try {
    await executeTask(taskFile, claudeCodePath);
    process.exit(0);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run if called directly (ESM equivalent of require.main === module)
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  main();
}
