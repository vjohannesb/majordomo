/**
 * Majordomo Setup Script
 *
 * Run with: npm run setup or majordomo --setup
 *
 * Supports multi-account configuration for:
 * - Slack (OAuth)
 * - Google/Gmail/Calendar (OAuth)
 * - Discord (Bot token)
 * - Linear (API key)
 * - Notion (Integration token)
 */

import * as p from '@clack/prompts';
import * as http from 'node:http';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { exec } from 'node:child_process';
import color from 'picocolors';
import type {
  MajordomoConfig,
  SlackAccount,
  GoogleAccount,
  DiscordAccount,
  LinearAccount,
  NotionAccount,
} from '../config.js';

// OAuth credentials - loaded from environment or config
// Users can set these in .env or provide their own
const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID || '';
const SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

const OAUTH_PORT = 3456;
const REDIRECT_URI = `http://localhost:${OAUTH_PORT}/oauth/callback`;

// Google OAuth scopes for Gmail + Calendar
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

function openBrowser(url: string) {
  const cmd = process.platform === 'darwin' ? 'open' :
              process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} "${url}"`);
}

function isCancel(value: unknown): value is symbol {
  return p.isCancel(value);
}

function handleCancel() {
  p.cancel('Setup cancelled.');
  process.exit(0);
}

// ============================================================================
// OAuth Flows
// ============================================================================

interface SlackOAuthTokens {
  userToken?: string;
  botToken?: string;
  teamId?: string;
  teamName?: string;
}

async function doSlackOAuth(clientId: string, clientSecret: string): Promise<SlackOAuthTokens> {
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

        try {
          const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: clientId,
              client_secret: clientSecret,
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
                  <h1>Majordomo Connected!</h1>
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
      const oauthUrl = new URL('https://slack.com/oauth/v2/authorize');
      oauthUrl.searchParams.set('client_id', clientId);
      oauthUrl.searchParams.set('scope', 'chat:write,users:read,channels:read,channels:history,im:read');
      oauthUrl.searchParams.set('user_scope', 'chat:write,users:read,channels:read,channels:history,groups:read,groups:history,im:read,im:write,im:history,mpim:read');
      oauthUrl.searchParams.set('redirect_uri', REDIRECT_URI);
      openBrowser(oauthUrl.toString());
    });

    server.on('error', reject);
    setTimeout(() => {
      server.close();
      reject(new Error('OAuth timed out'));
    }, 5 * 60 * 1000);
  });
}

interface GoogleOAuthTokens {
  accessToken: string;
  refreshToken: string;
  email?: string;
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
            throw new Error('No refresh token received. Revoke access at https://myaccount.google.com/permissions and try again.');
          }

          let email: string | undefined;
          try {
            const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
              headers: { Authorization: `Bearer ${data.access_token}` },
            });
            const userInfo = await userInfoResponse.json() as { email?: string };
            email = userInfo.email;
          } catch {
            // Ignore
          }

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!DOCTYPE html>
            <html>
              <head><meta charset="utf-8"></head>
              <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: white;">
                <div style="text-align: center;">
                  <h1>Google Connected!</h1>
                  <p>You can close this window and return to the terminal.</p>
                </div>
              </body>
            </html>
          `);

          server.close();
          resolve({
            accessToken: data.access_token!,
            refreshToken: data.refresh_token!,
            email,
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
      const oauthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      oauthUrl.searchParams.set('client_id', clientId);
      oauthUrl.searchParams.set('redirect_uri', REDIRECT_URI);
      oauthUrl.searchParams.set('response_type', 'code');
      oauthUrl.searchParams.set('scope', GOOGLE_SCOPES);
      oauthUrl.searchParams.set('access_type', 'offline');
      oauthUrl.searchParams.set('prompt', 'consent');
      openBrowser(oauthUrl.toString());
    });

    server.on('error', reject);
    setTimeout(() => {
      server.close();
      reject(new Error('OAuth timed out'));
    }, 5 * 60 * 1000);
  });
}

// ============================================================================
// Config Management
// ============================================================================

async function loadExistingConfig(): Promise<MajordomoConfig> {
  const configPath = join(homedir(), '.majordomo', 'config.json');
  try {
    const content = await readFile(configPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {
      systemPrompt: '',
      tickInterval: 60000,
      accounts: {},
    };
  }
}

async function saveConfig(config: MajordomoConfig): Promise<void> {
  const configDir = join(homedir(), '.majordomo');
  const configPath = join(configDir, 'config.json');
  await mkdir(configDir, { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2));
}

// ============================================================================
// Account Setup Functions
// ============================================================================

async function addSlackAccount(): Promise<SlackAccount | null> {
  // Check for OAuth credentials
  let clientId = SLACK_CLIENT_ID;
  let clientSecret = SLACK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    p.note(
      `To use Slack OAuth, you need to create a Slack app:
1. Go to: https://api.slack.com/apps
2. Create New App -> From scratch
3. OAuth & Permissions -> Add scopes:
   Bot: chat:write, users:read, channels:read, channels:history, im:read
   User: chat:write, users:read, channels:read, channels:history, groups:read, groups:history, im:read, im:write, im:history, mpim:read
4. Install to Workspace
5. Copy Client ID and Client Secret from Basic Information`,
      'Slack App Setup'
    );

    const inputClientId = await p.text({
      message: 'Slack Client ID',
      validate: (v) => !v ? 'Required' : undefined,
    });
    if (isCancel(inputClientId)) return null;
    clientId = inputClientId as string;

    const inputClientSecret = await p.text({
      message: 'Slack Client Secret',
      validate: (v) => !v ? 'Required' : undefined,
    });
    if (isCancel(inputClientSecret)) return null;
    clientSecret = inputClientSecret as string;
  }

  const name = await p.text({
    message: 'Account name',
    placeholder: 'e.g., work, personal',
    validate: (v) => !v || v.length === 0 ? 'Name is required' : undefined,
  });
  if (isCancel(name)) return null;

  const proceed = await p.confirm({
    message: 'Open browser to sign in with Slack?',
  });
  if (isCancel(proceed) || !proceed) return null;

  const s = p.spinner();
  s.start('Waiting for Slack authorization...');

  try {
    const tokens = await doSlackOAuth(clientId, clientSecret);
    s.stop(`Connected to ${tokens.teamName}`);

    return {
      name: name as string,
      userToken: tokens.userToken,
      botToken: tokens.botToken,
      workspaceName: tokens.teamName,
    };
  } catch (err) {
    s.stop('Authorization failed');
    p.log.error(String(err));
    return null;
  }
}

async function addGoogleAccount(): Promise<GoogleAccount | null> {
  // Check for OAuth credentials
  let clientId = GOOGLE_CLIENT_ID;
  let clientSecret = GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    p.note(
      `To use Google OAuth, you need to create a Google Cloud project:
1. Go to: https://console.cloud.google.com/
2. Create a new project or select existing
3. Enable Gmail API and Google Calendar API
4. OAuth consent screen -> External -> Create
5. Credentials -> Create OAuth client ID -> Desktop app
6. Copy Client ID and Client Secret`,
      'Google OAuth Setup'
    );

    const inputClientId = await p.text({
      message: 'Google Client ID',
      validate: (v) => !v ? 'Required' : undefined,
    });
    if (isCancel(inputClientId)) return null;
    clientId = inputClientId as string;

    const inputClientSecret = await p.text({
      message: 'Google Client Secret',
      validate: (v) => !v ? 'Required' : undefined,
    });
    if (isCancel(inputClientSecret)) return null;
    clientSecret = inputClientSecret as string;
  }

  const name = await p.text({
    message: 'Account name',
    placeholder: 'e.g., work, personal',
    validate: (v) => !v || v.length === 0 ? 'Name is required' : undefined,
  });
  if (isCancel(name)) return null;

  const proceed = await p.confirm({
    message: 'Open browser to sign in with Google?',
  });
  if (isCancel(proceed) || !proceed) return null;

  const s = p.spinner();
  s.start('Waiting for Google authorization...');

  try {
    const tokens = await doGoogleOAuth(clientId, clientSecret);
    s.stop(tokens.email ? `Connected as ${tokens.email}` : 'Connected');

    return {
      name: name as string,
      email: tokens.email,
      clientId,
      clientSecret,
      refreshToken: tokens.refreshToken,
    };
  } catch (err) {
    s.stop('Authorization failed');
    p.log.error(String(err));
    return null;
  }
}

async function addDiscordAccount(): Promise<DiscordAccount | null> {
  const name = await p.text({
    message: 'Account name',
    placeholder: 'e.g., gaming, server-bot',
    validate: (v) => !v || v.length === 0 ? 'Name is required' : undefined,
  });
  if (isCancel(name)) return null;

  p.note(
    `1. Go to: https://discord.com/developers/applications
2. New Application -> Bot section -> Add Bot
3. Enable MESSAGE CONTENT INTENT
4. Reset Token to get bot token
5. OAuth2 -> URL Generator -> bot scope -> Send/Read Messages
6. Use generated URL to add bot to your server`,
    'Create Discord Bot'
  );

  const botToken = await p.text({
    message: 'Bot Token',
    validate: (v) => !v || v.length === 0 ? 'Required' : undefined,
  });
  if (isCancel(botToken)) return null;

  return {
    name: name as string,
    botToken: botToken as string,
  };
}

async function addLinearAccount(): Promise<LinearAccount | null> {
  const name = await p.text({
    message: 'Account name',
    placeholder: 'e.g., work',
    validate: (v) => !v || v.length === 0 ? 'Name is required' : undefined,
  });
  if (isCancel(name)) return null;

  p.note(
    `1. Go to: https://linear.app/settings/api
2. Create key -> Copy the API key (lin_api_...)`,
    'Get Linear API Key'
  );

  const apiKey = await p.text({
    message: 'API Key (lin_api_...)',
    validate: (v) => {
      if (!v) return 'Required';
      if (!v.startsWith('lin_api_')) return 'Should start with lin_api_';
      return undefined;
    },
  });
  if (isCancel(apiKey)) return null;

  return {
    name: name as string,
    apiKey: apiKey as string,
  };
}

async function addNotionAccount(): Promise<NotionAccount | null> {
  const name = await p.text({
    message: 'Account name',
    placeholder: 'e.g., work',
    validate: (v) => !v || v.length === 0 ? 'Name is required' : undefined,
  });
  if (isCancel(name)) return null;

  p.note(
    `1. Go to: https://www.notion.so/my-integrations
2. New integration -> Submit
3. Copy Internal Integration Secret (secret_...)
4. Share pages with integration: ... -> Add connections`,
    'Create Notion Integration'
  );

  const integrationToken = await p.text({
    message: 'Integration Token (secret_...)',
    validate: (v) => {
      if (!v) return 'Required';
      if (!v.startsWith('secret_')) return 'Should start with secret_';
      return undefined;
    },
  });
  if (isCancel(integrationToken)) return null;

  return {
    name: name as string,
    integrationToken: integrationToken as string,
  };
}

// ============================================================================
// Account Management Menu
// ============================================================================

async function manageAccounts<T extends { name: string; isDefault?: boolean }>(
  serviceName: string,
  accounts: T[],
  getLabel: (a: T) => string,
  addFn: () => Promise<T | null>,
): Promise<T[]> {
  while (true) {
    const options: { value: string; label: string; hint?: string }[] = [
      { value: 'add', label: 'Add new account' },
    ];

    if (accounts.length > 0) {
      options.push({ value: 'default', label: 'Set default account' });
      options.push({ value: 'remove', label: 'Remove account' });
    }
    options.push({ value: 'back', label: 'Back to main menu' });

    // Show current accounts
    if (accounts.length > 0) {
      const accountList = accounts
        .map(a => `${a.name}${a.isDefault ? ' (default)' : ''} - ${getLabel(a)}`)
        .join('\n');
      p.note(accountList, `${serviceName} Accounts`);
    } else {
      p.log.info(`No ${serviceName} accounts configured`);
    }

    const action = await p.select({
      message: `Manage ${serviceName}`,
      options,
    });

    if (isCancel(action)) return accounts;

    switch (action) {
      case 'add': {
        const newAccount = await addFn();
        if (newAccount) {
          if (accounts.length === 0) newAccount.isDefault = true;
          accounts.push(newAccount);
          p.log.success(`Added ${serviceName} account: ${newAccount.name}`);
        }
        break;
      }

      case 'default': {
        if (accounts.length === 0) break;
        const choice = await p.select({
          message: 'Set as default',
          options: accounts.map((a, i) => ({
            value: String(i),
            label: a.name,
            hint: getLabel(a),
          })),
        });
        if (!isCancel(choice)) {
          accounts.forEach(a => a.isDefault = false);
          const idx = parseInt(choice as string);
          const account = accounts[idx];
          if (account) {
            account.isDefault = true;
            p.log.success(`Set ${account.name} as default`);
          }
        }
        break;
      }

      case 'remove': {
        if (accounts.length === 0) break;
        const choice = await p.select({
          message: 'Remove account',
          options: accounts.map((a, i) => ({
            value: String(i),
            label: a.name,
            hint: getLabel(a),
          })),
        });
        if (!isCancel(choice)) {
          const idx = parseInt(choice as string);
          const removed = accounts.splice(idx, 1)[0];
          if (removed) {
            p.log.success(`Removed ${removed.name}`);
            if (removed.isDefault && accounts.length > 0) {
              const first = accounts[0];
              if (first) first.isDefault = true;
            }
          }
        }
        break;
      }

      case 'back':
        return accounts;
    }
  }
}

// ============================================================================
// Main Export
// ============================================================================

export async function runSetup() {
  console.clear();
  p.intro(color.bgCyan(color.black(' Majordomo Setup ')));

  const config = await loadExistingConfig();
  config.accounts = config.accounts || {};

  while (true) {
    const slackCount = config.accounts.slack?.length || 0;
    const googleCount = config.accounts.google?.length || 0;
    const discordCount = config.accounts.discord?.length || 0;
    const linearCount = config.accounts.linear?.length || 0;
    const notionCount = config.accounts.notion?.length || 0;

    const choice = await p.select({
      message: 'Configure integrations',
      options: [
        {
          value: 'slack',
          label: 'Slack',
          hint: slackCount > 0 ? color.green(`${slackCount} account(s)`) : color.yellow('not configured'),
        },
        {
          value: 'google',
          label: 'Google (Gmail + Calendar)',
          hint: googleCount > 0 ? color.green(`${googleCount} account(s)`) : color.yellow('not configured'),
        },
        {
          value: 'discord',
          label: 'Discord',
          hint: discordCount > 0 ? color.green(`${discordCount} account(s)`) : color.yellow('not configured'),
        },
        {
          value: 'linear',
          label: 'Linear',
          hint: linearCount > 0 ? color.green(`${linearCount} account(s)`) : color.yellow('not configured'),
        },
        {
          value: 'notion',
          label: 'Notion',
          hint: notionCount > 0 ? color.green(`${notionCount} account(s)`) : color.yellow('not configured'),
        },
        { value: 'save', label: color.green('Save and exit') },
        { value: 'quit', label: color.dim('Quit without saving') },
      ],
    });

    if (isCancel(choice)) handleCancel();

    switch (choice) {
      case 'slack':
        config.accounts.slack = await manageAccounts(
          'Slack',
          config.accounts.slack || [],
          (a) => a.workspaceName || 'Workspace',
          addSlackAccount
        );
        break;

      case 'google':
        config.accounts.google = await manageAccounts(
          'Google',
          config.accounts.google || [],
          (a) => a.email || 'Email/Calendar',
          addGoogleAccount
        );
        break;

      case 'discord':
        config.accounts.discord = await manageAccounts(
          'Discord',
          config.accounts.discord || [],
          () => 'Bot',
          addDiscordAccount
        );
        break;

      case 'linear':
        config.accounts.linear = await manageAccounts(
          'Linear',
          config.accounts.linear || [],
          () => 'API key configured',
          addLinearAccount
        );
        break;

      case 'notion':
        config.accounts.notion = await manageAccounts(
          'Notion',
          config.accounts.notion || [],
          () => 'Integration configured',
          addNotionAccount
        );
        break;

      case 'save': {
        const s = p.spinner();
        s.start('Saving configuration...');
        try {
          await saveConfig(config);
          s.stop('Configuration saved');
        } catch (err) {
          s.stop('Failed to save');
          p.log.error(String(err));
          process.exit(1);
        }

        p.note(
          `Start Majordomo:  ${color.cyan('npm start')}
Dev mode:         ${color.cyan('npm run dev')}

Example commands:
  "list my channels on work slack"
  "send email from personal to bob@example.com"
  "list my discord servers"
  "create linear issue Fix bug"
  "search notion for meeting notes"`,
          'Setup Complete'
        );

        p.outro('Happy automating!');
        return;
      }

      case 'quit':
        p.outro('Exiting without saving');
        process.exit(0);
    }
  }
}

// Allow running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runSetup().catch((err) => {
    p.log.error(String(err));
    process.exit(1);
  });
}
