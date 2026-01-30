/**
 * MCP Routes
 *
 * Model Context Protocol endpoints for AI clients.
 */

import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import * as crypto from 'node:crypto';
import { getCurrentUser, validateApiKey } from '../auth.js';
import {
  addMemory,
  searchMemories,
  listMemories,
  deleteMemory,
  type Memory,
} from '../db.js';
import {
  listEmails,
  readEmail,
  searchEmails,
  sendEmail,
  listCalendarEvents,
  createCalendarEvent,
} from '../services/google.js';
import {
  listChannels as listSlackChannels,
  sendMessage as sendSlackMessage,
  readChannel as readSlackChannel,
} from '../services/slack.js';
import {
  listIssues as listLinearIssues,
  createIssue as createLinearIssue,
  updateIssue as updateLinearIssue,
} from '../services/linear.js';
import {
  searchNotion,
  readNotionPage,
  createNotionPage,
  listNotionDatabases,
  queryNotionDatabase,
} from '../services/notion.js';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Store for OAuth authorization codes (in production, use Redis/DB)
const authorizationCodes = new Map<string, { userId: string; clientId: string; redirectUri: string; expiresAt: number }>();
// Store for dynamically registered clients
const registeredClients = new Map<string, { clientId: string; clientSecret: string; redirectUris: string[] }>();
// Store for access tokens
const accessTokens = new Map<string, { userId: string; clientId: string; expiresAt: number }>();

export const mcpRoutes = new Hono();

// ============================================================================
// Tool Definitions
// ============================================================================

const TOOLS = [
  // Memory tools
  {
    name: 'memory_remember',
    description: 'Store a memory (fact, note, task, or conversation summary)',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['fact', 'note', 'task', 'conversation'],
          description: 'Type of memory',
        },
        content: { type: 'string', description: 'Content to remember' },
        tags: { type: 'string', description: 'Comma-separated tags' },
      },
      required: ['type', 'content'],
    },
  },
  {
    name: 'memory_search',
    description: 'Search memories using natural language',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        type: { type: 'string', enum: ['fact', 'note', 'task', 'conversation'] },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_list',
    description: 'List all memories of a specific type',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['fact', 'note', 'task', 'conversation'],
          description: 'Type of memories to list',
        },
      },
      required: ['type'],
    },
  },
  {
    name: 'memory_forget',
    description: 'Delete a memory by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Memory ID to delete' },
      },
      required: ['id'],
    },
  },
  // Email tools
  {
    name: 'email_list',
    description: 'List recent emails',
    inputSchema: {
      type: 'object',
      properties: {
        maxResults: { type: 'number', description: 'Max emails to return (default 10)' },
        account: { type: 'string', description: 'Account email (uses default if not specified)' },
      },
    },
  },
  {
    name: 'email_read',
    description: 'Read a specific email by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Email ID' },
        account: { type: 'string', description: 'Account email' },
      },
      required: ['id'],
    },
  },
  {
    name: 'email_search',
    description: 'Search emails with Gmail search syntax',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (e.g., "from:bob subject:meeting")' },
        limit: { type: 'number', description: 'Max results' },
        account: { type: 'string', description: 'Account email' },
      },
      required: ['query'],
    },
  },
  {
    name: 'email_send',
    description: 'Send an email',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body' },
        account: { type: 'string', description: 'Account email' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  // Calendar tools
  {
    name: 'calendar_list',
    description: 'List upcoming calendar events',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Days to look ahead (default 7)' },
        limit: { type: 'number', description: 'Max events' },
        account: { type: 'string', description: 'Account email' },
      },
    },
  },
  {
    name: 'calendar_create',
    description: 'Create a calendar event',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Event title' },
        start: { type: 'string', description: 'Start time (ISO 8601)' },
        end: { type: 'string', description: 'End time (ISO 8601)' },
        description: { type: 'string', description: 'Event description' },
        location: { type: 'string', description: 'Event location' },
        account: { type: 'string', description: 'Account email' },
      },
      required: ['title', 'start', 'end'],
    },
  },
  // Slack tools
  {
    name: 'slack_list_channels',
    description: 'List Slack channels in a workspace',
    inputSchema: {
      type: 'object',
      properties: {
        account: { type: 'string', description: 'Workspace name (uses default if not specified)' },
      },
    },
  },
  {
    name: 'slack_send_message',
    description: 'Send a message to a Slack channel',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel name (e.g., #general) or ID' },
        text: { type: 'string', description: 'Message text' },
        account: { type: 'string', description: 'Workspace name' },
      },
      required: ['channel', 'text'],
    },
  },
  {
    name: 'slack_read_channel',
    description: 'Read recent messages from a Slack channel',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel name or ID' },
        limit: { type: 'number', description: 'Max messages (default 20)' },
        account: { type: 'string', description: 'Workspace name' },
      },
      required: ['channel'],
    },
  },
  // Linear tools
  {
    name: 'linear_list_issues',
    description: 'List or search Linear issues',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (optional)' },
        limit: { type: 'number', description: 'Max issues (default 20)' },
        account: { type: 'string', description: 'Workspace name' },
      },
    },
  },
  {
    name: 'linear_create_issue',
    description: 'Create a new Linear issue',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Issue title' },
        description: { type: 'string', description: 'Issue description (markdown)' },
        teamId: { type: 'string', description: 'Team ID (uses default team if not specified)' },
        priority: { type: 'number', description: '0=None, 1=Urgent, 2=High, 3=Medium, 4=Low' },
        account: { type: 'string', description: 'Workspace name' },
      },
      required: ['title'],
    },
  },
  {
    name: 'linear_update_issue',
    description: 'Update a Linear issue',
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'Issue identifier (e.g., ENG-123)' },
        title: { type: 'string', description: 'New title' },
        description: { type: 'string', description: 'New description' },
        stateId: { type: 'string', description: 'New state ID' },
        priority: { type: 'number', description: 'New priority' },
        account: { type: 'string', description: 'Workspace name' },
      },
      required: ['issueId'],
    },
  },
  // Notion tools
  {
    name: 'notion_search',
    description: 'Search Notion for pages and databases',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (default 10)' },
        account: { type: 'string', description: 'Workspace name' },
      },
      required: ['query'],
    },
  },
  {
    name: 'notion_read_page',
    description: 'Read a Notion page content',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: 'Page ID' },
        account: { type: 'string', description: 'Workspace name' },
      },
      required: ['pageId'],
    },
  },
  {
    name: 'notion_create_page',
    description: 'Create a new Notion page',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Page title' },
        parentId: { type: 'string', description: 'Parent page or database ID' },
        content: { type: 'string', description: 'Page content (markdown-ish)' },
        account: { type: 'string', description: 'Workspace name' },
      },
      required: ['title', 'parentId'],
    },
  },
  {
    name: 'notion_list_databases',
    description: 'List Notion databases',
    inputSchema: {
      type: 'object',
      properties: {
        account: { type: 'string', description: 'Workspace name' },
      },
    },
  },
  {
    name: 'notion_query_database',
    description: 'Query items from a Notion database',
    inputSchema: {
      type: 'object',
      properties: {
        databaseId: { type: 'string', description: 'Database ID' },
        limit: { type: 'number', description: 'Max results (default 20)' },
        account: { type: 'string', description: 'Workspace name' },
      },
      required: ['databaseId'],
    },
  },
];

// ============================================================================
// Tool Execution
// ============================================================================

async function executeTool(
  userId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (toolName) {
    // Memory tools
    case 'memory_remember': {
      const { type, content, tags: tagsStr } = args as {
        type: string;
        content: string;
        tags?: string;
      };
      const tags = tagsStr?.split(',').map((t) => t.trim()).filter(Boolean) || [];
      const memory = await addMemory(userId, type as Memory['type'], content, tags);
      return `Remembered (${type}): "${content.slice(0, 100)}..." [ID: ${memory.id.slice(0, 8)}]`;
    }

    case 'memory_search': {
      const { query, type, limit } = args as {
        query: string;
        type?: string;
        limit?: number;
      };
      const results = await searchMemories(userId, query, {
        type: type as Memory['type'],
        limit: limit || 10,
      });

      if (results.length === 0) {
        return `No memories found for: "${query}"`;
      }

      const formatted = results
        .map((m, i) => {
          const tags = m.tags.length > 0 ? ` [${m.tags.join(', ')}]` : '';
          return `${i + 1}. [${m.type}] ${m.content.slice(0, 200)}...${tags}`;
        })
        .join('\n');

      return `Found ${results.length} memories:\n${formatted}`;
    }

    case 'memory_list': {
      const { type } = args as { type: string };
      const memories = await listMemories(userId, type as Memory['type']);

      if (memories.length === 0) {
        return `No ${type}s stored.`;
      }

      const formatted = memories
        .map((m, i) => {
          const tags = m.tags.length > 0 ? ` [${m.tags.join(', ')}]` : '';
          return `${i + 1}. ${m.content.slice(0, 150)}...${tags} (ID: ${m.id.slice(0, 8)})`;
        })
        .join('\n');

      return `${type}s (${memories.length}):\n${formatted}`;
    }

    case 'memory_forget': {
      const { id } = args as { id: string };
      const deleted = await deleteMemory(userId, id);
      return deleted ? `Memory deleted.` : `Memory not found: ${id}`;
    }

    // Email tools
    case 'email_list': {
      const { maxResults, account } = args as { maxResults?: number; account?: string };
      return listEmails(userId, { maxResults, account });
    }

    case 'email_read': {
      const { id, account } = args as { id: string; account?: string };
      return readEmail(userId, id, account);
    }

    case 'email_search': {
      const { query, limit, account } = args as { query: string; limit?: number; account?: string };
      return searchEmails(userId, query, { limit, account });
    }

    case 'email_send': {
      const { to, subject, body, account } = args as { to: string; subject: string; body: string; account?: string };
      return sendEmail(userId, to, subject, body, account);
    }

    // Calendar tools
    case 'calendar_list': {
      const { days, limit, account } = args as { days?: number; limit?: number; account?: string };
      return listCalendarEvents(userId, { days, limit, account });
    }

    case 'calendar_create': {
      const { title, start, end, description, location, account } = args as {
        title: string;
        start: string;
        end: string;
        description?: string;
        location?: string;
        account?: string;
      };
      return createCalendarEvent(userId, title, start, end, { description, location, account });
    }

    // Slack tools
    case 'slack_list_channels': {
      const { account } = args as { account?: string };
      return listSlackChannels(userId, account);
    }

    case 'slack_send_message': {
      const { channel, text, account } = args as { channel: string; text: string; account?: string };
      return sendSlackMessage(userId, channel, text, account);
    }

    case 'slack_read_channel': {
      const { channel, limit, account } = args as { channel: string; limit?: number; account?: string };
      return readSlackChannel(userId, channel, { limit, account });
    }

    // Linear tools
    case 'linear_list_issues': {
      const { query, limit, account } = args as { query?: string; limit?: number; account?: string };
      return listLinearIssues(userId, { query, limit, account });
    }

    case 'linear_create_issue': {
      const { title, description, teamId, priority, account } = args as {
        title: string;
        description?: string;
        teamId?: string;
        priority?: number;
        account?: string;
      };
      return createLinearIssue(userId, title, { description, teamId, priority, account });
    }

    case 'linear_update_issue': {
      const { issueId, title, description, stateId, priority, account } = args as {
        issueId: string;
        title?: string;
        description?: string;
        stateId?: string;
        priority?: number;
        account?: string;
      };
      return updateLinearIssue(userId, issueId, { title, description, stateId, priority, account });
    }

    // Notion tools
    case 'notion_search': {
      const { query, limit, account } = args as { query: string; limit?: number; account?: string };
      return searchNotion(userId, query, { limit, account });
    }

    case 'notion_read_page': {
      const { pageId, account } = args as { pageId: string; account?: string };
      return readNotionPage(userId, pageId, account);
    }

    case 'notion_create_page': {
      const { title, parentId, content, account } = args as {
        title: string;
        parentId: string;
        content?: string;
        account?: string;
      };
      return createNotionPage(userId, title, { parentId, content, account });
    }

    case 'notion_list_databases': {
      const { account } = args as { account?: string };
      return listNotionDatabases(userId, account);
    }

    case 'notion_query_database': {
      const { databaseId, limit, account } = args as { databaseId: string; limit?: number; account?: string };
      return queryNotionDatabase(userId, databaseId, { limit, account });
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}

// ============================================================================
// Authentication Helper
// ============================================================================

function authenticateMcpRequest(c: Context): string | null {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.replace('Bearer ', '');

  if (!token) {
    return null;
  }

  // First, try as OAuth token
  const tokenData = accessTokens.get(token);
  if (tokenData && Date.now() < tokenData.expiresAt) {
    return tokenData.userId;
  }

  // Fall back to API key
  return validateApiKey(token);
}

// ============================================================================
// OAuth 2.1 Endpoints (for Claude Desktop and other MCP clients)
// ============================================================================

// Dynamic Client Registration (RFC 7591)
mcpRoutes.post('/register', async (c) => {
  try {
    const body = await c.req.json();
    const { redirect_uris, client_name } = body;

    if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
      return c.json({ error: 'invalid_client_metadata', error_description: 'redirect_uris is required' }, 400);
    }

    const clientId = `mcp_${crypto.randomBytes(16).toString('hex')}`;
    const clientSecret = crypto.randomBytes(32).toString('hex');

    registeredClients.set(clientId, {
      clientId,
      clientSecret,
      redirectUris: redirect_uris,
    });

    console.log(`Registered MCP client: ${client_name || clientId}`);

    return c.json({
      client_id: clientId,
      client_secret: clientSecret,
      client_name: client_name || 'MCP Client',
      redirect_uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
    }, 201);
  } catch (error) {
    console.error('Client registration error:', error);
    return c.json({ error: 'invalid_request' }, 400);
  }
});

// Token Endpoint
mcpRoutes.post('/token', async (c) => {
  let body: Record<string, string>;
  const contentType = c.req.header('content-type');

  if (contentType?.includes('application/json')) {
    body = await c.req.json();
  } else {
    const formData = await c.req.parseBody();
    body = Object.fromEntries(Object.entries(formData).map(([k, v]) => [k, String(v)]));
  }

  const { grant_type, code, redirect_uri, client_id, client_secret } = body;

  // Also check for client credentials in Authorization header
  let headerClientId = client_id;
  let headerClientSecret = client_secret;
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
    const [id, secret] = decoded.split(':');
    headerClientId = id;
    headerClientSecret = secret;
  }

  if (grant_type === 'authorization_code') {
    if (!code) {
      return c.json({ error: 'invalid_request', error_description: 'Missing authorization code' }, 400);
    }

    const codeData = authorizationCodes.get(code);
    if (!codeData) {
      return c.json({ error: 'invalid_grant', error_description: 'Invalid or expired authorization code' }, 400);
    }

    if (Date.now() > codeData.expiresAt) {
      authorizationCodes.delete(code);
      return c.json({ error: 'invalid_grant', error_description: 'Authorization code expired' }, 400);
    }

    authorizationCodes.delete(code);

    const accessToken = crypto.randomBytes(32).toString('hex');
    const refreshToken = crypto.randomBytes(32).toString('hex');
    const expiresIn = 3600;

    accessTokens.set(accessToken, {
      userId: codeData.userId,
      clientId: codeData.clientId,
      expiresAt: Date.now() + expiresIn * 1000,
    });

    return c.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: expiresIn,
      refresh_token: refreshToken,
      scope: 'mcp:tools mcp:resources mcp:prompts',
    });
  }

  return c.json({ error: 'unsupported_grant_type' }, 400);
});

// Token introspection
mcpRoutes.post('/introspect', async (c) => {
  let body: Record<string, string>;
  const contentType = c.req.header('content-type');

  if (contentType?.includes('application/json')) {
    body = await c.req.json();
  } else {
    const formData = await c.req.parseBody();
    body = Object.fromEntries(Object.entries(formData).map(([k, v]) => [k, String(v)]));
  }

  const { token } = body;

  if (!token) {
    return c.json({ active: false });
  }

  const tokenData = accessTokens.get(token);
  if (!tokenData || Date.now() > tokenData.expiresAt) {
    return c.json({ active: false });
  }

  return c.json({
    active: true,
    client_id: tokenData.clientId,
    sub: tokenData.userId,
    scope: 'mcp:tools mcp:resources mcp:prompts',
    exp: Math.floor(tokenData.expiresAt / 1000),
  });
});

// ============================================================================
// MCP SSE Endpoint (for remote clients)
// ============================================================================

mcpRoutes.get('/sse', async (c) => {
  const userId = authenticateMcpRequest(c);

  if (!userId) {
    c.header('WWW-Authenticate', `Bearer resource="${BASE_URL}"`);
    return c.json({ error: 'Missing or invalid authorization' }, 401);
  }

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      event: 'open',
      data: JSON.stringify({ status: 'connected', userId }),
    });

    const keepAlive = setInterval(() => {
      stream.writeSSE({ event: 'ping', data: '' });
    }, 30000);

    stream.onAbort(() => {
      clearInterval(keepAlive);
    });
  });
});

// ============================================================================
// MCP HTTP Endpoints
// ============================================================================

// List available tools
mcpRoutes.get('/tools', (c) => {
  return c.json({ tools: TOOLS });
});

// Execute a tool
mcpRoutes.post('/tools/:toolName', async (c) => {
  const userId = authenticateMcpRequest(c);

  if (!userId) {
    c.header('WWW-Authenticate', `Bearer resource="${BASE_URL}"`);
    return c.json({ error: 'Missing or invalid authorization' }, 401);
  }

  const toolName = c.req.param('toolName');
  const args = await c.req.json();

  try {
    const result = await executeTool(userId, toolName, args);
    return c.json({ result });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Export for OAuth flow completion
export { authorizationCodes, accessTokens };
