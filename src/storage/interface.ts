/**
 * Storage abstraction interface for task definitions
 * Enables pluggable storage backends (file, memory, etc.)
 */

import { TaskDefinition } from '../types.js';

export interface TaskMetadata {
  id: string;
  schedule: string;
  invocation: 'cli' | 'api';
  enabled: boolean;
}

export interface TaskStorage {
  /**
   * Create a new task
   */
  createTask(task: TaskDefinition): Promise<void>;

  /**
   * Get a task by ID
   */
  getTask(taskId: string): Promise<TaskDefinition | null>;

  /**
   * Update an existing task
   */
  updateTask(taskId: string, task: TaskDefinition): Promise<void>;

  /**
   * Delete a task by ID
   */
  deleteTask(taskId: string): Promise<void>;

  /**
   * List all tasks (metadata only)
   */
  listTasks(): Promise<TaskMetadata[]>;

  /**
   * Check if a task exists
   */
  exists(taskId: string): Promise<boolean>;

  /**
   * Get the file path for a task (for executor compatibility)
   * May be virtual path for non-file-based storage
   */
  getTaskFilePath(taskId: string): string;
}
