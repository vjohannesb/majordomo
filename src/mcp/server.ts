/**
 * Majordomo MCP Server
 *
 * Exposes all Majordomo tools via Model Context Protocol.
 * Can be used with Claude App, Claude Code, or any MCP-compatible client.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { config } from 'dotenv';
config();

import {
  initDatabase,
  sql,
  addMemory,
  searchMemories,
  listMemories,
  deleteMemory,
  getOAuthTokens,
  saveOAuthToken,
  deleteOAuthToken,
  type Memory,
} from './db.js';
import {
  getGoogleAuthUrl,
  handleOAuthCallback,
  getCurrentUser,
  requireAuth,
  logout,
  generateApiKey,
  validateApiKey,
  getSlackAuthUrl,
  handleSlackCallback,
  getLinearAuthUrl,
  handleLinearCallback,
} from './auth.js';
import {
  listEmails,
  readEmail,
  searchEmails,
  sendEmail,
  listCalendarEvents,
  createCalendarEvent,
} from './services/google.js';
import {
  listChannels as listSlackChannels,
  sendMessage as sendSlackMessage,
  readChannel as readSlackChannel,
} from './services/slack.js';
import {
  listIssues as listLinearIssues,
  createIssue as createLinearIssue,
  updateIssue as updateLinearIssue,
} from './services/linear.js';
import {
  searchNotion,
  readNotionPage,
  createNotionPage,
  listNotionDatabases,
  queryNotionDatabase,
} from './services/notion.js';
import {
  renderDashboard,
  renderApiKeySetup,
  renderServiceManage,
} from './dashboard.js';

const PORT = parseInt(process.env.PORT || '3000');
const isProduction = process.env.NODE_ENV === 'production';

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
// MCP Server (stdio mode for local use)
// ============================================================================

function createMcpServer(userId: string) {
  const server = new Server(
    { name: 'majordomo', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await executeTool(userId, name, args || {});
    return { content: [{ type: 'text', text: result }] };
  });

  return server;
}

// ============================================================================
// HTTP Server (for remote access)
// ============================================================================

const app = new Hono();

// CORS for web clients
app.use('*', cors({
  origin: isProduction ? ['https://claude.ai'] : '*',
  credentials: true,
}));

// Health check
app.get('/health', (c) => c.json({ status: 'ok', service: 'majordomo-mcp' }));

// Auth routes
app.get('/auth/google', async (c) => {
  // Check if user is already logged in (adding another account)
  const existingUser = await getCurrentUser(c);
  const state = existingUser ? `add:${existingUser.id}` : undefined;
  const url = getGoogleAuthUrl(state);
  return c.redirect(url);
});

app.get('/auth/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');

  if (!code) {
    return c.json({ error: 'No code provided' }, 400);
  }

  try {
    // Check if adding to existing user
    const existingUserId = state?.startsWith('add:') ? state.slice(4) : undefined;
    await handleOAuthCallback(code, c, existingUserId);
    return c.redirect('/dashboard');
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

app.get('/auth/logout', (c) => {
  logout(c);
  return c.redirect('/');
});

// Slack OAuth
app.get('/auth/slack', async (c) => {
  const user = await getCurrentUser(c);
  if (!user) {
    return c.redirect('/auth/google');
  }

  try {
    const url = getSlackAuthUrl(user.id);
    return c.redirect(url);
  } catch (error) {
    return c.html(`
      <html><body>
        <h1>Slack OAuth Not Configured</h1>
        <p>Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET environment variables.</p>
        <p><a href="/dashboard">Back to Dashboard</a></p>
      </body></html>
    `);
  }
});

app.get('/auth/slack/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state'); // Contains userId

  if (!code) {
    return c.json({ error: 'No code provided' }, 400);
  }

  // Get user from session or state
  const user = await getCurrentUser(c);
  const userId = user?.id || state;

  if (!userId) {
    return c.json({ error: 'No user session' }, 401);
  }

  try {
    const { teamName } = await handleSlackCallback(code, userId);
    return c.html(`
      <html><body>
        <h1>Slack Connected!</h1>
        <p>Successfully connected to workspace: ${teamName}</p>
        <p><a href="/dashboard">Back to Dashboard</a></p>
      </body></html>
    `);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Linear OAuth
app.get('/auth/linear', async (c) => {
  const user = await getCurrentUser(c);
  if (!user) {
    return c.redirect('/auth/google');
  }

  try {
    const url = getLinearAuthUrl(user.id);
    return c.redirect(url);
  } catch (error) {
    return c.html(`
      <html><body>
        <h1>Linear OAuth Not Configured</h1>
        <p>Set LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET environment variables.</p>
        <p><a href="/dashboard">Back to Dashboard</a></p>
      </body></html>
    `);
  }
});

app.get('/auth/linear/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');

  if (!code) {
    return c.json({ error: 'No code provided' }, 400);
  }

  const user = await getCurrentUser(c);
  const odmoUserId = user?.id || state;

  if (!odmoUserId) {
    return c.json({ error: 'No user session' }, 401);
  }

  try {
    const { organizationName } = await handleLinearCallback(code, odmoUserId);
    return c.html(`
      <html><body>
        <h1>Linear Connected!</h1>
        <p>Connected to workspace: ${organizationName}</p>
        <p><a href="/dashboard">Back to Dashboard</a></p>
      </body></html>
    `);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Dashboard (requires auth)
app.get('/dashboard', async (c) => {
  const user = await getCurrentUser(c);
  if (!user) {
    return c.redirect('/auth/google');
  }
  return c.html(await renderDashboard(user));
});

// Service management routes
app.get('/services/:service/setup', async (c) => {
  const user = await getCurrentUser(c);
  if (!user) return c.redirect('/auth/google');

  const service = c.req.param('service');
  return c.html(renderApiKeySetup(service));
});

app.post('/services/:service/setup', async (c) => {
  const user = await getCurrentUser(c);
  if (!user) return c.redirect('/auth/google');

  const service = c.req.param('service');
  const body = await c.req.parseBody();
  const accountName = body['accountName'] as string;
  const apiKey = body['apiKey'] as string;

  if (!accountName || !apiKey) {
    return c.json({ error: 'Missing account name or API key' }, 400);
  }

  // Save the API key as an OAuth token
  await saveOAuthToken(user.id, {
    provider: service,
    accountName,
    accessToken: apiKey,
  });

  return c.redirect('/dashboard');
});

app.get('/services/:service/manage', async (c) => {
  const user = await getCurrentUser(c);
  if (!user) return c.redirect('/auth/google');

  const service = c.req.param('service');
  return c.html(await renderServiceManage(user.id, service));
});

app.get('/services/:service/disconnect', async (c) => {
  const user = await getCurrentUser(c);
  if (!user) return c.redirect('/auth/google');

  const service = c.req.param('service');
  const accountName = c.req.query('account');

  // Delete the token (need to add this function to db.ts)
  if (accountName) {
    await deleteOAuthToken(user.id, service, accountName);
  }

  return c.redirect('/dashboard');
});

// MCP SSE endpoint (for remote Claude clients)
app.get('/mcp/sse', async (c) => {
  // Authenticate via API key
  const authHeader = c.req.header('Authorization');
  const apiKey = authHeader?.replace('Bearer ', '');

  if (!apiKey) {
    return c.json({ error: 'Missing API key' }, 401);
  }

  const userId = validateApiKey(apiKey);
  if (!userId) {
    return c.json({ error: 'Invalid API key' }, 401);
  }

  // Return SSE stream for MCP
  return streamSSE(c, async (stream) => {
    // Send initial connection message
    await stream.writeSSE({
      event: 'open',
      data: JSON.stringify({ status: 'connected', userId }),
    });

    // Keep connection alive
    const keepAlive = setInterval(() => {
      stream.writeSSE({ event: 'ping', data: '' });
    }, 30000);

    // Handle incoming MCP requests via query params or POST
    // This is a simplified implementation
    // Full MCP over SSE would need bidirectional communication

    stream.onAbort(() => {
      clearInterval(keepAlive);
    });
  });
});

// MCP HTTP endpoint (simpler request/response)
app.post('/mcp/tools/:toolName', async (c) => {
  const authHeader = c.req.header('Authorization');
  const apiKey = authHeader?.replace('Bearer ', '');

  if (!apiKey) {
    return c.json({ error: 'Missing API key' }, 401);
  }

  const userId = validateApiKey(apiKey);
  if (!userId) {
    return c.json({ error: 'Invalid API key' }, 401);
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

// List available tools
app.get('/mcp/tools', (c) => {
  return c.json({ tools: TOOLS });
});

// Landing page
app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Majordomo</title>
        <style>
          body { font-family: system-ui; max-width: 600px; margin: 100px auto; text-align: center; }
          a.button { display: inline-block; padding: 15px 30px; background: #000; color: #fff; text-decoration: none; border-radius: 8px; margin: 20px; }
        </style>
      </head>
      <body>
        <h1>Majordomo</h1>
        <p>Your personal AI assistant - everywhere.</p>
        <a href="/auth/google" class="button">Sign in with Google</a>
      </body>
    </html>
  `);
});

// ============================================================================
// Start Server
// ============================================================================

async function main() {
  // Check if running in stdio mode (for local MCP)
  if (process.argv.includes('--stdio')) {
    const userId = process.argv[process.argv.indexOf('--user') + 1] || 'local';
    const server = createMcpServer(userId);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Majordomo MCP server running on stdio');
    return;
  }

  // Initialize database
  if (sql) {
    await initDatabase();
  } else {
    console.warn('Running without database - set DATABASE_URL to enable persistence');
  }

  // Start HTTP server using Bun
  console.log(`Starting Majordomo MCP server on port ${PORT}...`);
  Bun.serve({
    fetch: app.fetch,
    port: PORT,
  });
  console.log(`Server running at http://localhost:${PORT}`);
}

main().catch(console.error);
