/**
 * Dashboard API Routes
 *
 * REST API endpoints for the Next.js dashboard to consume.
 */

import { Hono } from 'hono';
import { getCurrentUser, generateApiKey } from '../auth.js';
import {
  getOAuthTokens,
  deleteOAuthToken,
  getUserSettings,
  saveUserSettings,
  type User,
} from '../db.js';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

export const apiRoutes = new Hono();

// Types for API responses
interface ServiceStatus {
  id: string;
  name: string;
  icon: string;
  description: string;
  authType: 'oauth' | 'apikey';
  authUrl: string;
  connected: boolean;
  accounts: { name: string; email?: string }[];
}

// Middleware to require authentication
async function requireAuth(c: any, next: () => Promise<void>) {
  const user = await getCurrentUser(c);
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  c.set('user', user);
  await next();
}

// GET /api/me - Current user info
apiRoutes.get('/me', async (c) => {
  const user = await getCurrentUser(c);

  if (!user) {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
  });
});

// GET /api/services - List services + connection status
apiRoutes.get('/services', async (c) => {
  const user = await getCurrentUser(c);

  if (!user) {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  const services = await getServicesStatus(user.id);
  return c.json({ services });
});

// GET /api/services/:id - Service details
apiRoutes.get('/services/:id', async (c) => {
  const user = await getCurrentUser(c);

  if (!user) {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  const serviceId = c.req.param('id');
  const services = await getServicesStatus(user.id);
  const service = services.find(s => s.id === serviceId);

  if (!service) {
    return c.json({ error: 'Service not found' }, 404);
  }

  return c.json({ service });
});

// DELETE /api/services/:id/:account - Disconnect account
apiRoutes.delete('/services/:id/:account', async (c) => {
  const user = await getCurrentUser(c);

  if (!user) {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  const serviceId = c.req.param('id');
  const accountName = decodeURIComponent(c.req.param('account'));

  const deleted = await deleteOAuthToken(user.id, serviceId, accountName);

  if (!deleted) {
    return c.json({ error: 'Account not found' }, 404);
  }

  return c.json({ success: true });
});

// GET /api/settings - User settings
apiRoutes.get('/settings', async (c) => {
  const user = await getCurrentUser(c);

  if (!user) {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  const settings = await getUserSettings(user.id);

  return c.json({
    notificationChannel: settings?.notificationChannel || 'none',
    slackChannelId: settings?.slackChannelId,
  });
});

// PUT /api/settings - Update settings
apiRoutes.put('/settings', async (c) => {
  const user = await getCurrentUser(c);

  if (!user) {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  const body = await c.req.json();
  const { notificationChannel, slackChannelId } = body;

  if (notificationChannel && !['slack', 'email', 'none'].includes(notificationChannel)) {
    return c.json({ error: 'Invalid notification channel' }, 400);
  }

  await saveUserSettings({
    userId: user.id,
    notificationChannel: notificationChannel || 'none',
    slackChannelId,
  });

  return c.json({ success: true });
});

// GET /api/mcp-config - Get MCP config (API key, URLs)
apiRoutes.get('/mcp-config', async (c) => {
  const user = await getCurrentUser(c);

  if (!user) {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  const apiKey = generateApiKey(user.id);

  return c.json({
    sseUrl: `${BASE_URL}/mcp/sse`,
    apiKey,
    configs: {
      // For Claude Desktop (OAuth)
      claudeDesktop: {
        url: `${BASE_URL}/mcp/sse`,
        note: 'Claude Desktop uses OAuth - it will prompt you to sign in',
      },
      // For Claude Code and other clients (API key)
      claudeCode: {
        mcpServers: {
          majordomo: {
            url: `${BASE_URL}/mcp/sse`,
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
          },
        },
      },
      // One-click install URLs
      install: {
        cursor: generateCursorInstallUrl(apiKey),
        vscode: generateVSCodeInstallUrl(apiKey),
        vscodeInsiders: generateVSCodeInsidersInstallUrl(apiKey),
      },
    },
    webhooks: {
      linear: `${BASE_URL}/webhooks/linear`,
      notion: `${BASE_URL}/webhooks/notion`,
    },
  });
});

// Helper: Get services status
async function getServicesStatus(userId: string): Promise<ServiceStatus[]> {
  const tokens = await getOAuthTokens(userId);

  const googleTokens = tokens.filter(t => t.provider === 'google');
  const slackTokens = tokens.filter(t => t.provider === 'slack');
  const linearTokens = tokens.filter(t => t.provider === 'linear');
  const notionTokens = tokens.filter(t => t.provider === 'notion');

  return [
    {
      id: 'google',
      name: 'Google',
      icon: 'mail',
      description: 'Gmail & Calendar access',
      authType: 'oauth',
      authUrl: `${BASE_URL}/auth/google`,
      connected: googleTokens.length > 0,
      accounts: googleTokens.map(t => ({ name: t.accountName, email: t.accountName })),
    },
    {
      id: 'slack',
      name: 'Slack',
      icon: 'message-square',
      description: 'Send and read Slack messages',
      authType: 'oauth',
      authUrl: `${BASE_URL}/auth/slack`,
      connected: slackTokens.length > 0,
      accounts: slackTokens.map(t => ({ name: t.accountName })),
    },
    {
      id: 'linear',
      name: 'Linear',
      icon: 'check-square',
      description: 'Issue tracking and project management',
      authType: 'oauth',
      authUrl: `${BASE_URL}/auth/linear`,
      connected: linearTokens.length > 0,
      accounts: linearTokens.map(t => ({ name: t.accountName })),
    },
    {
      id: 'notion',
      name: 'Notion',
      icon: 'file-text',
      description: 'Notes and documentation',
      authType: 'oauth',
      authUrl: `${BASE_URL}/auth/notion`,
      connected: notionTokens.length > 0,
      accounts: notionTokens.map(t => ({ name: t.accountName })),
    },
  ];
}

// Generate one-click install URLs
function generateCursorInstallUrl(apiKey: string): string {
  const mcpConfig = {
    url: `${BASE_URL}/mcp/sse`,
    headers: { Authorization: `Bearer ${apiKey}` }
  };
  const encoded = Buffer.from(JSON.stringify(mcpConfig)).toString('base64');
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=Majordomo&config=${encoded}`;
}

function generateVSCodeInstallUrl(apiKey: string): string {
  const mcpConfig = {
    name: 'majordomo',
    url: `${BASE_URL}/mcp/sse`,
    headers: { Authorization: `Bearer ${apiKey}` }
  };
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify(mcpConfig))}`;
}

function generateVSCodeInsidersInstallUrl(apiKey: string): string {
  const mcpConfig = {
    name: 'majordomo',
    url: `${BASE_URL}/mcp/sse`,
    headers: { Authorization: `Bearer ${apiKey}` }
  };
  return `vscode-insiders:mcp/install?${encodeURIComponent(JSON.stringify(mcpConfig))}`;
}
