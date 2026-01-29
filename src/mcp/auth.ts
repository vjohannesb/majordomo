/**
 * Authentication Module
 *
 * Handles Google OAuth, Slack OAuth, and session management.
 */

import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { findOrCreateUser, getUserById, saveOAuthToken, type User } from './db.js';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID;
const SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET;
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
 */
export async function handleOAuthCallback(
  code: string,
  c: Context
): Promise<User> {
  const tokens = await exchangeCodeForTokens(code);
  const profile = await getGoogleProfile(tokens.accessToken);

  // Create or update user
  const user = await findOrCreateUser(profile);

  // Save Google OAuth tokens
  await saveOAuthToken(user.id, {
    provider: 'google',
    accountName: profile.email,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenData: { email: profile.email },
  });

  // Set session cookie (simple approach - in production use JWT or session store)
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
  // Simple approach: base64 encode user ID with a prefix
  // In production, use proper API key generation with hashing
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

/**
 * Generate Slack OAuth URL
 */
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

/**
 * Exchange Slack authorization code for tokens
 */
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

/**
 * Handle Slack OAuth callback
 */
export async function handleSlackCallback(
  code: string,
  userId: string
): Promise<{ teamName: string }> {
  const tokens = await exchangeSlackCode(code);

  // Save Slack OAuth tokens
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
