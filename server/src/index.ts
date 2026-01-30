/**
 * Majordomo MCP Server
 *
 * Main entry point. Exposes all Majordomo tools via Model Context Protocol.
 * Can be used with Claude Desktop, Claude Code, Cursor, or any MCP-compatible client.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as crypto from 'node:crypto';

import { config } from 'dotenv';
config();

import { initDatabase, sql } from './db.js';
import {
  getGoogleAuthUrl,
  handleOAuthCallback,
  getCurrentUser,
} from './auth.js';

// Import routes
import { authRoutes } from './routes/auth.js';
import { apiRoutes } from './routes/api.js';
import { mcpRoutes, authorizationCodes } from './routes/mcp.js';
import { webhookRoutes } from './routes/webhooks.js';

const PORT = parseInt(process.env.PORT || '3000');
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const DASHBOARD_URL = process.env.DASHBOARD_URL;
const isProduction = process.env.NODE_ENV === 'production';

// ============================================================================
// MCP Server (stdio mode for local use)
// ============================================================================

function createMcpServer(userId: string) {
  const server = new Server(
    { name: 'majordomo', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  // Import tools and executeTool from mcp routes
  const TOOLS = [
    { name: 'memory_remember', description: 'Store a memory', inputSchema: { type: 'object', properties: { type: { type: 'string' }, content: { type: 'string' } }, required: ['type', 'content'] } },
    // Full tools list is in routes/mcp.ts
  ];

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    // In stdio mode, we'd need to import executeTool or handle inline
    return { content: [{ type: 'text', text: `Tool ${name} called with args` }] };
  });

  return server;
}

// ============================================================================
// HTTP Server
// ============================================================================

const app = new Hono();

// CORS for web clients
const allowedOrigins = isProduction
  ? [DASHBOARD_URL, 'https://claude.ai'].filter(Boolean) as string[]
  : '*';

app.use('*', cors({
  origin: allowedOrigins,
  credentials: true,
}));

// Health check
app.get('/health', (c) => c.json({ status: 'ok', service: 'majordomo-server' }));

// ============================================================================
// OAuth Discovery Endpoints (RFC 9728)
// ============================================================================

app.get('/.well-known/oauth-protected-resource', (c) => {
  return c.json({
    resource: BASE_URL,
    authorization_servers: [BASE_URL],
    bearer_methods_supported: ['header'],
    resource_signing_alg_values_supported: ['RS256'],
  });
});

app.get('/.well-known/oauth-authorization-server', (c) => {
  return c.json({
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/oauth/authorize`,
    token_endpoint: `${BASE_URL}/oauth/token`,
    registration_endpoint: `${BASE_URL}/oauth/register`,
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['mcp:tools', 'mcp:resources', 'mcp:prompts'],
    service_documentation: `${BASE_URL}/docs`,
  });
});

// ============================================================================
// OAuth Authorization Endpoint (for MCP OAuth flow)
// ============================================================================

app.get('/oauth/authorize', async (c) => {
  const clientId = c.req.query('client_id');
  const redirectUri = c.req.query('redirect_uri');
  const responseType = c.req.query('response_type');
  const state = c.req.query('state');
  const codeChallenge = c.req.query('code_challenge');
  const codeChallengeMethod = c.req.query('code_challenge_method');

  if (!clientId || !redirectUri || responseType !== 'code') {
    return c.json({ error: 'invalid_request', error_description: 'Missing required parameters' }, 400);
  }

  // Store OAuth request parameters for after Google auth
  const oauthState = Buffer.from(JSON.stringify({
    clientId,
    redirectUri,
    state,
    codeChallenge,
    codeChallengeMethod,
  })).toString('base64url');

  // Check if user is already logged in
  const existingUser = await getCurrentUser(c);
  if (existingUser) {
    return handleMcpAuthorization(c, existingUser.id, { clientId, redirectUri, state });
  }

  // Redirect to Google OAuth with MCP state
  const googleAuthUrl = getGoogleAuthUrl(`mcp:${oauthState}`);
  return c.redirect(googleAuthUrl);
});

// Handle MCP authorization after user is authenticated
async function handleMcpAuthorization(
  c: any,
  userId: string,
  params: { clientId: string; redirectUri: string; state?: string }
) {
  const { clientId, redirectUri, state } = params;

  const authCode = crypto.randomBytes(32).toString('hex');

  authorizationCodes.set(authCode, {
    userId,
    clientId,
    redirectUri,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  const redirectUrl = new URL(redirectUri);
  redirectUrl.searchParams.set('code', authCode);
  if (state) {
    redirectUrl.searchParams.set('state', state);
  }

  return c.redirect(redirectUrl.toString());
}

// Complete OAuth flow after Google auth (for MCP clients)
app.get('/oauth/authorize-complete', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');

  if (!code || !state?.startsWith('mcp:')) {
    return c.json({ error: 'Invalid OAuth state' }, 400);
  }

  try {
    const mcpState = state.slice(4);
    const mcpParams = JSON.parse(Buffer.from(mcpState, 'base64url').toString());

    const user = await handleOAuthCallback(code, c);
    return handleMcpAuthorization(c, user.id, mcpParams);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// ============================================================================
// Mount Routes
// ============================================================================

app.route('/auth', authRoutes);
app.route('/api', apiRoutes);
app.route('/oauth', mcpRoutes);  // MCP OAuth endpoints: /oauth/register, /oauth/token
app.route('/mcp', mcpRoutes);    // MCP endpoints: /mcp/sse, /mcp/tools
app.route('/webhooks', webhookRoutes);

// ============================================================================
// Landing Page (minimal - dashboard is separate)
// ============================================================================

app.get('/', (c) => {
  const dashboardUrl = DASHBOARD_URL || '/dashboard';

  return c.html(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Majordomo</title>
        <style>
          body { font-family: system-ui; max-width: 600px; margin: 100px auto; text-align: center; padding: 20px; }
          h1 { font-size: 2rem; margin-bottom: 0.5rem; }
          p { color: #666; margin-bottom: 2rem; }
          a.button { display: inline-block; padding: 15px 30px; background: #000; color: #fff; text-decoration: none; border-radius: 8px; margin: 10px; }
          a.button:hover { background: #333; }
          a.secondary { background: #f3f4f6; color: #333; }
          a.secondary:hover { background: #e5e7eb; }
          code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 0.9rem; }
        </style>
      </head>
      <body>
        <h1>Majordomo</h1>
        <p>Your personal AI assistant - everywhere.</p>
        <a href="${dashboardUrl}" class="button">Open Dashboard</a>
        <a href="/auth/google" class="button secondary">Sign in with Google</a>
        <p style="margin-top: 3rem; font-size: 0.9rem;">
          MCP Server: <code>${BASE_URL}/mcp/sse</code>
        </p>
      </body>
    </html>
  `);
});

// Legacy dashboard route (redirects to external dashboard if configured)
app.get('/dashboard', async (c) => {
  if (DASHBOARD_URL) {
    return c.redirect(DASHBOARD_URL);
  }

  const user = await getCurrentUser(c);
  if (!user) {
    return c.redirect('/auth/google');
  }

  // Minimal fallback if no external dashboard
  return c.html(`
    <!DOCTYPE html>
    <html>
      <head><title>Majordomo Dashboard</title></head>
      <body style="font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px;">
        <h1>Welcome, ${user.name || user.email}</h1>
        <p>Dashboard is available at: <a href="${DASHBOARD_URL || 'localhost:3001'}">${DASHBOARD_URL || 'localhost:3001'}</a></p>
        <p><a href="/api/mcp-config">View MCP Config</a></p>
        <p><a href="/auth/logout">Logout</a></p>
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
  console.log(`Starting Majordomo server on port ${PORT}...`);
  console.log(`Base URL: ${BASE_URL}`);
  if (DASHBOARD_URL) {
    console.log(`Dashboard URL: ${DASHBOARD_URL}`);
  }

  Bun.serve({
    fetch: app.fetch,
    port: PORT,
  });

  console.log(`Server running at http://localhost:${PORT}`);
}

main().catch(console.error);
