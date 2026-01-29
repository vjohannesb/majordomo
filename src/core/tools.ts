/**
 * Tools - Built-in integrations that Majordomo can execute
 *
 * These are NOT MCP servers. Majordomo owns and executes these directly.
 * Claude Code decides what to call, Majordomo does the execution.
 *
 * All tools support an optional `account` parameter for multi-account support.
 */

import { WebClient } from '@slack/web-api';
import { Client as DiscordClient, ChannelType, TextChannel } from 'discord.js';
import type { ToolContext } from './accounts.js';
import { getMemoryStore, type Memory } from '../memory/index.js';

// Debug mode
const DEBUG = process.env.MAJORDOMO_DEBUG === '1' || process.env.DEBUG === '1';

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, {
    type: string;
    description: string;
    required?: boolean;
  }>;
}

export interface ToolCall {
  tool: string;
  params: Record<string, unknown>;
}

function debug(...args: unknown[]) {
  if (DEBUG) {
    console.log('\x1b[90m[tools]\x1b[0m', ...args);
  }
}

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
      account: { type: 'string', description: 'Account name (uses default if not specified)' },
    },
  },
  {
    name: 'slack_send_channel',
    description: 'Send a message to a Slack channel or DM',
    parameters: {
      channel: { type: 'string', description: 'Channel name, #channel, or channel ID (e.g., D02T7C7RR3P)', required: true },
      message: { type: 'string', description: 'The message to send', required: true },
      account: { type: 'string', description: 'Account name (uses default if not specified)' },
    },
  },
  {
    name: 'slack_list_users',
    description: 'List users in the Slack workspace to find someone',
    parameters: {
      query: { type: 'string', description: 'Optional filter by name' },
      account: { type: 'string', description: 'Account name (uses default if not specified)' },
    },
  },
  {
    name: 'slack_read_dms',
    description: 'Read recent DMs from a specific person',
    parameters: {
      user: { type: 'string', description: 'Name or email of the person', required: true },
      limit: { type: 'number', description: 'Number of messages (default 10)' },
      account: { type: 'string', description: 'Account name (uses default if not specified)' },
    },
  },
  {
    name: 'slack_read_channel',
    description: 'Read recent messages from a Slack channel',
    parameters: {
      channel: { type: 'string', description: 'Channel name', required: true },
      limit: { type: 'number', description: 'Number of messages (default 10)' },
      account: { type: 'string', description: 'Account name (uses default if not specified)' },
    },
  },
  {
    name: 'slack_list_channels',
    description: 'List Slack channels you are a member of',
    parameters: {
      account: { type: 'string', description: 'Account name (uses default if not specified)' },
    },
  },

  // Email tools (Gmail)
  {
    name: 'email_send',
    description: 'Send an email via Gmail. Sends as YOU.',
    parameters: {
      to: { type: 'string', description: 'Recipient email address', required: true },
      subject: { type: 'string', description: 'Email subject line', required: true },
      body: { type: 'string', description: 'Email body (plain text)', required: true },
      account: { type: 'string', description: 'Account name (uses default if not specified)' },
    },
  },
  {
    name: 'email_list',
    description: 'List recent emails from your inbox',
    parameters: {
      limit: { type: 'number', description: 'Number of emails to fetch (default 10)' },
      query: { type: 'string', description: 'Search query (e.g., "from:bob" or "is:unread")' },
      account: { type: 'string', description: 'Account name (uses default if not specified)' },
    },
  },
  {
    name: 'email_read',
    description: 'Read a specific email by ID',
    parameters: {
      id: { type: 'string', description: 'Email ID from email_list', required: true },
      account: { type: 'string', description: 'Account name (uses default if not specified)' },
    },
  },
  {
    name: 'email_search',
    description: 'Search emails with Gmail search syntax',
    parameters: {
      query: { type: 'string', description: 'Search query (e.g., "from:bob subject:meeting")', required: true },
      limit: { type: 'number', description: 'Max results (default 10)' },
      account: { type: 'string', description: 'Account name (uses default if not specified)' },
    },
  },

  // Calendar tools (Google Calendar)
  {
    name: 'calendar_list',
    description: 'List upcoming calendar events',
    parameters: {
      days: { type: 'number', description: 'Number of days to look ahead (default 7)' },
      limit: { type: 'number', description: 'Max events to return (default 10)' },
      account: { type: 'string', description: 'Account name (uses default if not specified)' },
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
      account: { type: 'string', description: 'Account name (uses default if not specified)' },
    },
  },
  {
    name: 'calendar_delete',
    description: 'Delete a calendar event by ID',
    parameters: {
      id: { type: 'string', description: 'Event ID from calendar_list', required: true },
      account: { type: 'string', description: 'Account name (uses default if not specified)' },
    },
  },

  // Discord tools
  {
    name: 'discord_send_message',
    description: 'Send a message to a Discord channel or user DM',
    parameters: {
      target: { type: 'string', description: 'Channel name, channel ID, or username for DM', required: true },
      message: { type: 'string', description: 'The message to send', required: true },
      account: { type: 'string', description: 'Account name (uses default if not specified)' },
    },
  },
  {
    name: 'discord_list_servers',
    description: 'List Discord servers (guilds) the bot is in',
    parameters: {
      account: { type: 'string', description: 'Account name (uses default if not specified)' },
    },
  },
  {
    name: 'discord_read_channel',
    description: 'Read recent messages from a Discord channel',
    parameters: {
      channel: { type: 'string', description: 'Channel name or ID', required: true },
      server: { type: 'string', description: 'Server name or ID (required if using channel name)' },
      limit: { type: 'number', description: 'Number of messages (default 10)' },
      account: { type: 'string', description: 'Account name (uses default if not specified)' },
    },
  },

  // Linear tools
  {
    name: 'linear_list_issues',
    description: 'List or search Linear issues',
    parameters: {
      query: { type: 'string', description: 'Search query' },
      status: { type: 'string', description: 'Filter by status (e.g., "In Progress", "Todo")' },
      assignee: { type: 'string', description: 'Filter by assignee (use "me" for yourself)' },
      limit: { type: 'number', description: 'Max results (default 10)' },
      account: { type: 'string', description: 'Account name (uses default if not specified)' },
    },
  },
  {
    name: 'linear_create_issue',
    description: 'Create a new Linear issue',
    parameters: {
      title: { type: 'string', description: 'Issue title', required: true },
      description: { type: 'string', description: 'Issue description (Markdown supported)' },
      team: { type: 'string', description: 'Team name or ID', required: true },
      status: { type: 'string', description: 'Initial status' },
      priority: { type: 'number', description: 'Priority (0=none, 1=urgent, 2=high, 3=medium, 4=low)' },
      assignee: { type: 'string', description: 'Assignee (use "me" for yourself)' },
      account: { type: 'string', description: 'Account name (uses default if not specified)' },
    },
  },
  {
    name: 'linear_update_issue',
    description: 'Update an existing Linear issue',
    parameters: {
      id: { type: 'string', description: 'Issue ID or identifier (e.g., "ENG-123")', required: true },
      title: { type: 'string', description: 'New title' },
      description: { type: 'string', description: 'New description' },
      status: { type: 'string', description: 'New status' },
      priority: { type: 'number', description: 'New priority (0=none, 1=urgent, 2=high, 3=medium, 4=low)' },
      assignee: { type: 'string', description: 'New assignee (use "me" for yourself, empty to unassign)' },
      account: { type: 'string', description: 'Account name (uses default if not specified)' },
    },
  },

  // Notion tools
  {
    name: 'notion_search',
    description: 'Search Notion pages and databases',
    parameters: {
      query: { type: 'string', description: 'Search query', required: true },
      limit: { type: 'number', description: 'Max results (default 10)' },
      account: { type: 'string', description: 'Account name (uses default if not specified)' },
    },
  },
  {
    name: 'notion_read_page',
    description: 'Read a Notion page content',
    parameters: {
      id: { type: 'string', description: 'Page ID or URL', required: true },
      account: { type: 'string', description: 'Account name (uses default if not specified)' },
    },
  },
  {
    name: 'notion_create_page',
    description: 'Create a new Notion page in a database',
    parameters: {
      database: { type: 'string', description: 'Database ID or name', required: true },
      title: { type: 'string', description: 'Page title', required: true },
      properties: { type: 'string', description: 'JSON string of additional properties' },
      content: { type: 'string', description: 'Page content (Markdown)' },
      account: { type: 'string', description: 'Account name (uses default if not specified)' },
    },
  },

  // Memory tools
  {
    name: 'memory_remember',
    description: 'Store a fact, note, or task in long-term memory. Use this to remember important information about the user.',
    parameters: {
      type: { type: 'string', description: 'Type: fact, note, or task', required: true },
      content: { type: 'string', description: 'What to remember', required: true },
      tags: { type: 'string', description: 'Comma-separated tags for categorization' },
    },
  },
  {
    name: 'memory_search',
    description: 'Search long-term memory for relevant information. Use before answering questions about past conversations or user preferences.',
    parameters: {
      query: { type: 'string', description: 'Search query', required: true },
      type: { type: 'string', description: 'Filter by type: fact, note, task, or conversation' },
      limit: { type: 'number', description: 'Max results (default 5)' },
    },
  },
  {
    name: 'memory_list',
    description: 'List all memories of a given type',
    parameters: {
      type: { type: 'string', description: 'Type: fact, note, task, or conversation', required: true },
    },
  },
  {
    name: 'memory_forget',
    description: 'Delete a memory by ID',
    parameters: {
      id: { type: 'string', description: 'Memory ID to delete', required: true },
    },
  },
];

// ============================================================================
// Helper Functions
// ============================================================================

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

// Discord helpers
async function findDiscordChannel(discord: DiscordClient, channelRef: string, serverRef?: string): Promise<TextChannel | null> {
  // If it looks like a channel ID
  if (/^\d+$/.test(channelRef)) {
    const channel = await discord.channels.fetch(channelRef).catch(() => null);
    if (channel && channel.type === ChannelType.GuildText) {
      return channel as TextChannel;
    }
    return null;
  }

  // Need to search by name - requires server
  if (!serverRef) {
    return null;
  }

  // Find server
  const guild = discord.guilds.cache.find(g =>
    g.id === serverRef ||
    g.name.toLowerCase() === serverRef.toLowerCase()
  );

  if (!guild) {
    return null;
  }

  // Find channel in server
  const channel = guild.channels.cache.find(c =>
    c.name.toLowerCase() === channelRef.toLowerCase().replace(/^#/, '') &&
    c.type === ChannelType.GuildText
  );

  return channel as TextChannel | null;
}

// Extract page ID from Notion URL
function extractNotionPageId(idOrUrl: string): string {
  // If it looks like a URL
  if (idOrUrl.includes('notion.so') || idOrUrl.includes('notion.site')) {
    // Extract ID from URL - it's usually the last part after the page name
    const match = idOrUrl.match(/([a-f0-9]{32})/i);
    if (match && match[1]) {
      // Format as UUID
      const rawId = match[1];
      return `${rawId.slice(0, 8)}-${rawId.slice(8, 12)}-${rawId.slice(12, 16)}-${rawId.slice(16, 20)}-${rawId.slice(20)}`;
    }
  }
  return idOrUrl;
}

// ============================================================================
// Execute a tool call
// ============================================================================

export async function executeTool(call: ToolCall, ctx: ToolContext): Promise<string> {
  const { tool, params } = call;
  const account = params.account as string | undefined;

  debug('--- Executing Tool ---');
  debug('Tool:', tool);
  debug('Params:', JSON.stringify(params, null, 2));

  try {
    switch (tool) {
      // ---- Slack ----
      case 'slack_send_dm': {
        const slack = await ctx.getSlackClient(account);
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
        const slack = await ctx.getSlackClient(account);
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
        const slack = await ctx.getSlackClient(account);
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
        const slack = await ctx.getSlackClient(account);
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
        const slack = await ctx.getSlackClient(account);
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
        const slack = await ctx.getSlackClient(account);

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
        const gmail = await ctx.getGmailClient(account);
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
        const gmail = await ctx.getGmailClient(account);
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
        const gmail = await ctx.getGmailClient(account);
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
        const gmail = await ctx.getGmailClient(account);
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
        const calendar = await ctx.getCalendarClient(account);
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
        const calendar = await ctx.getCalendarClient(account);
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
        const calendar = await ctx.getCalendarClient(account);
        const { id } = params as { id: string };

        await calendar.events.delete({
          calendarId: 'primary',
          eventId: id,
        });

        return `Deleted event: ${id}`;
      }

      // ---- Discord ----
      case 'discord_send_message': {
        const discord = await ctx.getDiscordClient(account);
        const { target, message } = params as { target: string; message: string };

        // Try to find as channel first
        const channel = await findDiscordChannel(discord, target);
        if (channel) {
          await channel.send(message);
          return `Sent to #${channel.name}: "${message}"`;
        }

        // Try as user DM
        const user = discord.users.cache.find(u =>
          u.id === target ||
          u.username.toLowerCase() === target.toLowerCase() ||
          u.tag.toLowerCase() === target.toLowerCase()
        );

        if (user) {
          const dm = await user.createDM();
          await dm.send(message);
          return `Sent DM to ${user.tag}: "${message}"`;
        }

        return `Could not find channel or user: ${target}`;
      }

      case 'discord_list_servers': {
        const discord = await ctx.getDiscordClient(account);

        const servers = discord.guilds.cache.map(g => ({
          id: g.id,
          name: g.name,
          memberCount: g.memberCount,
        }));

        if (servers.length === 0) {
          return 'Bot is not in any servers';
        }

        return servers.map(s =>
          `${s.name} (${s.memberCount} members) [${s.id}]`
        ).join('\n');
      }

      case 'discord_read_channel': {
        const discord = await ctx.getDiscordClient(account);
        const { channel: channelRef, server, limit = 10 } = params as {
          channel: string;
          server?: string;
          limit?: number;
        };

        const channel = await findDiscordChannel(discord, channelRef, server);
        if (!channel) {
          return `Could not find channel: ${channelRef}${server ? ` in server ${server}` : ''}`;
        }

        const messages = await channel.messages.fetch({ limit });
        const formatted = messages.reverse().map(m =>
          `[${m.createdAt.toLocaleTimeString()}] ${m.author.tag}: ${m.content}`
        ).join('\n');

        return `#${channel.name}:\n${formatted}`;
      }

      // ---- Linear ----
      case 'linear_list_issues': {
        const linear = await ctx.getLinearClient(account);
        const { query, status, assignee, limit = 10 } = params as {
          query?: string;
          status?: string;
          assignee?: string;
          limit?: number;
        };

        let filter: Record<string, unknown> = {};

        if (status) {
          filter.state = { name: { eq: status } };
        }

        if (assignee) {
          if (assignee.toLowerCase() === 'me') {
            const me = await linear.viewer;
            filter.assignee = { id: { eq: me.id } };
          } else {
            filter.assignee = { name: { containsIgnoreCase: assignee } };
          }
        }

        let issues;
        if (query) {
          const searchResult = await linear.searchIssues(query, { first: limit });
          issues = searchResult.nodes;
        } else {
          const result = await linear.issues({
            first: limit,
            filter: Object.keys(filter).length > 0 ? filter : undefined,
          });
          issues = result.nodes;
        }

        if (issues.length === 0) {
          return 'No issues found';
        }

        const formatted = await Promise.all(issues.map(async (issue) => {
          const state = await issue.state;
          const assigneeUser = await issue.assignee;
          return `[${issue.identifier}] ${issue.title}\n  Status: ${state?.name || 'Unknown'} | Assignee: ${assigneeUser?.name || 'Unassigned'} | Priority: ${issue.priority || 'None'}`;
        }));

        return formatted.join('\n\n');
      }

      case 'linear_create_issue': {
        const linear = await ctx.getLinearClient(account);
        const { title, description, team: teamName, status, priority, assignee } = params as {
          title: string;
          description?: string;
          team: string;
          status?: string;
          priority?: number;
          assignee?: string;
        };

        // Find team
        const teams = await linear.teams();
        const team = teams.nodes.find(t =>
          t.id === teamName ||
          t.name.toLowerCase() === teamName.toLowerCase() ||
          t.key.toLowerCase() === teamName.toLowerCase()
        );

        if (!team) {
          return `Could not find team: ${teamName}. Available teams: ${teams.nodes.map(t => t.name).join(', ')}`;
        }

        const issueData: {
          title: string;
          teamId: string;
          description?: string;
          stateId?: string;
          priority?: number;
          assigneeId?: string;
        } = {
          title,
          teamId: team.id,
        };

        if (description) {
          issueData.description = description;
        }

        if (status) {
          const states = await team.states();
          const state = states.nodes.find(s => s.name.toLowerCase() === status.toLowerCase());
          if (state) {
            issueData.stateId = state.id;
          }
        }

        if (priority !== undefined) {
          issueData.priority = priority;
        }

        if (assignee) {
          if (assignee.toLowerCase() === 'me') {
            const me = await linear.viewer;
            issueData.assigneeId = me.id;
          } else {
            const users = await linear.users();
            const user = users.nodes.find(u =>
              u.name.toLowerCase().includes(assignee.toLowerCase()) ||
              u.email?.toLowerCase().includes(assignee.toLowerCase())
            );
            if (user) {
              issueData.assigneeId = user.id;
            }
          }
        }

        const result = await linear.createIssue(issueData);
        const issue = await result.issue;

        return `Created issue: [${issue?.identifier}] ${issue?.title}`;
      }

      case 'linear_update_issue': {
        const linear = await ctx.getLinearClient(account);
        const { id, title, description, status, priority, assignee } = params as {
          id: string;
          title?: string;
          description?: string;
          status?: string;
          priority?: number;
          assignee?: string;
        };

        // Find the issue - we need the full Issue object for update
        let issueId: string | undefined;
        let issueIdentifier: string = id;
        let issueTitle: string = '';

        if (id.includes('-')) {
          // It's an identifier like "ENG-123" - search for it
          const searchResult = await linear.searchIssues(id, { first: 1 });
          const found = searchResult.nodes[0];
          if (found) {
            issueId = found.id;
            issueIdentifier = found.identifier;
            issueTitle = found.title;
          }
        } else {
          const found = await linear.issue(id);
          if (found) {
            issueId = found.id;
            issueIdentifier = found.identifier;
            issueTitle = found.title;
          }
        }

        if (!issueId) {
          return `Could not find issue: ${id}`;
        }

        const updateData: {
          title?: string;
          description?: string;
          stateId?: string;
          priority?: number;
          assigneeId?: string | null;
        } = {};

        if (title) {
          updateData.title = title;
        }

        if (description) {
          updateData.description = description;
        }

        if (status) {
          // Get teams and find the one that has this issue
          const teams = await linear.teams();
          for (const team of teams.nodes) {
            const states = await team.states();
            const state = states.nodes.find(s => s.name.toLowerCase() === status.toLowerCase());
            if (state) {
              updateData.stateId = state.id;
              break;
            }
          }
        }

        if (priority !== undefined) {
          updateData.priority = priority;
        }

        if (assignee !== undefined) {
          if (assignee === '') {
            updateData.assigneeId = null;
          } else if (assignee.toLowerCase() === 'me') {
            const me = await linear.viewer;
            updateData.assigneeId = me.id;
          } else {
            const users = await linear.users();
            const user = users.nodes.find(u =>
              u.name.toLowerCase().includes(assignee.toLowerCase()) ||
              u.email?.toLowerCase().includes(assignee.toLowerCase())
            );
            if (user) {
              updateData.assigneeId = user.id;
            }
          }
        }

        await linear.updateIssue(issueId, updateData);
        return `Updated issue: [${issueIdentifier}] ${title || issueTitle}`;
      }

      // ---- Notion ----
      case 'notion_search': {
        const notion = await ctx.getNotionClient(account);
        const { query, limit = 10 } = params as { query: string; limit?: number };

        const response = await notion.search({
          query,
          page_size: limit,
        });

        if (response.results.length === 0) {
          return `No results found for: ${query}`;
        }

        const formatted = response.results.map((page: unknown) => {
          const p = page as {
            id: string;
            object: string;
            properties?: {
              title?: { title?: Array<{ plain_text?: string }> };
              Name?: { title?: Array<{ plain_text?: string }> };
            };
            title?: Array<{ plain_text?: string }>;
          };
          let title = 'Untitled';

          if (p.object === 'page') {
            // Try to get title from properties
            const titleProp = p.properties?.title || p.properties?.Name;
            if (titleProp?.title?.[0]?.plain_text) {
              title = titleProp.title[0].plain_text;
            }
          } else if (p.object === 'database') {
            if (p.title?.[0]?.plain_text) {
              title = p.title[0].plain_text;
            }
          }

          return `[${p.object}] ${title} (${p.id})`;
        }).join('\n');

        return formatted;
      }

      case 'notion_read_page': {
        const notion = await ctx.getNotionClient(account);
        const { id: pageIdOrUrl } = params as { id: string };

        const pageId = extractNotionPageId(pageIdOrUrl);

        // Get page metadata
        const page = await notion.pages.retrieve({ page_id: pageId }) as {
          id: string;
          properties?: {
            title?: { title?: Array<{ plain_text?: string }> };
            Name?: { title?: Array<{ plain_text?: string }> };
          };
        };

        let title = 'Untitled';
        const titleProp = page.properties?.title || page.properties?.Name;
        if (titleProp?.title?.[0]?.plain_text) {
          title = titleProp.title[0].plain_text;
        }

        // Get page content (blocks)
        const blocks = await notion.blocks.children.list({ block_id: pageId });

        const content = blocks.results.map((block: unknown) => {
          const b = block as {
            type: string;
            paragraph?: { rich_text?: Array<{ plain_text?: string }> };
            heading_1?: { rich_text?: Array<{ plain_text?: string }> };
            heading_2?: { rich_text?: Array<{ plain_text?: string }> };
            heading_3?: { rich_text?: Array<{ plain_text?: string }> };
            bulleted_list_item?: { rich_text?: Array<{ plain_text?: string }> };
            numbered_list_item?: { rich_text?: Array<{ plain_text?: string }> };
            to_do?: { rich_text?: Array<{ plain_text?: string }>; checked?: boolean };
            code?: { rich_text?: Array<{ plain_text?: string }>; language?: string };
          };

          switch (b.type) {
            case 'paragraph':
              return b.paragraph?.rich_text?.map(t => t.plain_text).join('') || '';
            case 'heading_1':
              return `# ${b.heading_1?.rich_text?.map(t => t.plain_text).join('') || ''}`;
            case 'heading_2':
              return `## ${b.heading_2?.rich_text?.map(t => t.plain_text).join('') || ''}`;
            case 'heading_3':
              return `### ${b.heading_3?.rich_text?.map(t => t.plain_text).join('') || ''}`;
            case 'bulleted_list_item':
              return `• ${b.bulleted_list_item?.rich_text?.map(t => t.plain_text).join('') || ''}`;
            case 'numbered_list_item':
              return `1. ${b.numbered_list_item?.rich_text?.map(t => t.plain_text).join('') || ''}`;
            case 'to_do':
              const checked = b.to_do?.checked ? '✓' : '○';
              return `${checked} ${b.to_do?.rich_text?.map(t => t.plain_text).join('') || ''}`;
            case 'code':
              return `\`\`\`${b.code?.language || ''}\n${b.code?.rich_text?.map(t => t.plain_text).join('') || ''}\n\`\`\``;
            default:
              return `[${b.type}]`;
          }
        }).join('\n');

        return `# ${title}\n\n${content}`;
      }

      case 'notion_create_page': {
        const notion = await ctx.getNotionClient(account);
        const { database, title, properties: propsJson, content } = params as {
          database: string;
          title: string;
          properties?: string;
          content?: string;
        };

        // Find database
        let databaseId = database;
        if (!database.match(/^[a-f0-9-]{36}$/i)) {
          // Search for database by name
          const searchResult = await notion.search({
            query: database,
          });

          const db = searchResult.results.find((r: unknown) => {
            const result = r as { object: string; id: string };
            return result.object === 'database';
          }) as { id: string } | undefined;

          if (!db) {
            return `Could not find database: ${database}`;
          }
          databaseId = db.id;
        }

        // Parse additional properties if provided
        let additionalProps: Record<string, { title: Array<{ text: { content: string } }> }> = {};
        if (propsJson) {
          try {
            additionalProps = JSON.parse(propsJson);
          } catch {
            return `Invalid properties JSON: ${propsJson}`;
          }
        }

        // Create page with required properties
        const pageProperties: Record<string, { title: Array<{ text: { content: string } }> }> = {
          Name: {
            title: [{ text: { content: title } }],
          },
          ...additionalProps,
        };

        // Build children blocks if content provided
        const children = content ? content.split('\n').map(line => ({
          object: 'block' as const,
          type: 'paragraph' as const,
          paragraph: {
            rich_text: [{ type: 'text' as const, text: { content: line } }],
          },
        })) : undefined;

        const page = await notion.pages.create({
          parent: { database_id: databaseId },
          properties: pageProperties as Parameters<typeof notion.pages.create>[0]['properties'],
          ...(children ? { children } : {}),
        });

        return `Created page: ${title} (${page.id})`;
      }

      // Memory tools
      case 'memory_remember': {
        const { type, content, tags: tagsStr } = params as {
          type: string;
          content: string;
          tags?: string;
        };

        const validTypes = ['fact', 'note', 'task', 'conversation'];
        if (!validTypes.includes(type)) {
          return `Invalid type: ${type}. Must be one of: ${validTypes.join(', ')}`;
        }

        const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];
        const memory = getMemoryStore().add(type as Memory['type'], content, tags);

        return `Remembered (${type}): "${content.slice(0, 100)}${content.length > 100 ? '...' : ''}" [ID: ${memory.id.slice(0, 8)}]`;
      }

      case 'memory_search': {
        const { query, type, limit } = params as {
          query: string;
          type?: string;
          limit?: number;
        };

        const results = getMemoryStore().search(query, {
          type: type as Memory['type'] | undefined,
          limit: limit || 5,
        });

        if (results.length === 0) {
          return `No memories found for: "${query}"`;
        }

        const formatted = results.map((r, i) => {
          const m = r.memory;
          const tags = m.tags.length > 0 ? ` [${m.tags.join(', ')}]` : '';
          return `${i + 1}. [${m.type}] ${m.content.slice(0, 200)}${m.content.length > 200 ? '...' : ''}${tags}`;
        }).join('\n');

        return `Found ${results.length} memories:\n${formatted}`;
      }

      case 'memory_list': {
        const { type } = params as { type: string };

        const validTypes = ['fact', 'note', 'task', 'conversation'];
        if (!validTypes.includes(type)) {
          return `Invalid type: ${type}. Must be one of: ${validTypes.join(', ')}`;
        }

        const memories = getMemoryStore().listByType(type as Memory['type']);

        if (memories.length === 0) {
          return `No ${type}s stored.`;
        }

        const formatted = memories.map((m, i) => {
          const tags = m.tags.length > 0 ? ` [${m.tags.join(', ')}]` : '';
          return `${i + 1}. ${m.content.slice(0, 150)}${m.content.length > 150 ? '...' : ''}${tags} (ID: ${m.id.slice(0, 8)})`;
        }).join('\n');

        return `${type.charAt(0).toUpperCase() + type.slice(1)}s (${memories.length}):\n${formatted}`;
      }

      case 'memory_forget': {
        const { id } = params as { id: string };

        // Support partial ID matching
        const store = getMemoryStore();
        const allMemories = store.getAll();
        const match = allMemories.find(m => m.id.startsWith(id));

        if (!match) {
          return `Memory not found: ${id}`;
        }

        store.delete(match.id);
        return `Deleted memory: ${match.content.slice(0, 50)}...`;
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
