/**
 * Core types for cron-claude system
 */

export interface TaskDefinition {
  id: string;
  schedule: string; // Cron expression
  invocation: 'cli' | 'api';
  notifications: {
    toast: boolean;
  };
  enabled: boolean;
  instructions: string; // Markdown content
}

export interface TaskLog {
  taskId: string;
  executionId: string;
  timestamp: string;
  status: 'success' | 'failure' | 'running';
  steps: LogStep[];
  signature?: string;
}

export interface LogStep {
  timestamp: string;
  action: string;
  output?: string;
  error?: string;
}

export interface LoggerConfig {
  secretKey: string;
}

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  steps: LogStep[];
}
