/**
 * Configuration loader for Majordomo
 *
 * Config is loaded from (in order of precedence):
 * 1. Environment variables
 * 2. ~/.majordomo/config.json
 * 3. ./majordomo.config.json
 * 4. Defaults
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface MajordomoConfig {
  /** System prompt for the AI */
  systemPrompt: string;
  /** Tick interval in ms */
  tickInterval: number;

  /** Slack configuration */
  slack?: {
    enabled: boolean;
    /** User token (xoxp-...) - messages appear as YOU */
    userToken?: string;
    /** Bot token (xoxb-...) - messages appear as bot */
    botToken?: string;
    /** App token for Socket Mode (xapp-...) */
    appToken: string;
    /** Mode: 'command' (you control) or 'listen' (auto-reply) */
    mode?: 'command' | 'listen';
  };

  /** Email (Gmail) configuration */
  email?: {
    enabled: boolean;
    // TODO: Add Gmail-specific config
  };

  /** Calendar configuration */
  calendar?: {
    enabled: boolean;
    // TODO: Add Calendar-specific config
  };
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

export async function loadConfig(): Promise<MajordomoConfig> {
  // Try loading config files
  const homeConfig = await loadJsonFile(join(homedir(), '.majordomo', 'config.json'));
  const localConfig = await loadJsonFile(join(process.cwd(), 'majordomo.config.json'));

  // Merge configs (local takes precedence over home)
  const fileConfig = { ...homeConfig, ...localConfig };

  // Build final config
  const config: MajordomoConfig = {
    ...DEFAULTS,
    ...fileConfig,
  };

  // Override with environment variables
  if (process.env.MAJORDOMO_SYSTEM_PROMPT) {
    config.systemPrompt = process.env.MAJORDOMO_SYSTEM_PROMPT;
  }

  if (process.env.MAJORDOMO_TICK_INTERVAL) {
    config.tickInterval = parseInt(process.env.MAJORDOMO_TICK_INTERVAL, 10);
  }

  // Slack from env (user token takes precedence)
  if (process.env.SLACK_APP_TOKEN && (process.env.SLACK_USER_TOKEN || process.env.SLACK_BOT_TOKEN)) {
    config.slack = {
      enabled: true,
      appToken: process.env.SLACK_APP_TOKEN,
      ...(process.env.SLACK_USER_TOKEN ? { userToken: process.env.SLACK_USER_TOKEN } : {}),
      ...(process.env.SLACK_BOT_TOKEN ? { botToken: process.env.SLACK_BOT_TOKEN } : {}),
      mode: (process.env.SLACK_MODE as 'command' | 'listen') || 'command',
    };
  }

  return config;
}

/**
 * Print current config (with secrets redacted)
 */
export function printConfig(config: MajordomoConfig) {
  const redacted = JSON.parse(JSON.stringify(config));

  if (redacted.slack?.botToken) {
    redacted.slack.botToken = redacted.slack.botToken.slice(0, 10) + '...';
  }
  if (redacted.slack?.appToken) {
    redacted.slack.appToken = redacted.slack.appToken.slice(0, 10) + '...';
  }

  console.log('Configuration:');
  console.log(JSON.stringify(redacted, null, 2));
}
