/**
 * Configuration management for cron-claude
 * Handles secret key generation and storage
 */

import { randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_DIR = join(homedir(), '.cron-claude');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

interface Config {
  secretKey: string;
  version: string;
}

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
    return JSON.parse(data);
  }

  // Create new config with generated secret key
  const config: Config = {
    secretKey: generateSecretKey(),
    version: '0.1.0',
  };

  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  console.log('Generated new secret key for log signing');

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
