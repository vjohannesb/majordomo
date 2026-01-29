/**
 * Account Management - Multi-account support for all integrations
 *
 * Handles account resolution, client caching, and tool context.
 */

import { WebClient } from '@slack/web-api';
import { google } from 'googleapis';
import { Client as DiscordClient, GatewayIntentBits } from 'discord.js';
import { LinearClient } from '@linear/sdk';
import { Client as NotionClient } from '@notionhq/client';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { OAuth2Client } from 'google-auth-library';
import type { gmail_v1, calendar_v3 } from 'googleapis';
import type {
  SlackAccount,
  GoogleAccount,
  DiscordAccount,
  LinearAccount,
  NotionAccount,
  JiraAccount,
  MajordomoConfig,
} from '../config.js';

// ============================================================================
// Tool Context - passed to every tool execution
// ============================================================================

/** Simple Jira API client using fetch */
export interface JiraClient {
  host: string;
  email: string;
  apiToken: string;
  /** Make a Jira API request */
  request: <T = unknown>(method: string, path: string, body?: unknown) => Promise<T>;
}

export interface ToolContext {
  config: MajordomoConfig;
  /** Get Slack client for a specific account (or default) */
  getSlackClient: (accountName?: string) => Promise<WebClient>;
  /** Get Gmail client for a specific account (or default) */
  getGmailClient: (accountName?: string) => Promise<gmail_v1.Gmail>;
  /** Get Calendar client for a specific account (or default) */
  getCalendarClient: (accountName?: string) => Promise<calendar_v3.Calendar>;
  /** Get Discord client for a specific account (or default) */
  getDiscordClient: (accountName?: string) => Promise<DiscordClient>;
  /** Get Linear client for a specific account (or default) */
  getLinearClient: (accountName?: string) => Promise<LinearClient>;
  /** Get Notion client for a specific account (or default) */
  getNotionClient: (accountName?: string) => Promise<NotionClient>;
  /** Get Jira client for a specific account (or default) */
  getJiraClient: (accountName?: string) => Promise<JiraClient>;
}

// ============================================================================
// Account Resolution
// ============================================================================

type AccountType = SlackAccount | GoogleAccount | DiscordAccount | LinearAccount | NotionAccount;

interface AccountResolver<T extends AccountType> {
  getByName(accounts: T[], name: string): T | undefined;
  getDefault(accounts: T[]): T | undefined;
  resolve(accounts: T[], name?: string): T | undefined;
}

function createAccountResolver<T extends AccountType>(): AccountResolver<T> {
  return {
    getByName(accounts: T[], name: string): T | undefined {
      return accounts.find(a => a.name.toLowerCase() === name.toLowerCase());
    },
    getDefault(accounts: T[]): T | undefined {
      return accounts.find(a => a.isDefault) || accounts[0];
    },
    resolve(accounts: T[], name?: string): T | undefined {
      if (name) {
        return this.getByName(accounts, name);
      }
      return this.getDefault(accounts);
    },
  };
}

// Special resolver for Google accounts that also matches by email
function createGoogleAccountResolver(): AccountResolver<GoogleAccount> {
  return {
    getByName(accounts: GoogleAccount[], name: string): GoogleAccount | undefined {
      const lowerName = name.toLowerCase();
      // Try matching by name first
      const byName = accounts.find(a => a.name.toLowerCase() === lowerName);
      if (byName) return byName;
      // Then try matching by email
      return accounts.find(a => a.email?.toLowerCase() === lowerName);
    },
    getDefault(accounts: GoogleAccount[]): GoogleAccount | undefined {
      return accounts.find(a => a.isDefault) || accounts[0];
    },
    resolve(accounts: GoogleAccount[], name?: string): GoogleAccount | undefined {
      if (name) {
        return this.getByName(accounts, name);
      }
      return this.getDefault(accounts);
    },
  };
}

export const slackResolver = createAccountResolver<SlackAccount>();
export const googleResolver = createGoogleAccountResolver();
export const discordResolver = createAccountResolver<DiscordAccount>();
export const linearResolver = createAccountResolver<LinearAccount>();
export const notionResolver = createAccountResolver<NotionAccount>();
export const jiraResolver = createAccountResolver<JiraAccount>();

// ============================================================================
// Client Managers - Cache clients per account
// ============================================================================

class SlackClientManager {
  private clients = new Map<string, WebClient>();

  get(account: SlackAccount): WebClient {
    const key = account.name;
    if (!this.clients.has(key)) {
      const token = account.userToken || account.botToken;
      if (!token) {
        throw new Error(`No token configured for Slack account: ${account.name}`);
      }
      this.clients.set(key, new WebClient(token));
    }
    return this.clients.get(key)!;
  }

  clear() {
    this.clients.clear();
  }
}

class GoogleClientManager {
  private authClients = new Map<string, OAuth2Client>();
  private gmailClients = new Map<string, gmail_v1.Gmail>();
  private calendarClients = new Map<string, calendar_v3.Calendar>();

  private getAuth(account: GoogleAccount): OAuth2Client {
    const key = account.name;
    if (!this.authClients.has(key)) {
      if (!account.clientId || !account.clientSecret || !account.refreshToken) {
        throw new Error(`Google account "${account.name}" not fully configured`);
      }
      const oauth2Client = new google.auth.OAuth2(
        account.clientId,
        account.clientSecret,
        'http://localhost:3456/callback'
      );
      oauth2Client.setCredentials({
        refresh_token: account.refreshToken,
      });
      this.authClients.set(key, oauth2Client);
    }
    return this.authClients.get(key)!;
  }

  getGmail(account: GoogleAccount): gmail_v1.Gmail {
    const key = account.name;
    if (!this.gmailClients.has(key)) {
      const auth = this.getAuth(account);
      this.gmailClients.set(key, google.gmail({ version: 'v1', auth }));
    }
    return this.gmailClients.get(key)!;
  }

  getCalendar(account: GoogleAccount): calendar_v3.Calendar {
    const key = account.name;
    if (!this.calendarClients.has(key)) {
      const auth = this.getAuth(account);
      this.calendarClients.set(key, google.calendar({ version: 'v3', auth }));
    }
    return this.calendarClients.get(key)!;
  }

  clear() {
    this.authClients.clear();
    this.gmailClients.clear();
    this.calendarClients.clear();
  }
}

class DiscordClientManager {
  private clients = new Map<string, DiscordClient>();
  private readyPromises = new Map<string, Promise<void>>();

  async get(account: DiscordAccount): Promise<DiscordClient> {
    const key = account.name;

    if (!this.clients.has(key)) {
      if (!account.botToken) {
        throw new Error(`No bot token configured for Discord account: ${account.name}`);
      }

      const client = new DiscordClient({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.DirectMessages,
          GatewayIntentBits.MessageContent,
        ],
      });

      const readyPromise = new Promise<void>((resolve, reject) => {
        client.once('ready', () => resolve());
        client.once('error', reject);
      });

      this.clients.set(key, client);
      this.readyPromises.set(key, readyPromise);

      await client.login(account.botToken);
      await readyPromise;
    }

    return this.clients.get(key)!;
  }

  clear() {
    for (const client of this.clients.values()) {
      client.destroy();
    }
    this.clients.clear();
    this.readyPromises.clear();
  }
}

class LinearClientManager {
  private clients = new Map<string, LinearClient>();

  get(account: LinearAccount): LinearClient {
    const key = account.name;
    if (!this.clients.has(key)) {
      if (!account.apiKey) {
        throw new Error(`No API key configured for Linear account: ${account.name}`);
      }
      this.clients.set(key, new LinearClient({ apiKey: account.apiKey }));
    }
    return this.clients.get(key)!;
  }

  clear() {
    this.clients.clear();
  }
}

class NotionClientManager {
  private clients = new Map<string, NotionClient>();

  get(account: NotionAccount): NotionClient {
    const key = account.name;
    if (!this.clients.has(key)) {
      if (!account.integrationToken) {
        throw new Error(`No integration token configured for Notion account: ${account.name}`);
      }
      this.clients.set(key, new NotionClient({ auth: account.integrationToken }));
    }
    return this.clients.get(key)!;
  }

  clear() {
    this.clients.clear();
  }
}

class JiraClientManager {
  private clients = new Map<string, JiraClient>();

  get(account: JiraAccount): JiraClient {
    const key = account.name;
    if (!this.clients.has(key)) {
      if (!account.host || !account.email || !account.apiToken) {
        throw new Error(`Missing Jira credentials for account: ${account.name}`);
      }

      const authHeader = 'Basic ' + Buffer.from(`${account.email}:${account.apiToken}`).toString('base64');

      const client: JiraClient = {
        host: account.host,
        email: account.email,
        apiToken: account.apiToken,
        async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
          const url = `${account.host}/rest/api/3${path}`;
          const response = await fetch(url, {
            method,
            headers: {
              'Authorization': authHeader,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Jira API error (${response.status}): ${errorText}`);
          }

          if (response.status === 204) {
            return {} as T;
          }

          return response.json() as Promise<T>;
        },
      };

      this.clients.set(key, client);
    }
    return this.clients.get(key)!;
  }

  clear() {
    this.clients.clear();
  }
}

// Global client managers
const slackManager = new SlackClientManager();
const googleManager = new GoogleClientManager();
const discordManager = new DiscordClientManager();
const linearManager = new LinearClientManager();
const notionManager = new NotionClientManager();
const jiraManager = new JiraClientManager();

// ============================================================================
// Create Tool Context
// ============================================================================

export async function createToolContext(): Promise<ToolContext> {
  const configPath = join(homedir(), '.majordomo', 'config.json');
  const content = await readFile(configPath, 'utf-8');
  const config: MajordomoConfig = JSON.parse(content);

  return {
    config,

    async getSlackClient(accountName?: string): Promise<WebClient> {
      const accounts = config.accounts?.slack || [];
      if (accounts.length === 0) {
        throw new Error('No Slack accounts configured. Run: npm run setup');
      }
      const account = slackResolver.resolve(accounts, accountName);
      if (!account) {
        throw new Error(`Slack account not found: ${accountName || 'default'}`);
      }
      return slackManager.get(account);
    },

    async getGmailClient(accountName?: string): Promise<gmail_v1.Gmail> {
      const accounts = config.accounts?.google || [];
      if (accounts.length === 0) {
        throw new Error('No Google accounts configured. Run: npm run setup');
      }
      const account = googleResolver.resolve(accounts, accountName);
      if (!account) {
        throw new Error(`Google account not found: ${accountName || 'default'}`);
      }
      return googleManager.getGmail(account);
    },

    async getCalendarClient(accountName?: string): Promise<calendar_v3.Calendar> {
      const accounts = config.accounts?.google || [];
      if (accounts.length === 0) {
        throw new Error('No Google accounts configured. Run: npm run setup');
      }
      const account = googleResolver.resolve(accounts, accountName);
      if (!account) {
        throw new Error(`Google account not found: ${accountName || 'default'}`);
      }
      return googleManager.getCalendar(account);
    },

    async getDiscordClient(accountName?: string): Promise<DiscordClient> {
      const accounts = config.accounts?.discord || [];
      if (accounts.length === 0) {
        throw new Error('No Discord accounts configured. Run: npm run setup');
      }
      const account = discordResolver.resolve(accounts, accountName);
      if (!account) {
        throw new Error(`Discord account not found: ${accountName || 'default'}`);
      }
      return discordManager.get(account);
    },

    async getLinearClient(accountName?: string): Promise<LinearClient> {
      const accounts = config.accounts?.linear || [];
      if (accounts.length === 0) {
        throw new Error('No Linear accounts configured. Run: npm run setup');
      }
      const account = linearResolver.resolve(accounts, accountName);
      if (!account) {
        throw new Error(`Linear account not found: ${accountName || 'default'}`);
      }
      return linearManager.get(account);
    },

    async getNotionClient(accountName?: string): Promise<NotionClient> {
      const accounts = config.accounts?.notion || [];
      if (accounts.length === 0) {
        throw new Error('No Notion accounts configured. Run: npm run setup');
      }
      const account = notionResolver.resolve(accounts, accountName);
      if (!account) {
        throw new Error(`Notion account not found: ${accountName || 'default'}`);
      }
      return notionManager.get(account);
    },

    async getJiraClient(accountName?: string): Promise<JiraClient> {
      const accounts = config.accounts?.jira || [];
      if (accounts.length === 0) {
        throw new Error('No Jira accounts configured. Run: npm run setup');
      }
      const account = jiraResolver.resolve(accounts, accountName);
      if (!account) {
        throw new Error(`Jira account not found: ${accountName || 'default'}`);
      }
      return jiraManager.get(account);
    },
  };
}

// ============================================================================
// Account Summary for System Prompt
// ============================================================================

export function getAccountSummary(config: MajordomoConfig): string {
  const lines: string[] = [];

  const accounts = config.accounts;
  if (!accounts) {
    return 'No accounts configured.';
  }

  if (accounts.slack && accounts.slack.length > 0) {
    const slackSummary = accounts.slack.map(a => {
      const marker = a.isDefault ? ' (default)' : '';
      return `    - ${a.name}${marker}: ${a.workspaceName || 'Slack workspace'}`;
    }).join('\n');
    lines.push(`  Slack:\n${slackSummary}`);
  }

  if (accounts.google && accounts.google.length > 0) {
    const googleSummary = accounts.google.map(a => {
      const marker = a.isDefault ? ' (default)' : '';
      return `    - ${a.name}${marker}: ${a.email || 'Google account'}`;
    }).join('\n');
    lines.push(`  Google (Email/Calendar):\n${googleSummary}`);
  }

  if (accounts.discord && accounts.discord.length > 0) {
    const discordSummary = accounts.discord.map(a => {
      const marker = a.isDefault ? ' (default)' : '';
      return `    - ${a.name}${marker}`;
    }).join('\n');
    lines.push(`  Discord:\n${discordSummary}`);
  }

  if (accounts.linear && accounts.linear.length > 0) {
    const linearSummary = accounts.linear.map(a => {
      const marker = a.isDefault ? ' (default)' : '';
      return `    - ${a.name}${marker}`;
    }).join('\n');
    lines.push(`  Linear:\n${linearSummary}`);
  }

  if (accounts.notion && accounts.notion.length > 0) {
    const notionSummary = accounts.notion.map(a => {
      const marker = a.isDefault ? ' (default)' : '';
      return `    - ${a.name}${marker}`;
    }).join('\n');
    lines.push(`  Notion:\n${notionSummary}`);
  }

  if (lines.length === 0) {
    return 'No accounts configured.';
  }

  return `Configured accounts:\n${lines.join('\n')}`;
}

// ============================================================================
// Cleanup
// ============================================================================

export function clearAllClients() {
  slackManager.clear();
  googleManager.clear();
  discordManager.clear();
  linearManager.clear();
  notionManager.clear();
}
