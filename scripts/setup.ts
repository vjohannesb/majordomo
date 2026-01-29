#!/usr/bin/env npx tsx
/**
 * Majordomo Setup Script
 *
 * Run with: npm run setup
 */

import * as readline from 'node:readline';
import * as http from 'node:http';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { exec } from 'node:child_process';

// Slack app credentials (created via manifest API)
const SLACK_CLIENT_ID = '341295152917.10393149939059';
const SLACK_CLIENT_SECRET = 'c52bcc2eeb54bc34170e1bb06a1a29cb';
const OAUTH_PORT = 3456;
const REDIRECT_URI = `http://localhost:${OAUTH_PORT}/oauth/callback`;

// Google OAuth scopes for Gmail + Calendar
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

function maskToken(token: string): string {
  if (token.length < 15) return '***';
  return token.slice(0, 12) + '...' + token.slice(-4);
}

function openBrowser(url: string) {
  const cmd = process.platform === 'darwin' ? 'open' :
              process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} "${url}"`);
}

interface OAuthTokens {
  userToken?: string;
  botToken?: string;
  teamId?: string;
  teamName?: string;
}

async function doSlackOAuth(): Promise<OAuthTokens> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${OAUTH_PORT}`);

      if (url.pathname === '/oauth/callback') {
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<html><body><h1>Authorization Failed</h1><p>${error}</p></body></html>`);
          server.close();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>No code received</h1></body></html>');
          server.close();
          reject(new Error('No authorization code received'));
          return;
        }

        // Exchange code for tokens
        try {
          const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: SLACK_CLIENT_ID,
              client_secret: SLACK_CLIENT_SECRET,
              code,
              redirect_uri: REDIRECT_URI,
            }),
          });

          const data = await tokenResponse.json() as {
            ok: boolean;
            error?: string;
            access_token?: string;
            authed_user?: { access_token?: string };
            team?: { id?: string; name?: string };
          };

          if (!data.ok) {
            throw new Error(`Token exchange failed: ${data.error}`);
          }

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!DOCTYPE html>
            <html>
              <head><meta charset="utf-8"></head>
              <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: white;">
                <div style="text-align: center;">
                  <h1>&#10003; Majordomo Connected!</h1>
                  <p>You can close this window and return to the terminal.</p>
                </div>
              </body>
            </html>
          `);

          server.close();
          resolve({
            userToken: data.authed_user?.access_token,
            botToken: data.access_token,
            teamId: data.team?.id,
            teamName: data.team?.name,
          });
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`<html><body><h1>Error</h1><p>${err}</p></body></html>`);
          server.close();
          reject(err);
        }
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.listen(OAUTH_PORT, () => {
      console.log(`\nListening on http://localhost:${OAUTH_PORT}...`);

      // Build OAuth URL
      const oauthUrl = new URL('https://slack.com/oauth/v2/authorize');
      oauthUrl.searchParams.set('client_id', SLACK_CLIENT_ID);
      oauthUrl.searchParams.set('scope', 'chat:write,users:read,channels:read,channels:history,im:read');
      oauthUrl.searchParams.set('user_scope', 'chat:write,users:read,channels:read,channels:history,groups:read,groups:history,im:read,im:write,im:history,mpim:read');
      oauthUrl.searchParams.set('redirect_uri', REDIRECT_URI);

      console.log('Opening browser for Slack authorization...\n');
      openBrowser(oauthUrl.toString());
    });

    server.on('error', (err) => {
      reject(err);
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('OAuth timed out'));
    }, 5 * 60 * 1000);
  });
}

interface GoogleOAuthTokens {
  accessToken: string;
  refreshToken: string;
}

async function doGoogleOAuth(clientId: string, clientSecret: string): Promise<GoogleOAuthTokens> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${OAUTH_PORT}`);

      if (url.pathname === '/oauth/callback') {
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<html><body><h1>Authorization Failed</h1><p>${error}</p></body></html>`);
          server.close();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>No code received</h1></body></html>');
          server.close();
          reject(new Error('No authorization code received'));
          return;
        }

        // Exchange code for tokens
        try {
          const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: clientId,
              client_secret: clientSecret,
              code,
              redirect_uri: REDIRECT_URI,
              grant_type: 'authorization_code',
            }),
          });

          const data = await tokenResponse.json() as {
            access_token?: string;
            refresh_token?: string;
            error?: string;
            error_description?: string;
          };

          if (data.error) {
            throw new Error(`Token exchange failed: ${data.error_description || data.error}`);
          }

          if (!data.refresh_token) {
            throw new Error('No refresh token received. You may need to revoke access at https://myaccount.google.com/permissions and try again.');
          }

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!DOCTYPE html>
            <html>
              <head><meta charset="utf-8"></head>
              <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: white;">
                <div style="text-align: center;">
                  <h1>&#10003; Google Connected!</h1>
                  <p>You can close this window and return to the terminal.</p>
                </div>
              </body>
            </html>
          `);

          server.close();
          resolve({
            accessToken: data.access_token!,
            refreshToken: data.refresh_token!,
          });
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`<html><body><h1>Error</h1><p>${err}</p></body></html>`);
          server.close();
          reject(err);
        }
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.listen(OAUTH_PORT, () => {
      console.log(`\nListening on http://localhost:${OAUTH_PORT}...`);

      // Build Google OAuth URL
      const oauthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      oauthUrl.searchParams.set('client_id', clientId);
      oauthUrl.searchParams.set('redirect_uri', REDIRECT_URI);
      oauthUrl.searchParams.set('response_type', 'code');
      oauthUrl.searchParams.set('scope', GOOGLE_SCOPES);
      oauthUrl.searchParams.set('access_type', 'offline');
      oauthUrl.searchParams.set('prompt', 'consent'); // Force consent to get refresh token

      console.log('Opening browser for Google authorization...\n');
      openBrowser(oauthUrl.toString());
    });

    server.on('error', (err) => {
      reject(err);
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('OAuth timed out'));
    }, 5 * 60 * 1000);
  });
}

async function loadExistingConfig(): Promise<Record<string, unknown>> {
  const configPath = join(homedir(), '.majordomo', 'config.json');
  try {
    const content = await readFile(configPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { tickInterval: 60000 };
  }
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    MAJORDOMO SETUP                           ║
╠══════════════════════════════════════════════════════════════╣
║  Configure your integrations. No auto-replies by default.    ║
║  YOU control everything through Claude Code.                 ║
╚══════════════════════════════════════════════════════════════╝
`);

  const config = await loadExistingConfig();

  // === SLACK SETUP ===
  console.log('── SLACK SETUP ──\n');

  const setupSlack = await ask('Set up Slack integration? (y/n): ');

  if (setupSlack.toLowerCase() === 'y') {
    // Get App Token first
    console.log(`
First, you need the App Token for Socket Mode.

Go to: https://api.slack.com/apps/A0ABK4DTM1R/general
Scroll to "App-Level Tokens" → Generate Token
  Name: majordomo-socket
  Scope: connections:write
`);

    const appToken = await ask('Enter APP TOKEN (xapp-...): ');

    if (!appToken.startsWith('xapp-')) {
      console.log('⚠️  Warning: App token should start with "xapp-"');
    }

    // Do OAuth flow
    console.log('\nNow authorizing with Slack to get your User Token...');
    console.log('A browser window will open. Authorize the app.\n');

    await ask('Press Enter to open browser...');

    try {
      const tokens = await doSlackOAuth();

      console.log(`\n✓ Connected to workspace: ${tokens.teamName}`);

      if (tokens.userToken) {
        console.log(`✓ User token obtained (messages will appear as YOU)`);
      }
      if (tokens.botToken) {
        console.log(`✓ Bot token obtained`);
      }

      config.slack = {
        enabled: true,
        appToken,
        userToken: tokens.userToken,
        botToken: tokens.botToken,
        mode: 'command',
      };
    } catch (err) {
      console.error('\n✗ OAuth failed:', err);
      console.log('\nYou can try again later by running: npm run setup\n');
    }
  }

  // === GOOGLE SETUP (Gmail + Calendar) ===
  console.log('\n── GOOGLE SETUP (Gmail + Calendar) ──\n');

  const setupGoogle = await ask('Set up Gmail and Google Calendar? (y/n): ');

  if (setupGoogle.toLowerCase() === 'y') {
    console.log(`
To use Gmail and Google Calendar, you need to create OAuth credentials:

1. Go to: https://console.cloud.google.com/apis/credentials
2. Create a project (or select existing one)
3. Enable APIs:
   - Gmail API: https://console.cloud.google.com/apis/library/gmail.googleapis.com
   - Calendar API: https://console.cloud.google.com/apis/library/calendar-json.googleapis.com
4. Create OAuth 2.0 Client ID:
   - Application type: "Web application"
   - Authorized redirect URI: http://localhost:${OAUTH_PORT}/oauth/callback
5. Copy the Client ID and Client Secret
`);

    const googleClientId = await ask('Enter GOOGLE CLIENT ID: ');
    const googleClientSecret = await ask('Enter GOOGLE CLIENT SECRET: ');

    if (!googleClientId || !googleClientSecret) {
      console.log('⚠️  Skipping Google setup (no credentials provided)');
    } else {
      console.log('\nNow authorizing with Google...');
      console.log('A browser window will open. Sign in and grant permissions.\n');

      await ask('Press Enter to open browser...');

      try {
        const tokens = await doGoogleOAuth(googleClientId, googleClientSecret);

        console.log('\n✓ Google connected successfully!');
        console.log('✓ Gmail access granted');
        console.log('✓ Calendar access granted');

        config.google = {
          clientId: googleClientId,
          clientSecret: googleClientSecret,
          refreshToken: tokens.refreshToken,
        };
      } catch (err) {
        console.error('\n✗ Google OAuth failed:', err);
        console.log('\nYou can try again later by running: npm run setup\n');
      }
    }
  }

  // === SAVE CONFIG ===
  console.log('\n── SAVING CONFIGURATION ──\n');

  const configDir = join(homedir(), '.majordomo');
  const configPath = join(configDir, 'config.json');

  try {
    await mkdir(configDir, { recursive: true });
    await writeFile(configPath, JSON.stringify(config, null, 2));
    console.log(`✓ Configuration saved to: ${configPath}`);
  } catch (err) {
    console.error('Failed to save config:', err);
    process.exit(1);
  }

  // === TEST CONNECTION ===
  if (config.slack && (config.slack as Record<string, unknown>).enabled) {
    console.log('\n── TEST CONNECTION ──\n');
    const testConnection = await ask('Test Slack connection now? (y/n): ');

    if (testConnection.toLowerCase() === 'y') {
      console.log('\nTesting Slack connection...');

      try {
        const { App } = await import('@slack/bolt');
        const slackConfig = config.slack as {
          appToken: string;
          userToken?: string;
          botToken?: string;
        };

        const token = slackConfig.userToken || slackConfig.botToken;

        const app = new App({
          token,
          appToken: slackConfig.appToken,
          socketMode: true,
        });

        const auth = await app.client.auth.test();

        if (slackConfig.userToken) {
          console.log(`✓ Connected as: ${auth.user} (your account)`);
        } else {
          console.log(`✓ Connected as: @${auth.user} (bot)`);
        }
        console.log(`✓ Workspace: ${auth.team}`);
        console.log('✓ Slack connection successful!\n');
      } catch (err) {
        console.error('✗ Slack connection failed:', err);
        console.log('\nCheck your tokens and try again.\n');
      }
    }
  }

  // === DONE ===
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                     SETUP COMPLETE                           ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Start Majordomo:        npm start                           ║
║  Dev mode (auto-reload): npm run dev                         ║
║                                                              ║
║  Example commands:                                           ║
║  Slack:                                                      ║
║  • "tell david i'll be there in 5"                           ║
║  • "read my DMs from sarah"                                  ║
║  • "list my slack channels"                                  ║
║                                                              ║
║  Email:                                                      ║
║  • "send an email to bob@example.com"                        ║
║  • "show my recent emails"                                   ║
║  • "search emails from alice"                                ║
║                                                              ║
║  Calendar:                                                   ║
║  • "what's on my calendar this week"                         ║
║  • "schedule a meeting tomorrow at 2pm"                      ║
║  • "delete my 3pm meeting"                                   ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);

  rl.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Setup failed:', err);
  rl.close();
  process.exit(1);
});
