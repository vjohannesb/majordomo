/**
 * Authentication Routes
 */

import { Hono } from 'hono';
import {
  getGoogleAuthUrl,
  handleOAuthCallback,
  getCurrentUser,
  logout,
  getSlackAuthUrl,
  handleSlackCallback,
  getLinearAuthUrl,
  handleLinearCallback,
  getNotionAuthUrl,
  handleNotionCallback,
} from '../auth.js';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

export const authRoutes = new Hono();

// Google OAuth
authRoutes.get('/google', async (c) => {
  const existingUser = await getCurrentUser(c);
  const state = existingUser ? `add:${existingUser.id}` : undefined;
  const url = getGoogleAuthUrl(state);
  return c.redirect(url);
});

authRoutes.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');

  if (!code) {
    return c.json({ error: 'No code provided' }, 400);
  }

  try {
    // Check if this is an MCP OAuth flow
    if (state?.startsWith('mcp:')) {
      // This will be handled by the MCP routes
      return c.redirect(`/oauth/authorize-complete?code=${code}&state=${state}`);
    }

    // Check if adding to existing user
    const existingUserId = state?.startsWith('add:') ? state.slice(4) : undefined;
    await handleOAuthCallback(code, c, existingUserId);

    // Redirect to dashboard URL (could be external in production)
    const dashboardUrl = process.env.DASHBOARD_URL || '/dashboard';
    return c.redirect(dashboardUrl);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

authRoutes.get('/logout', (c) => {
  logout(c);
  return c.redirect('/');
});

// Slack OAuth
authRoutes.get('/slack', async (c) => {
  const user = await getCurrentUser(c);
  if (!user) {
    return c.redirect('/auth/google');
  }

  try {
    const url = getSlackAuthUrl(user.id);
    return c.redirect(url);
  } catch (error) {
    return c.json({ error: 'Slack not configured', details: String(error) }, 500);
  }
});

authRoutes.get('/slack/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');

  if (!code) {
    return c.json({ error: 'No authorization code received from Slack' }, 400);
  }

  const user = await getCurrentUser(c);
  const userId = user?.id || state;

  if (!userId) {
    return c.json({ error: 'Session expired. Please log in again.' }, 401);
  }

  try {
    const { teamName } = await handleSlackCallback(code, userId);
    const dashboardUrl = process.env.DASHBOARD_URL || '/dashboard';
    return c.redirect(`${dashboardUrl}?connected=slack&workspace=${encodeURIComponent(teamName)}`);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Linear OAuth
authRoutes.get('/linear', async (c) => {
  const user = await getCurrentUser(c);
  if (!user) {
    return c.redirect('/auth/google');
  }

  try {
    const url = getLinearAuthUrl(user.id);
    return c.redirect(url);
  } catch (error) {
    return c.json({ error: 'Linear not configured', details: String(error) }, 500);
  }
});

authRoutes.get('/linear/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');

  if (!code) {
    return c.json({ error: 'No authorization code received from Linear' }, 400);
  }

  const user = await getCurrentUser(c);
  const userId = user?.id || state;

  if (!userId) {
    return c.json({ error: 'Session expired. Please log in again.' }, 401);
  }

  try {
    const { organizationName } = await handleLinearCallback(code, userId);
    const dashboardUrl = process.env.DASHBOARD_URL || '/dashboard';
    return c.redirect(`${dashboardUrl}?connected=linear&workspace=${encodeURIComponent(organizationName)}`);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Notion OAuth
authRoutes.get('/notion', async (c) => {
  const user = await getCurrentUser(c);
  if (!user) {
    return c.redirect('/auth/google');
  }

  try {
    const url = getNotionAuthUrl(user.id);
    return c.redirect(url);
  } catch (error) {
    return c.json({ error: 'Notion not configured', details: String(error) }, 500);
  }
});

authRoutes.get('/notion/callback', async (c) => {
  const code = c.req.query('code');
  const rawState = c.req.query('state');
  const error = c.req.query('error');

  // Strip 'u:' prefix from state
  const state = rawState?.startsWith('u:') ? rawState.slice(2) : rawState;

  if (error) {
    return c.json({ error: `Notion error: ${error}` }, 400);
  }

  if (!code) {
    return c.json({ error: 'No authorization code received from Notion' }, 400);
  }

  const user = await getCurrentUser(c);
  const userId = user?.id || state;

  if (!userId) {
    return c.json({ error: 'Session expired. Please log in again.' }, 401);
  }

  try {
    const { workspaceName } = await handleNotionCallback(code, userId);
    const dashboardUrl = process.env.DASHBOARD_URL || '/dashboard';
    return c.redirect(`${dashboardUrl}?connected=notion&workspace=${encodeURIComponent(workspaceName)}`);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});
