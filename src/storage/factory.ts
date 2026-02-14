/**
 * Storage factory - detects and initializes storage backend
 */

import { execSync } from 'child_process';
import { TaskStorage } from './interface.js';
import { FileStorage } from './file-storage.js';
import { MemoryStorage } from './memory-storage.js';

export interface StorageConfig {
  storageType?: 'file' | 'memory' | 'auto';
  tasksDir?: string;
  storagePreferenceSet?: boolean;
}

/**
 * Test if odsp-memory is available
 */
export function testMemoryAvailability(): boolean {
  try {
    execSync('odsp-memory status', {
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create appropriate storage backend based on configuration
 */
export async function createStorage(
  config: StorageConfig,
  updateConfig: (updates: Partial<StorageConfig>) => void
): Promise<TaskStorage> {
  // 1. Check explicit config
  if (config.storageType === 'file') {
    const tasksDir = config.tasksDir || 'tasks';
    console.error(`Using file storage: ${tasksDir}`);
    return new FileStorage(tasksDir);
  }

  if (config.storageType === 'memory') {
    console.error('Using memory storage (odsp-memory)');
    return new MemoryStorage();
  }

  // 2. Auto-detect odsp-memory
  const memoryAvailable = testMemoryAvailability();

  if (memoryAvailable) {
    console.error('Auto-detected odsp-memory availability - using memory storage');
    updateConfig({
      storageType: 'memory',
      storagePreferenceSet: true,
    });
    return new MemoryStorage();
  }

  // 3. Fallback to file storage
  console.error('odsp-memory not available - using file storage');
  const tasksDir = config.tasksDir || 'tasks';

  updateConfig({
    storageType: 'file',
    tasksDir,
    storagePreferenceSet: true,
  });

  return new FileStorage(tasksDir);
}
