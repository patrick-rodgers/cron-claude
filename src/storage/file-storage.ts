/**
 * File-based task storage implementation
 * Stores tasks as markdown files with YAML frontmatter
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import { TaskDefinition } from '../types.js';
import { TaskStorage, TaskMetadata } from './interface.js';

export class FileStorage implements TaskStorage {
  private tasksDir: string;

  constructor(tasksDir: string) {
    this.tasksDir = tasksDir;
    this.ensureTasksDir();
  }

  /**
   * Ensure tasks directory exists
   */
  private ensureTasksDir(): void {
    if (!existsSync(this.tasksDir)) {
      mkdirSync(this.tasksDir, { recursive: true });
    }
  }

  /**
   * Get file path for a task
   */
  getTaskFilePath(taskId: string): string {
    return join(this.tasksDir, `${taskId}.md`);
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
   * Parse markdown file to TaskDefinition
   */
  private parseTaskFile(filePath: string): TaskDefinition {
    const content = readFileSync(filePath, 'utf-8');
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

  async createTask(task: TaskDefinition): Promise<void> {
    const filePath = this.getTaskFilePath(task.id);

    if (existsSync(filePath)) {
      throw new Error(`Task "${task.id}" already exists`);
    }

    const markdown = this.taskToMarkdown(task);
    writeFileSync(filePath, markdown, 'utf-8');
  }

  async getTask(taskId: string): Promise<TaskDefinition | null> {
    const filePath = this.getTaskFilePath(taskId);

    if (!existsSync(filePath)) {
      return null;
    }

    return this.parseTaskFile(filePath);
  }

  async updateTask(taskId: string, task: TaskDefinition): Promise<void> {
    const filePath = this.getTaskFilePath(taskId);

    if (!existsSync(filePath)) {
      throw new Error(`Task "${taskId}" not found`);
    }

    const markdown = this.taskToMarkdown(task);
    writeFileSync(filePath, markdown, 'utf-8');
  }

  async deleteTask(taskId: string): Promise<void> {
    const filePath = this.getTaskFilePath(taskId);

    if (!existsSync(filePath)) {
      throw new Error(`Task "${taskId}" not found`);
    }

    unlinkSync(filePath);
  }

  async listTasks(): Promise<TaskMetadata[]> {
    this.ensureTasksDir();

    try {
      const files = readdirSync(this.tasksDir).filter((f) => f.endsWith('.md'));

      const tasks: TaskMetadata[] = [];

      for (const file of files) {
        try {
          const filePath = join(this.tasksDir, file);
          const task = this.parseTaskFile(filePath);

          tasks.push({
            id: task.id,
            schedule: task.schedule,
            invocation: task.invocation,
            enabled: task.enabled,
          });
        } catch (error) {
          console.error(`Error parsing task file ${file}:`, error);
        }
      }

      return tasks;
    } catch {
      return [];
    }
  }

  async exists(taskId: string): Promise<boolean> {
    const filePath = this.getTaskFilePath(taskId);
    return existsSync(filePath);
  }
}
