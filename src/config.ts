/**
 * Configuration loader for Majordomo
 *
 * Config is loaded from (in order of precedence):
 * 1. Environment variables
 * 2. ~/.majordomo/config.json
 * 3. ./majordomo.config.json
 * 4. Defaults
 *
 * Supports multi-account configuration for all integrations.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ============================================================================
// Account Interfaces
// ============================================================================

export interface SlackAccount {
  name: string;
  isDefault?: boolean;
  /** User token (xoxp-...) - messages appear as YOU */
  userToken?: string;
  /** Bot token (xoxb-...) - messages appear as bot */
  botToken?: string;
  /** App token for Socket Mode (xapp-...) */
  appToken?: string;
  /** Human-readable workspace name */
  workspaceName?: string;
}

export interface GoogleAccount {
  name: string;
  isDefault?: boolean;
  /** User's email address */
  email?: string;
  /** OAuth client ID */
  clientId?: string;
  /** OAuth client secret */
  clientSecret?: string;
  /** OAuth refresh token */
  refreshToken?: string;
}

export interface DiscordAccount {
  name: string;
  isDefault?: boolean;
  /** Discord bot token */
  botToken?: string;
}

export interface LinearAccount {
  name: string;
  isDefault?: boolean;
  /** Linear API key (lin_api_...) */
  apiKey?: string;
}

export interface NotionAccount {
  name: string;
  isDefault?: boolean;
  /** Notion integration token (secret_...) */
  integrationToken?: string;
}

export interface JiraAccount {
  name: string;
  isDefault?: boolean;
  /** Jira instance URL (e.g., https://company.atlassian.net) */
  host: string;
  /** Jira email */
  email: string;
  /** Jira API token */
  apiToken: string;
}

export interface AccountsConfig {
  slack?: SlackAccount[];
  google?: GoogleAccount[];
  discord?: DiscordAccount[];
  linear?: LinearAccount[];
  notion?: NotionAccount[];
  jira?: JiraAccount[];
}

// Provider configuration
export type ProviderType = 'anthropic' | 'openai' | 'ollama' | 'claude-code';
export type AuthMode = 'api_key' | 'oauth' | 'cli';

export interface ProviderSettings {
  provider: ProviderType;
  authMode: AuthMode;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

// ============================================================================
// Legacy Config Interfaces (for migration)
// ============================================================================

interface LegacySlackConfig {
  enabled?: boolean;
  userToken?: string;
  botToken?: string;
  appToken?: string;
  mode?: 'command' | 'listen';
}

interface LegacyGoogleConfig {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
}

interface LegacyConfig {
  systemPrompt?: string;
  tickInterval?: number;
  slack?: LegacySlackConfig;
  google?: LegacyGoogleConfig;
  email?: { enabled?: boolean };
  calendar?: { enabled?: boolean };
}

// ============================================================================
// Main Config Interface
// ============================================================================

export interface MajordomoConfig {
  /** System prompt for the AI */
  systemPrompt: string;
  /** Tick interval in ms */
  tickInterval: number;
  /** AI provider configuration */
  provider?: ProviderSettings;
  /** Multi-account configuration */
  accounts?: AccountsConfig;

  // Legacy fields (kept for backward compatibility during migration)
  /** @deprecated Use accounts.slack instead */
  slack?: LegacySlackConfig;
  /** @deprecated Use accounts.google instead */
  google?: LegacyGoogleConfig;
  /** @deprecated Use accounts.google instead */
  email?: { enabled?: boolean };
  /** @deprecated Use accounts.google instead */
  calendar?: { enabled?: boolean };
}

const DEFAULT_SYSTEM_PROMPT = `You are Majordomo, a personal AI assistant.

Your job is to help manage your human's digital life:
- Triage and summarize incoming messages
- Draft responses when appropriate
- Manage calendar and schedule
- Track tasks and todos
- Connect information across different services

Guidelines:
- Be concise and actionable
- Prioritize by urgency and importance
- Ask for confirmation before taking consequential actions
- Learn your human's preferences over time
- Protect their time and attention

You have access to all of Claude Code's tools, including:
- Linear (task management)
- File system
- Web search
- And more through MCP servers
`;

const DEFAULTS: MajordomoConfig = {
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  tickInterval: 60_000, // 1 minute
};

async function loadJsonFile(path: string): Promise<Partial<MajordomoConfig> | null> {
  try {
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// ============================================================================
// Migration: Convert legacy single-account to multi-account
// ============================================================================

export function migrateConfig(config: Partial<MajordomoConfig & LegacyConfig>): MajordomoConfig {
  const migrated: MajordomoConfig = {
    systemPrompt: config.systemPrompt || DEFAULTS.systemPrompt,
    tickInterval: config.tickInterval || DEFAULTS.tickInterval,
    accounts: config.accounts || {},
  };

  // Migrate legacy Slack config
  if (config.slack && !migrated.accounts?.slack?.length) {
    const legacySlack = config.slack;
    if (legacySlack.userToken || legacySlack.botToken) {
      migrated.accounts = migrated.accounts || {};
      migrated.accounts.slack = [{
        name: 'default',
        isDefault: true,
        userToken: legacySlack.userToken,
        botToken: legacySlack.botToken,
        appToken: legacySlack.appToken,
      }];
    }
  }

  // Migrate legacy Google config
  if (config.google && !migrated.accounts?.google?.length) {
    const legacyGoogle = config.google;
    if (legacyGoogle.refreshToken) {
      migrated.accounts = migrated.accounts || {};
      migrated.accounts.google = [{
        name: 'default',
        isDefault: true,
        clientId: legacyGoogle.clientId,
        clientSecret: legacyGoogle.clientSecret,
        refreshToken: legacyGoogle.refreshToken,
      }];
    }
  }

  return migrated;
}

// ============================================================================
// Config Loading
// ============================================================================

export async function loadConfig(): Promise<MajordomoConfig> {
  // Try loading config files
  const homeConfig = await loadJsonFile(join(homedir(), '.majordomo', 'config.json'));
  const localConfig = await loadJsonFile(join(process.cwd(), 'majordomo.config.json'));

  // Merge configs (local takes precedence over home)
  const fileConfig = { ...homeConfig, ...localConfig };

  // Build final config with migration
  const config = migrateConfig({
    ...DEFAULTS,
    ...fileConfig,
  });

  // Override with environment variables
  if (process.env.MAJORDOMO_SYSTEM_PROMPT) {
    config.systemPrompt = process.env.MAJORDOMO_SYSTEM_PROMPT;
  }

  if (process.env.MAJORDOMO_TICK_INTERVAL) {
    config.tickInterval = parseInt(process.env.MAJORDOMO_TICK_INTERVAL, 10);
  }

  // Slack from env (creates a default account)
  if (process.env.SLACK_APP_TOKEN && (process.env.SLACK_USER_TOKEN || process.env.SLACK_BOT_TOKEN)) {
    config.accounts = config.accounts || {};
    config.accounts.slack = [{
      name: 'env',
      isDefault: true,
      appToken: process.env.SLACK_APP_TOKEN,
      ...(process.env.SLACK_USER_TOKEN ? { userToken: process.env.SLACK_USER_TOKEN } : {}),
      ...(process.env.SLACK_BOT_TOKEN ? { botToken: process.env.SLACK_BOT_TOKEN } : {}),
    }];
  }

  return config;
}

// ============================================================================
// Config Saving
// ============================================================================

export async function saveConfig(config: MajordomoConfig): Promise<void> {
  const configPath = join(homedir(), '.majordomo', 'config.json');
  await writeFile(configPath, JSON.stringify(config, null, 2));
}

// ============================================================================
// Config Printing (with secrets redacted)
// ============================================================================

export function printConfig(config: MajordomoConfig) {
  const redacted = JSON.parse(JSON.stringify(config));

  // Redact account tokens
  if (redacted.accounts?.slack) {
    for (const account of redacted.accounts.slack) {
      if (account.userToken) account.userToken = account.userToken.slice(0, 10) + '...';
      if (account.botToken) account.botToken = account.botToken.slice(0, 10) + '...';
      if (account.appToken) account.appToken = account.appToken.slice(0, 10) + '...';
    }
  }

  if (redacted.accounts?.google) {
    for (const account of redacted.accounts.google) {
      if (account.clientSecret) account.clientSecret = '***';
      if (account.refreshToken) account.refreshToken = account.refreshToken.slice(0, 10) + '...';
    }
  }

  if (redacted.accounts?.discord) {
    for (const account of redacted.accounts.discord) {
      if (account.botToken) account.botToken = account.botToken.slice(0, 10) + '...';
    }
  }

  if (redacted.accounts?.linear) {
    for (const account of redacted.accounts.linear) {
      if (account.apiKey) account.apiKey = account.apiKey.slice(0, 10) + '...';
    }
  }

  if (redacted.accounts?.notion) {
    for (const account of redacted.accounts.notion) {
      if (account.integrationToken) account.integrationToken = account.integrationToken.slice(0, 10) + '...';
    }
  }

  if (redacted.accounts?.jira) {
    for (const account of redacted.accounts.jira) {
      if (account.apiToken) account.apiToken = '***';
    }
  }

  // Legacy fields
  if (redacted.slack?.botToken) {
    redacted.slack.botToken = redacted.slack.botToken.slice(0, 10) + '...';
  }
  if (redacted.slack?.appToken) {
    redacted.slack.appToken = redacted.slack.appToken.slice(0, 10) + '...';
  }

  console.log('Configuration:');
  console.log(JSON.stringify(redacted, null, 2));
}

// ============================================================================
// Account Helpers
// ============================================================================

export function getAccountNames(config: MajordomoConfig): {
  slack: string[];
  google: string[];
  discord: string[];
  linear: string[];
  notion: string[];
  jira: string[];
} {
  return {
    slack: (config.accounts?.slack || []).map(a => a.name),
    google: (config.accounts?.google || []).map(a => a.name),
    discord: (config.accounts?.discord || []).map(a => a.name),
    linear: (config.accounts?.linear || []).map(a => a.name),
    notion: (config.accounts?.notion || []).map(a => a.name),
    jira: (config.accounts?.jira || []).map(a => a.name),
  };
}
