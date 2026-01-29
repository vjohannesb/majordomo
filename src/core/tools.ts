/**
 * Tools - Built-in integrations that Majordomo can execute
 *
 * These are NOT MCP servers. Majordomo owns and executes these directly.
 * Claude Code decides what to call, Majordomo does the execution.
 */

import { WebClient } from '@slack/web-api';
import { google } from 'googleapis';
import { DEBUG } from './brain.js';

function debug(...args: unknown[]) {
  if (DEBUG) {
    console.log('\x1b[90m[tools]\x1b[0m', ...args);
  }
}
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Tool, ToolCall } from './brain.js';

// ============================================================================
// Tool Registry
// ============================================================================

export const AVAILABLE_TOOLS: Tool[] = [
  // Slack tools
  {
    name: 'slack_send_dm',
    description: 'Send a direct message to someone on Slack. Messages are sent as YOU, not a bot.',
    parameters: {
      recipient: { type: 'string', description: 'Name or email of the person', required: true },
      message: { type: 'string', description: 'The message to send', required: true },
    },
  },
  {
    name: 'slack_send_channel',
    description: 'Send a message to a Slack channel or DM',
    parameters: {
      channel: { type: 'string', description: 'Channel name, #channel, or channel ID (e.g., D02T7C7RR3P)', required: true },
      message: { type: 'string', description: 'The message to send', required: true },
    },
  },
  {
    name: 'slack_list_users',
    description: 'List users in the Slack workspace to find someone',
    parameters: {
      query: { type: 'string', description: 'Optional filter by name' },
    },
  },
  {
    name: 'slack_read_dms',
    description: 'Read recent DMs from a specific person',
    parameters: {
      user: { type: 'string', description: 'Name or email of the person', required: true },
      limit: { type: 'number', description: 'Number of messages (default 10)' },
    },
  },
  {
    name: 'slack_read_channel',
    description: 'Read recent messages from a Slack channel',
    parameters: {
      channel: { type: 'string', description: 'Channel name', required: true },
      limit: { type: 'number', description: 'Number of messages (default 10)' },
    },
  },
  {
    name: 'slack_list_channels',
    description: 'List Slack channels you are a member of',
    parameters: {},
  },

  // Email tools (Gmail)
  {
    name: 'email_send',
    description: 'Send an email via Gmail. Sends as YOU.',
    parameters: {
      to: { type: 'string', description: 'Recipient email address', required: true },
      subject: { type: 'string', description: 'Email subject line', required: true },
      body: { type: 'string', description: 'Email body (plain text)', required: true },
    },
  },
  {
    name: 'email_list',
    description: 'List recent emails from your inbox',
    parameters: {
      limit: { type: 'number', description: 'Number of emails to fetch (default 10)' },
      query: { type: 'string', description: 'Search query (e.g., "from:bob" or "is:unread")' },
    },
  },
  {
    name: 'email_read',
    description: 'Read a specific email by ID',
    parameters: {
      id: { type: 'string', description: 'Email ID from email_list', required: true },
    },
  },
  {
    name: 'email_search',
    description: 'Search emails with Gmail search syntax',
    parameters: {
      query: { type: 'string', description: 'Search query (e.g., "from:bob subject:meeting")', required: true },
      limit: { type: 'number', description: 'Max results (default 10)' },
    },
  },

  // Calendar tools (Google Calendar)
  {
    name: 'calendar_list',
    description: 'List upcoming calendar events',
    parameters: {
      days: { type: 'number', description: 'Number of days to look ahead (default 7)' },
      limit: { type: 'number', description: 'Max events to return (default 10)' },
    },
  },
  {
    name: 'calendar_create',
    description: 'Create a new calendar event',
    parameters: {
      title: { type: 'string', description: 'Event title', required: true },
      start: { type: 'string', description: 'Start time (e.g., "2024-01-15 14:00" or "tomorrow 2pm")', required: true },
      end: { type: 'string', description: 'End time (e.g., "2024-01-15 15:00" or "tomorrow 3pm")' },
      description: { type: 'string', description: 'Event description' },
      attendees: { type: 'string', description: 'Comma-separated email addresses of attendees' },
    },
  },
  {
    name: 'calendar_delete',
    description: 'Delete a calendar event by ID',
    parameters: {
      id: { type: 'string', description: 'Event ID from calendar_list', required: true },
    },
  },

  // TODO: Add more tools
  // - linear_list_issues
  // - linear_create_issue
];

// ============================================================================
// Tool Executor
// ============================================================================

interface SlackConfig {
  userToken?: string;
  botToken?: string;
}

let slackClient: WebClient | null = null;
let slackConfig: SlackConfig | null = null;

async function getSlackClient(): Promise<WebClient> {
  if (slackClient) return slackClient;

  const configPath = join(homedir(), '.majordomo', 'config.json');
  const content = await readFile(configPath, 'utf-8');
  const config = JSON.parse(content);
  slackConfig = config.slack || {};

  const token = slackConfig?.userToken || slackConfig?.botToken;
  if (!token) {
    throw new Error('No Slack token configured. Run: npm run setup');
  }

  slackClient = new WebClient(token);
  return slackClient;
}

async function findSlackUser(slack: WebClient, query: string) {
  const result = await slack.users.list({});
  const users = result.members || [];
  const q = query.toLowerCase();

  return users.find(u =>
    u.name?.toLowerCase() === q ||
    u.real_name?.toLowerCase().includes(q) ||
    u.profile?.display_name?.toLowerCase() === q ||
    u.profile?.email?.toLowerCase() === q
  );
}

async function findSlackChannel(slack: WebClient, name: string): Promise<{ id: string; name?: string } | undefined> {
  const channelName = name.replace(/^#/, '');

  // If it looks like a channel ID (starts with C, D, G), use it directly
  if (/^[CDG][A-Z0-9]+$/.test(channelName)) {
    return { id: channelName, name: channelName };
  }

  // Otherwise, look up by name
  const result = await slack.conversations.list({
    types: 'public_channel,private_channel',
  });

  const channel = (result.channels || []).find(c => c.name?.toLowerCase() === channelName.toLowerCase());
  if (channel?.id) {
    return { id: channel.id, name: channel.name };
  }
  return undefined;
}

// ============================================================================
// Google (Gmail + Calendar) Client
// ============================================================================

interface GoogleConfig {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
}

import type { OAuth2Client } from 'google-auth-library';
import type { gmail_v1, calendar_v3 } from 'googleapis';

let googleAuth: OAuth2Client | null = null;
let gmailClient: gmail_v1.Gmail | null = null;
let calendarClient: calendar_v3.Calendar | null = null;

async function getGoogleAuth() {
  if (googleAuth) return googleAuth;

  const configPath = join(homedir(), '.majordomo', 'config.json');
  const content = await readFile(configPath, 'utf-8');
  const config = JSON.parse(content);
  const googleConfig: GoogleConfig = config.google || {};

  if (!googleConfig.clientId || !googleConfig.clientSecret || !googleConfig.refreshToken) {
    throw new Error('Google not configured. Run: npm run setup');
  }

  const oauth2Client = new google.auth.OAuth2(
    googleConfig.clientId,
    googleConfig.clientSecret,
    'http://localhost:3456/callback'
  );

  oauth2Client.setCredentials({
    refresh_token: googleConfig.refreshToken,
  });

  googleAuth = oauth2Client;
  return oauth2Client;
}

async function getGmailClient() {
  if (gmailClient) return gmailClient;
  const auth = await getGoogleAuth();
  gmailClient = google.gmail({ version: 'v1', auth });
  return gmailClient;
}

async function getCalendarClient() {
  if (calendarClient) return calendarClient;
  const auth = await getGoogleAuth();
  calendarClient = google.calendar({ version: 'v3', auth });
  return calendarClient;
}

function parseDateTime(input: string): Date {
  // Try parsing as ISO date first
  const directParse = new Date(input);
  if (!isNaN(directParse.getTime())) {
    return directParse;
  }

  // Handle relative dates like "tomorrow 2pm"
  const now = new Date();
  const lower = input.toLowerCase();

  if (lower.includes('tomorrow')) {
    now.setDate(now.getDate() + 1);
  } else if (lower.includes('today')) {
    // keep today
  }

  // Extract time like "2pm", "14:00", "2:30pm"
  const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (timeMatch && timeMatch[1]) {
    let hours = parseInt(timeMatch[1], 10);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const meridiem = timeMatch[3]?.toLowerCase();

    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;

    now.setHours(hours, minutes, 0, 0);
  }

  return now;
}

// ============================================================================
// Execute a tool call
// ============================================================================

export async function executeTool(call: ToolCall): Promise<string> {
  const { tool, params } = call;

  debug('--- Executing Tool ---');
  debug('Tool:', tool);
  debug('Params:', JSON.stringify(params, null, 2));

  try {
    switch (tool) {
      // ---- Slack ----
      case 'slack_send_dm': {
        const slack = await getSlackClient();
        const { recipient, message } = params as { recipient: string; message: string };

        const user = await findSlackUser(slack, recipient);
        if (!user?.id) {
          return `Could not find user: ${recipient}`;
        }

        const dm = await slack.conversations.open({ users: user.id });
        if (!dm.channel?.id) {
          return 'Failed to open DM channel';
        }

        await slack.chat.postMessage({
          channel: dm.channel.id,
          text: message,
        });

        return `Sent to ${user.real_name || user.name}: "${message}"`;
      }

      case 'slack_send_channel': {
        const slack = await getSlackClient();
        const { channel, message } = params as { channel: string; message: string };

        const chan = await findSlackChannel(slack, channel);
        if (!chan?.id) {
          return `Could not find channel: ${channel}`;
        }

        await slack.chat.postMessage({
          channel: chan.id,
          text: message,
        });

        const displayName = chan.name?.startsWith('D') || chan.name?.startsWith('C') || chan.name?.startsWith('G')
          ? chan.id
          : `#${chan.name}`;
        return `Sent to ${displayName}: "${message}"`;
      }

      case 'slack_list_users': {
        const slack = await getSlackClient();
        const { query } = params as { query?: string };

        const result = await slack.users.list({});
        let users = (result.members || []).filter(u => !u.is_bot && !u.deleted);

        if (query) {
          const q = query.toLowerCase();
          users = users.filter(u =>
            u.name?.toLowerCase().includes(q) ||
            u.real_name?.toLowerCase().includes(q) ||
            u.profile?.display_name?.toLowerCase().includes(q)
          );
        }

        return users.slice(0, 15).map(u =>
          `${u.real_name || u.name} (@${u.name})`
        ).join('\n') || 'No users found';
      }

      case 'slack_read_dms': {
        const slack = await getSlackClient();
        const { user: userQuery, limit = 10 } = params as { user: string; limit?: number };

        const user = await findSlackUser(slack, userQuery);
        if (!user?.id) {
          return `Could not find user: ${userQuery}`;
        }

        const dm = await slack.conversations.open({ users: user.id });
        if (!dm.channel?.id) {
          return 'Failed to open DM channel';
        }

        const history = await slack.conversations.history({
          channel: dm.channel.id,
          limit,
        });

        const messages = await formatSlackMessages(slack, history.messages || []);
        return `DMs with ${user.real_name || user.name}:\n${messages}`;
      }

      case 'slack_read_channel': {
        const slack = await getSlackClient();
        const { channel, limit = 10 } = params as { channel: string; limit?: number };

        const chan = await findSlackChannel(slack, channel);
        if (!chan?.id) {
          return `Could not find channel: ${channel}`;
        }

        const history = await slack.conversations.history({
          channel: chan.id,
          limit,
        });

        const messages = await formatSlackMessages(slack, history.messages || []);
        return `#${chan.name}:\n${messages}`;
      }

      case 'slack_list_channels': {
        const slack = await getSlackClient();

        const result = await slack.conversations.list({
          types: 'public_channel,private_channel',
          exclude_archived: true,
        });

        return (result.channels || [])
          .filter(c => c.is_member)
          .slice(0, 20)
          .map(c => `#${c.name}`)
          .join('\n') || 'No channels found';
      }

      // ---- Email (Gmail) ----
      case 'email_send': {
        const gmail = await getGmailClient();
        const { to, subject, body } = params as { to: string; subject: string; body: string };

        const message = [
          `To: ${to}`,
          `Subject: ${subject}`,
          '',
          body,
        ].join('\n');

        const encodedMessage = Buffer.from(message)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        await gmail.users.messages.send({
          userId: 'me',
          requestBody: {
            raw: encodedMessage,
          },
        });

        return `Email sent to ${to}: "${subject}"`;
      }

      case 'email_list': {
        const gmail = await getGmailClient();
        const { limit = 10, query } = params as { limit?: number; query?: string };

        const response = await gmail.users.messages.list({
          userId: 'me',
          maxResults: limit,
          q: query || 'in:inbox',
        });

        const messages = (response.data.messages || []).filter(m => m.id);
        if (messages.length === 0) {
          return 'No emails found';
        }

        const emailSummaries = await Promise.all(
          messages.slice(0, limit).map(async (msg) => {
            const detail = await gmail.users.messages.get({
              userId: 'me',
              id: msg.id as string,
              format: 'metadata',
              metadataHeaders: ['From', 'Subject', 'Date'],
            });

            const headers = detail.data.payload?.headers || [];
            const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
            const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
            const date = headers.find(h => h.name === 'Date')?.value || '';

            return `[${msg.id}] ${from}\n  Subject: ${subject}\n  Date: ${date}`;
          })
        );

        return emailSummaries.join('\n\n');
      }

      case 'email_read': {
        const gmail = await getGmailClient();
        const { id } = params as { id: string };

        const response = await gmail.users.messages.get({
          userId: 'me',
          id,
          format: 'full',
        });

        const headers = response.data.payload?.headers || [];
        const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
        const to = headers.find(h => h.name === 'To')?.value || 'Unknown';
        const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
        const date = headers.find(h => h.name === 'Date')?.value || '';

        // Extract body
        let body = '';
        const payload = response.data.payload;
        if (payload?.body?.data) {
          body = Buffer.from(payload.body.data, 'base64').toString('utf-8');
        } else if (payload?.parts) {
          const textPart = payload.parts.find(p => p.mimeType === 'text/plain');
          if (textPart?.body?.data) {
            body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
          }
        }

        return `From: ${from}\nTo: ${to}\nSubject: ${subject}\nDate: ${date}\n\n${body}`;
      }

      case 'email_search': {
        const gmail = await getGmailClient();
        const { query, limit = 10 } = params as { query: string; limit?: number };

        const response = await gmail.users.messages.list({
          userId: 'me',
          maxResults: limit,
          q: query,
        });

        const messages = (response.data.messages || []).filter(m => m.id);
        if (messages.length === 0) {
          return `No emails found for: ${query}`;
        }

        const emailSummaries = await Promise.all(
          messages.slice(0, limit).map(async (msg) => {
            const detail = await gmail.users.messages.get({
              userId: 'me',
              id: msg.id as string,
              format: 'metadata',
              metadataHeaders: ['From', 'Subject', 'Date'],
            });

            const headers = detail.data.payload?.headers || [];
            const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
            const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';

            return `[${msg.id}] ${from} - ${subject}`;
          })
        );

        return emailSummaries.join('\n');
      }

      // ---- Calendar (Google Calendar) ----
      case 'calendar_list': {
        const calendar = await getCalendarClient();
        const { days = 7, limit = 10 } = params as { days?: number; limit?: number };

        const now = new Date();
        const future = new Date();
        future.setDate(future.getDate() + days);

        const response = await calendar.events.list({
          calendarId: 'primary',
          timeMin: now.toISOString(),
          timeMax: future.toISOString(),
          maxResults: limit,
          singleEvents: true,
          orderBy: 'startTime',
        });

        const events = response.data.items || [];
        if (events.length === 0) {
          return `No events in the next ${days} days`;
        }

        return events.map(event => {
          const start = event.start?.dateTime || event.start?.date || '';
          const startDate = new Date(start);
          const dateStr = startDate.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          });
          const timeStr = event.start?.dateTime
            ? startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
            : 'All day';

          return `[${event.id}] ${dateStr} ${timeStr} - ${event.summary || '(no title)'}`;
        }).join('\n');
      }

      case 'calendar_create': {
        const calendar = await getCalendarClient();
        const { title, start, end, description, attendees } = params as {
          title: string;
          start: string;
          end?: string;
          description?: string;
          attendees?: string;
        };

        const startDate = parseDateTime(start);
        const endDate = end ? parseDateTime(end) : new Date(startDate.getTime() + 60 * 60 * 1000); // Default 1 hour

        const event: {
          summary: string;
          start: { dateTime: string; timeZone: string };
          end: { dateTime: string; timeZone: string };
          description?: string;
          attendees?: { email: string }[];
        } = {
          summary: title,
          start: {
            dateTime: startDate.toISOString(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
          end: {
            dateTime: endDate.toISOString(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        };

        if (description) {
          event.description = description;
        }

        if (attendees) {
          event.attendees = attendees.split(',').map(email => ({ email: email.trim() }));
        }

        const response = await calendar.events.insert({
          calendarId: 'primary',
          requestBody: event,
        });

        const created = response.data;
        return `Created event: "${created.summary}" on ${startDate.toLocaleDateString()} at ${startDate.toLocaleTimeString()}`;
      }

      case 'calendar_delete': {
        const calendar = await getCalendarClient();
        const { id } = params as { id: string };

        await calendar.events.delete({
          calendarId: 'primary',
          eventId: id,
        });

        return `Deleted event: ${id}`;
      }

      default:
        debug('Unknown tool:', tool);
        return `Unknown tool: ${tool}`;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    debug('Tool error:', message);
    return `Error: ${message}`;
  }
}

async function formatSlackMessages(
  slack: WebClient,
  messages: Array<{ user?: string; text?: string; ts?: string }>
): Promise<string> {
  const userCache = new Map<string, string>();

  const formatted = await Promise.all(
    messages.reverse().map(async (m) => {
      let userName = 'Unknown';
      if (m.user) {
        if (!userCache.has(m.user)) {
          try {
            const info = await slack.users.info({ user: m.user });
            userCache.set(m.user, info.user?.real_name || info.user?.name || m.user);
          } catch {
            userCache.set(m.user, m.user);
          }
        }
        userName = userCache.get(m.user) || m.user;
      }

      const time = m.ts ? new Date(parseFloat(m.ts) * 1000).toLocaleTimeString() : '';
      return `[${time}] ${userName}: ${m.text}`;
    })
  );

  return formatted.join('\n');
}
