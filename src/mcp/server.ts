/**
 * Majordomo MCP Server
 *
 * Exposes all Majordomo tools via Model Context Protocol.
 * Can be used with Claude App, Claude Code, or any MCP-compatible client.
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
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
} from './auth.js';

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

    // Email/Calendar tools would use the user's OAuth tokens
    // For now, return a placeholder
    case 'email_list':
    case 'email_read':
    case 'email_search':
    case 'email_send':
    case 'calendar_list':
    case 'calendar_create': {
      // Get user's Google OAuth tokens
      const tokens = await getOAuthTokens(userId, 'google');
      if (tokens.length === 0) {
        return 'No Google account connected. Please visit /auth/google to connect your account.';
      }
      // TODO: Implement actual email/calendar operations using tokens
      return `Tool ${toolName} called with args: ${JSON.stringify(args)}. (Implementation pending)`;
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
app.get('/auth/google', (c) => {
  const url = getGoogleAuthUrl();
  return c.redirect(url);
});

app.get('/auth/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) {
    return c.json({ error: 'No code provided' }, 400);
  }

  try {
    const user = await handleOAuthCallback(code, c);
    const apiKey = generateApiKey(user.id);

    // Return success page with API key
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Majordomo - Connected!</title>
          <style>
            body { font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px; }
            code { background: #f4f4f4; padding: 10px; display: block; word-break: break-all; }
            .success { color: green; }
          </style>
        </head>
        <body>
          <h1 class="success">Connected!</h1>
          <p>Welcome, ${user.name || user.email}!</p>
          <h3>Your MCP Endpoint:</h3>
          <code>${process.env.BASE_URL || 'http://localhost:3000'}/mcp</code>
          <h3>Your API Key:</h3>
          <code>${apiKey}</code>
          <p>Add this to your Claude settings to use Majordomo tools.</p>
        </body>
      </html>
    `);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

app.get('/auth/logout', (c) => {
  logout(c);
  return c.redirect('/');
});

// Dashboard (requires auth)
app.get('/dashboard', async (c) => {
  const user = await getCurrentUser(c);
  if (!user) {
    return c.redirect('/auth/google');
  }

  const apiKey = generateApiKey(user.id);

  return c.html(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Majordomo Dashboard</title>
        <style>
          body { font-family: system-ui; max-width: 800px; margin: 50px auto; padding: 20px; }
          code { background: #f4f4f4; padding: 10px; display: block; word-break: break-all; margin: 10px 0; }
          .card { border: 1px solid #ddd; padding: 20px; margin: 20px 0; border-radius: 8px; }
        </style>
      </head>
      <body>
        <h1>Majordomo Dashboard</h1>
        <p>Welcome, ${user.name || user.email}!</p>

        <div class="card">
          <h3>MCP Configuration</h3>
          <p>Add this to your Claude settings:</p>
          <code>{
  "mcpServers": {
    "majordomo": {
      "url": "${process.env.BASE_URL || 'http://localhost:3000'}/mcp/sse",
      "headers": {
        "Authorization": "Bearer ${apiKey}"
      }
    }
  }
}</code>
        </div>

        <div class="card">
          <h3>Connected Services</h3>
          <ul>
            <li>Google (${user.email}) - Connected</li>
          </ul>
          <p><a href="/auth/google">Connect another Google account</a></p>
        </div>

        <p><a href="/auth/logout">Logout</a></p>
      </body>
    </html>
  `);
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

  // Start HTTP server
  console.log(`Starting Majordomo MCP server on port ${PORT}...`);
  serve({ fetch: app.fetch, port: PORT });
  console.log(`Server running at http://localhost:${PORT}`);
}

main().catch(console.error);
