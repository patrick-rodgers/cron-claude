/**
 * Audit logger with HMAC-SHA256 signing
 * Logs all task executions to odsp-memory skill with cryptographic signatures
 */

import { createHmac } from 'crypto';
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import matter from 'gray-matter';
import { TaskLog, LogStep } from './types.js';
import { getSecretKey } from './config.js';

/**
 * Create HMAC-SHA256 signature for content
 */
export function signContent(content: string, secretKey?: string): string {
  const key = secretKey || getSecretKey();
  const hmac = createHmac('sha256', key);
  hmac.update(content);
  return hmac.digest('hex');
}

/**
 * Verify HMAC-SHA256 signature
 */
export function verifySignature(
  content: string,
  signature: string,
  secretKey?: string
): boolean {
  const expectedSignature = signContent(content, secretKey);
  return signature === expectedSignature;
}

/**
 * Format task log as markdown with frontmatter
 */
export function formatTaskLog(log: TaskLog): string {
  const content = `# Task Execution Log: ${log.taskId}

**Execution ID:** ${log.executionId}
**Status:** ${log.status}
**Started:** ${log.timestamp}

## Execution Steps

${log.steps
  .map(
    (step, idx) => `### Step ${idx + 1}: ${step.action}
**Time:** ${step.timestamp}
${step.output ? `\n**Output:**\n\`\`\`\n${step.output}\n\`\`\`\n` : ''}
${step.error ? `\n**Error:**\n\`\`\`\n${step.error}\n\`\`\`\n` : ''}`
  )
  .join('\n\n')}

## Summary
Total steps: ${log.steps.length}
Status: ${log.status}
`;

  // Sign the content
  const signature = signContent(content);

  // Create frontmatter
  const frontmatter = {
    category: 'cron-task',
    taskId: log.taskId,
    executionId: log.executionId,
    timestamp: log.timestamp,
    status: log.status,
    signature,
  };

  // Combine frontmatter and content
  return matter.stringify(content, frontmatter);
}

/**
 * Save log to memory skill
 */
export function saveLogToMemory(log: TaskLog): void {
  const markdown = formatTaskLog(log);
  const tempFile = `${process.env.TEMP || '/tmp'}/cron-claude-log-${log.executionId}.md`;

  // Write to temp file
  writeFileSync(tempFile, markdown, 'utf-8');

  try {
    // Store in memory skill
    const category = 'cron-task';
    const content = `Task ${log.taskId} execution ${log.executionId}: ${log.status}`;

    execSync(`odsp-memory remember ${category} "${content}"`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    console.log(`✓ Logged execution ${log.executionId} to memory skill`);
  } catch (error) {
    console.error('Failed to save log to memory skill:', error);
    // Fallback: save to local file
    const fallbackPath = `./logs/${log.taskId}-${log.executionId}.md`;
    mkdirSync('./logs', { recursive: true });
    writeFileSync(fallbackPath, markdown, 'utf-8');
    console.log(`✓ Saved log to fallback location: ${fallbackPath}`);
  } finally {
    // Clean up temp file
    try {
      unlinkSync(tempFile);
    } catch {}
  }
}

/**
 * Verify a log file's signature
 */
export function verifyLogFile(markdown: string): {
  valid: boolean;
  log?: TaskLog;
  error?: string;
} {
  try {
    const parsed = matter(markdown);
    const { signature, ...frontmatter } = parsed.data;

    if (!signature) {
      return { valid: false, error: 'No signature found in log file' };
    }

    // Verify signature
    const isValid = verifySignature(parsed.content, signature);

    if (isValid) {
      return {
        valid: true,
        log: {
          taskId: frontmatter.taskId,
          executionId: frontmatter.executionId,
          timestamp: frontmatter.timestamp,
          status: frontmatter.status,
          steps: [], // Would need to parse from content
          signature,
        },
      };
    } else {
      return { valid: false, error: 'Signature verification failed' };
    }
  } catch (error) {
    return {
      valid: false,
      error: `Failed to parse log: ${error}`,
    };
  }
}

/**
 * Create a new log entry
 */
export function createLog(taskId: string): TaskLog {
  return {
    taskId,
    executionId: `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    status: 'running',
    steps: [],
  };
}

/**
 * Add a step to the log
 */
export function addLogStep(log: TaskLog, action: string, output?: string, error?: string): void {
  log.steps.push({
    timestamp: new Date().toISOString(),
    action,
    output,
    error,
  });
}

/**
 * Finalize and save log
 */
export function finalizeLog(log: TaskLog, success: boolean): void {
  log.status = success ? 'success' : 'failure';
  saveLogToMemory(log);
}
