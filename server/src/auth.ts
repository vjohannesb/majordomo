/**
 * Authentication Module
 *
 * Handles Google OAuth, Slack OAuth, Linear OAuth, Notion OAuth, and session management.
 */

import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { findOrCreateUser, getUserById, saveOAuthToken, type User } from './db.js';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID;
const SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET;
const LINEAR_CLIENT_ID = process.env.LINEAR_CLIENT_ID;
const LINEAR_CLIENT_SECRET = process.env.LINEAR_CLIENT_SECRET;
const NOTION_CLIENT_ID = process.env.NOTION_CLIENT_ID;
const NOTION_CLIENT_SECRET = process.env.NOTION_CLIENT_SECRET;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');

/**
 * Generate Google OAuth URL
 */
export function getGoogleAuthUrl(state?: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${BASE_URL}/auth/callback`,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    ...(state && { state }),
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  idToken: string;
}> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code,
      redirect_uri: `${BASE_URL}/auth/callback`,
      grant_type: 'authorization_code',
    }),
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(`OAuth error: ${data.error_description || data.error}`);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    idToken: data.id_token,
  };
}

/**
 * Get user profile from Google
 */
export async function getGoogleProfile(accessToken: string): Promise<{
  id: string;
  email: string;
  name?: string;
  picture?: string;
}> {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await response.json();

  return {
    id: data.id,
    email: data.email,
    name: data.name,
    picture: data.picture,
  };
}

/**
 * Handle OAuth callback - create/update user and set session
 * If existingUserId is provided, adds the account to that user instead of creating a new one
 */
export async function handleOAuthCallback(
  code: string,
  c: Context,
  existingUserId?: string
): Promise<User> {
  const tokens = await exchangeCodeForTokens(code);
  const profile = await getGoogleProfile(tokens.accessToken);

  let user: User;

  if (existingUserId) {
    // Adding account to existing user
    const existing = await getUserById(existingUserId);
    if (!existing) {
      throw new Error('User not found');
    }
    user = existing;
  } else {
    // Create or update user (first time login)
    user = await findOrCreateUser(profile);
  }

  // Save Google OAuth tokens
  await saveOAuthToken(user.id, {
    provider: 'google',
    accountName: profile.email,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenData: { email: profile.email },
  });

  // Set session cookie
  setCookie(c, 'majordomo_session', user.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  });

  return user;
}

/**
 * Get current user from session
 */
export async function getCurrentUser(c: Context): Promise<User | null> {
  const sessionId = getCookie(c, 'majordomo_session');
  if (!sessionId) return null;

  return getUserById(sessionId);
}

/**
 * Middleware to require authentication
 */
export async function requireAuth(c: Context, next: () => Promise<void>) {
  const user = await getCurrentUser(c);

  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.set('user', user);
  await next();
}

/**
 * Logout - clear session
 */
export function logout(c: Context) {
  deleteCookie(c, 'majordomo_session', { path: '/' });
}

/**
 * Generate API key for MCP access
 */
export function generateApiKey(userId: string): string {
  const payload = JSON.stringify({ userId, created: Date.now() });
  return `mj_${Buffer.from(payload).toString('base64url')}`;
}

/**
 * Validate API key and get user ID
 */
export function validateApiKey(apiKey: string): string | null {
  if (!apiKey.startsWith('mj_')) return null;

  try {
    const payload = Buffer.from(apiKey.slice(3), 'base64url').toString();
    const { userId } = JSON.parse(payload);
    return userId;
  } catch {
    return null;
  }
}

// ============================================================================
// Slack OAuth
// ============================================================================

const SLACK_SCOPES = [
  'channels:read',
  'channels:history',
  'chat:write',
  'groups:read',
  'groups:history',
  'im:read',
  'im:history',
  'im:write',
  'mpim:read',
  'mpim:history',
  'users:read',
].join(',');

export function getSlackAuthUrl(state?: string): string {
  if (!SLACK_CLIENT_ID) {
    throw new Error('SLACK_CLIENT_ID not configured');
  }

  const params = new URLSearchParams({
    client_id: SLACK_CLIENT_ID,
    redirect_uri: `${BASE_URL}/auth/slack/callback`,
    scope: SLACK_SCOPES,
    ...(state && { state }),
  });

  return `https://slack.com/oauth/v2/authorize?${params}`;
}

export async function exchangeSlackCode(code: string): Promise<{
  accessToken: string;
  teamId: string;
  teamName: string;
  botUserId: string;
}> {
  if (!SLACK_CLIENT_ID || !SLACK_CLIENT_SECRET) {
    throw new Error('Slack OAuth not configured');
  }

  const response = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: SLACK_CLIENT_ID,
      client_secret: SLACK_CLIENT_SECRET,
      code,
      redirect_uri: `${BASE_URL}/auth/slack/callback`,
    }),
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(`Slack OAuth error: ${data.error}`);
  }

  return {
    accessToken: data.access_token,
    teamId: data.team.id,
    teamName: data.team.name,
    botUserId: data.bot_user_id,
  };
}

export async function handleSlackCallback(
  code: string,
  userId: string
): Promise<{ teamName: string }> {
  const tokens = await exchangeSlackCode(code);

  await saveOAuthToken(userId, {
    provider: 'slack',
    accountName: tokens.teamName,
    accessToken: tokens.accessToken,
    tokenData: {
      teamId: tokens.teamId,
      teamName: tokens.teamName,
      botUserId: tokens.botUserId,
    },
  });

  return { teamName: tokens.teamName };
}

// ============================================================================
// Linear OAuth
// ============================================================================

const LINEAR_SCOPES = 'read,write,issues:create,comments:create';

export function getLinearAuthUrl(state?: string): string {
  if (!LINEAR_CLIENT_ID) {
    throw new Error('LINEAR_CLIENT_ID not configured');
  }

  const params = new URLSearchParams({
    client_id: LINEAR_CLIENT_ID,
    redirect_uri: `${BASE_URL}/auth/linear/callback`,
    response_type: 'code',
    scope: LINEAR_SCOPES,
    prompt: 'consent',
    ...(state && { state }),
  });

  return `https://linear.app/oauth/authorize?${params}`;
}

export async function exchangeLinearCode(code: string): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scope: string;
}> {
  if (!LINEAR_CLIENT_ID || !LINEAR_CLIENT_SECRET) {
    throw new Error('Linear OAuth not configured');
  }

  const response = await fetch('https://api.linear.app/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: LINEAR_CLIENT_ID,
      client_secret: LINEAR_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${BASE_URL}/auth/linear/callback`,
    }),
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(`Linear OAuth error: ${data.error_description || data.error}`);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    scope: data.scope,
  };
}

export async function getLinearViewer(accessToken: string): Promise<{
  id: string;
  name: string;
  email: string;
  organizationName: string;
}> {
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      query: `{
        viewer {
          id
          name
          email
        }
        organization {
          name
        }
      }`,
    }),
  });

  const data = await response.json();

  if (data.errors) {
    throw new Error(`Linear API error: ${data.errors[0]?.message}`);
  }

  return {
    id: data.data.viewer.id,
    name: data.data.viewer.name,
    email: data.data.viewer.email,
    organizationName: data.data.organization.name,
  };
}

export async function handleLinearCallback(
  code: string,
  userId: string
): Promise<{ organizationName: string }> {
  const tokens = await exchangeLinearCode(code);
  const viewer = await getLinearViewer(tokens.accessToken);

  const accountName = viewer.organizationName;

  await saveOAuthToken(userId, {
    provider: 'linear',
    accountName,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenData: {
      linearUserId: viewer.id,
      userName: viewer.name,
      email: viewer.email,
      organizationName: viewer.organizationName,
      expiresIn: tokens.expiresIn,
      scope: tokens.scope,
    },
  });

  return { organizationName: viewer.organizationName };
}

// ============================================================================
// Notion OAuth
// ============================================================================

export function getNotionAuthUrl(state?: string): string {
  if (!NOTION_CLIENT_ID) {
    throw new Error('NOTION_CLIENT_ID not configured');
  }

  const stateParam = state ? `u:${state}` : undefined;

  const params = new URLSearchParams({
    client_id: NOTION_CLIENT_ID,
    redirect_uri: `${BASE_URL}/auth/notion/callback`,
    response_type: 'code',
    owner: 'user',
    ...(stateParam && { state: stateParam }),
  });

  return `https://api.notion.com/v1/oauth/authorize?${params}`;
}

export async function exchangeNotionCode(code: string): Promise<{
  accessToken: string;
  workspaceId: string;
  workspaceName: string;
  workspaceIcon?: string;
  botId: string;
}> {
  if (!NOTION_CLIENT_ID || !NOTION_CLIENT_SECRET) {
    throw new Error('Notion OAuth not configured');
  }

  const credentials = Buffer.from(`${NOTION_CLIENT_ID}:${NOTION_CLIENT_SECRET}`).toString('base64');

  const response = await fetch('https://api.notion.com/v1/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${credentials}`,
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${BASE_URL}/auth/notion/callback`,
    }),
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(`Notion OAuth error: ${data.error}`);
  }

  return {
    accessToken: data.access_token,
    workspaceId: data.workspace_id,
    workspaceName: data.workspace_name || 'Notion Workspace',
    workspaceIcon: data.workspace_icon,
    botId: data.bot_id,
  };
}

export async function handleNotionCallback(
  code: string,
  userId: string
): Promise<{ workspaceName: string }> {
  const tokens = await exchangeNotionCode(code);

  await saveOAuthToken(userId, {
    provider: 'notion',
    accountName: tokens.workspaceName,
    accessToken: tokens.accessToken,
    tokenData: {
      workspaceId: tokens.workspaceId,
      workspaceName: tokens.workspaceName,
      workspaceIcon: tokens.workspaceIcon,
      botId: tokens.botId,
    },
  });

  return { workspaceName: tokens.workspaceName };
}
