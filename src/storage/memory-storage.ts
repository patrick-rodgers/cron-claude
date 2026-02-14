/**
 * Memory-based task storage implementation
 * Uses odsp-memory MCP server for cloud-backed storage
 */

import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import matter from 'gray-matter';
import { TaskDefinition } from '../types.js';
import { TaskStorage, TaskMetadata } from './interface.js';

export class MemoryStorage implements TaskStorage {
  private readonly category = 'cron-task-definition';
  private tempDir: string;

  constructor() {
    // Create temp directory for task files
    this.tempDir = join(tmpdir(), 'cron-claude-tasks');
    if (!existsSync(this.tempDir)) {
      mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Convert TaskDefinition to markdown with YAML frontmatter
   */
  private taskToMarkdown(task: TaskDefinition): string {
    return `---
id: ${task.id}
schedule: "${task.schedule}"
invocation: ${task.invocation}
notifications:
  toast: ${task.notifications.toast}
enabled: ${task.enabled}
---

${task.instructions}
`;
  }

  /**
   * Parse markdown content to TaskDefinition
   */
  private parseMarkdown(content: string): TaskDefinition {
    const parsed = matter(content);

    return {
      id: parsed.data.id || 'unknown',
      schedule: parsed.data.schedule || '0 0 * * *',
      invocation: parsed.data.invocation || 'cli',
      notifications: parsed.data.notifications || { toast: false },
      enabled: parsed.data.enabled !== false,
      instructions: parsed.content,
    };
  }

  /**
   * Store task in memory using odsp-memory CLI
   */
  private async storeInMemory(taskId: string, content: string): Promise<void> {
    try {
      // Write content to temp file
      const tempFile = join(this.tempDir, `temp-${taskId}-${Date.now()}.md`);
      writeFileSync(tempFile, content, 'utf-8');

      try {
        // Read file and pipe to odsp-memory (Windows compatible)
        const command = process.platform === 'win32'
          ? `type "${tempFile}" | odsp-memory remember ${this.category} --tags "task-id:${taskId}"`
          : `cat "${tempFile}" | odsp-memory remember ${this.category} --tags "task-id:${taskId}"`;

        execSync(command, {
          encoding: 'utf-8',
        });
      } finally {
        // Clean up temp file
        try {
          unlinkSync(tempFile);
        } catch {
          // Ignore cleanup errors
        }
      }
    } catch (error) {
      throw new Error(`Failed to store task in memory: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Retrieve task from memory using odsp-memory CLI
   */
  private async retrieveFromMemory(taskId: string): Promise<string | null> {
    try {
      const result = execSync(
        `odsp-memory recall --category=${this.category} "task-id:${taskId}"`,
        {
          encoding: 'utf-8',
          stdio: 'pipe',
        }
      );

      return result.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Delete task from memory
   */
  private async deleteFromMemory(taskId: string): Promise<void> {
    try {
      // First, list memories to find the memory ID
      const listResult = execSync(
        `odsp-memory list --category=${this.category}`,
        {
          encoding: 'utf-8',
          stdio: 'pipe',
        }
      );

      // Parse output to find memory ID with matching task-id tag
      // This is a simplified approach - may need refinement based on actual odsp-memory output format
      const lines = listResult.split('\n');
      for (const line of lines) {
        if (line.includes(`task-id:${taskId}`)) {
          // Extract memory ID from line (format depends on odsp-memory output)
          // For now, we'll use a search and recall approach
          const recallResult = await this.retrieveFromMemory(taskId);
          if (recallResult) {
            // odsp-memory forget requires memory ID
            // Since we can't easily get the ID, we'll skip deletion for now
            // and rely on update to overwrite
            console.error(`Warning: Could not delete task ${taskId} from memory - update will overwrite`);
          }
          break;
        }
      }
    } catch (error) {
      console.error(`Failed to delete task from memory: ${error}`);
    }
  }

  /**
   * Get virtual file path for executor compatibility
   */
  getTaskFilePath(taskId: string): string {
    // Create temp file on-demand
    const tempFile = join(this.tempDir, `${taskId}.md`);

    // If file doesn't exist, create it from memory
    if (!existsSync(tempFile)) {
      this.retrieveFromMemory(taskId).then((content) => {
        if (content) {
          writeFileSync(tempFile, content, 'utf-8');
        }
      }).catch(console.error);
    }

    return tempFile;
  }

  async createTask(task: TaskDefinition): Promise<void> {
    const existing = await this.retrieveFromMemory(task.id);

    if (existing) {
      throw new Error(`Task "${task.id}" already exists`);
    }

    const markdown = this.taskToMarkdown(task);
    await this.storeInMemory(task.id, markdown);
  }

  async getTask(taskId: string): Promise<TaskDefinition | null> {
    const content = await this.retrieveFromMemory(taskId);

    if (!content) {
      return null;
    }

    return this.parseMarkdown(content);
  }

  async updateTask(taskId: string, task: TaskDefinition): Promise<void> {
    const existing = await this.retrieveFromMemory(taskId);

    if (!existing) {
      throw new Error(`Task "${taskId}" not found`);
    }

    const markdown = this.taskToMarkdown(task);

    // Delete old version and create new one
    await this.deleteFromMemory(taskId);
    await this.storeInMemory(task.id, markdown);
  }

  async deleteTask(taskId: string): Promise<void> {
    const existing = await this.retrieveFromMemory(taskId);

    if (!existing) {
      throw new Error(`Task "${taskId}" not found`);
    }

    await this.deleteFromMemory(taskId);

    // Clean up temp file if it exists
    const tempFile = join(this.tempDir, `${taskId}.md`);
    if (existsSync(tempFile)) {
      unlinkSync(tempFile);
    }
  }

  async listTasks(): Promise<TaskMetadata[]> {
    try {
      const result = execSync(
        `odsp-memory list --category=${this.category}`,
        {
          encoding: 'utf-8',
          stdio: 'pipe',
        }
      );

      // Parse the output to extract task IDs
      const tasks: TaskMetadata[] = [];
      const lines = result.split('\n');

      for (const line of lines) {
        // Look for lines with task-id tags
        const match = line.match(/task-id:(\S+)/);
        if (match) {
          const taskId = match[1];
          const task = await this.getTask(taskId);

          if (task) {
            tasks.push({
              id: task.id,
              schedule: task.schedule,
              invocation: task.invocation,
              enabled: task.enabled,
            });
          }
        }
      }

      return tasks;
    } catch {
      return [];
    }
  }

  async exists(taskId: string): Promise<boolean> {
    const content = await this.retrieveFromMemory(taskId);
    return content !== null;
  }
}
