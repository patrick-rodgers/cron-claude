/**
 * Configuration management for cron-claude
 * Handles secret key generation and storage
 */

import { randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Config } from './types.js';

const CONFIG_DIR = join(homedir(), '.cron-claude');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

/**
 * Ensure config directory exists
 */
function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Generate a new secret key for HMAC signing
 */
function generateSecretKey(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Load or create configuration
 */
export function loadConfig(): Config {
  ensureConfigDir();

  if (existsSync(CONFIG_FILE)) {
    const data = readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(data);

    // Merge with defaults for backward compatibility
    return {
      secretKey: parsed.secretKey,
      version: parsed.version || '0.1.0',
      storageType: parsed.storageType || 'auto',
      tasksDir: parsed.tasksDir || join(process.cwd(), 'tasks'),
      storagePreferenceSet: parsed.storagePreferenceSet || false,
    };
  }

  // Create new config with generated secret key
  const config: Config = {
    secretKey: generateSecretKey(),
    version: '0.1.0',
    storageType: 'auto',
    tasksDir: join(process.cwd(), 'tasks'),
    storagePreferenceSet: false,
  };

  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  console.error('Generated new secret key for log signing');

  return config;
}

/**
 * Get the secret key for HMAC signing
 */
export function getSecretKey(): string {
  const config = loadConfig();
  return config.secretKey;
}

/**
 * Get config directory path
 */
export function getConfigDir(): string {
  return CONFIG_DIR;
}

/**
 * Update configuration with partial updates
 */
export function updateConfig(updates: Partial<Config>): void {
  const config = loadConfig();
  const updated = { ...config, ...updates };
  writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), 'utf-8');
}
