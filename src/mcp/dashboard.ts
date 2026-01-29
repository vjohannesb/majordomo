/**
 * Dashboard UI
 *
 * Provides HTML pages for user configuration and service management.
 */

import type { User, UserSettings } from './db.js';
import { getOAuthTokens, getUserSettings } from './db.js';
import { generateApiKey } from './auth.js';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

interface ServiceConfig {
  id: string;
  name: string;
  icon: string;
  description: string;
  authType: 'oauth' | 'apikey';
  authUrl?: string;
  connected: boolean;
  accounts: { name: string; email?: string }[];
}

/**
 * Get list of services and their connection status for a user
 */
export async function getServicesStatus(userId: string): Promise<ServiceConfig[]> {
  const tokens = await getOAuthTokens(userId);

  const googleTokens = tokens.filter(t => t.provider === 'google');
  const slackTokens = tokens.filter(t => t.provider === 'slack');
  const linearTokens = tokens.filter(t => t.provider === 'linear');
  const notionTokens = tokens.filter(t => t.provider === 'notion');

  return [
    {
      id: 'google',
      name: 'Google',
      icon: '📧',
      description: 'Gmail & Calendar access',
      authType: 'oauth',
      authUrl: '/auth/google',
      connected: googleTokens.length > 0,
      accounts: googleTokens.map(t => ({ name: t.accountName, email: t.accountName })),
    },
    {
      id: 'slack',
      name: 'Slack',
      icon: '💬',
      description: 'Send and read Slack messages',
      authType: 'oauth',
      authUrl: '/auth/slack',
      connected: slackTokens.length > 0,
      accounts: slackTokens.map(t => ({ name: t.accountName })),
    },
    {
      id: 'linear',
      name: 'Linear',
      icon: '📋',
      description: 'Issue tracking and project management',
      authType: 'oauth',
      authUrl: '/auth/linear',
      connected: linearTokens.length > 0,
      accounts: linearTokens.map(t => ({ name: t.accountName })),
    },
    {
      id: 'notion',
      name: 'Notion',
      icon: '📝',
      description: 'Notes and documentation',
      authType: 'oauth',
      authUrl: '/auth/notion',
      connected: notionTokens.length > 0,
      accounts: notionTokens.map(t => ({ name: t.accountName })),
    },
  ];
}

/**
 * Render the main dashboard page
 */
export async function renderDashboard(user: User): Promise<string> {
  const services = await getServicesStatus(user.id);
  const apiKey = generateApiKey(user.id);
  const connectedCount = services.filter(s => s.connected).length;
  const settings = await getUserSettings(user.id);
  const notificationChannel = settings?.notificationChannel || 'none';
  const hasSlack = services.find(s => s.id === 'slack')?.connected || false;

  const serviceCards = services.map(service => {
    const accountsList = service.accounts.length > 0
      ? service.accounts.map(a => `<span class="account-badge">${a.email || a.name}</span>`).join('')
      : '';

    const actionButton = service.connected
      ? `<a href="/services/${service.id}/manage" class="btn btn-secondary">Manage</a>`
      : service.authType === 'oauth'
        ? `<a href="${service.authUrl}" class="btn btn-primary">Connect</a>`
        : `<a href="/services/${service.id}/setup" class="btn btn-primary">Add API Key</a>`;

    return `
      <div class="service-card ${service.connected ? 'connected' : ''}">
        <div class="service-header">
          <span class="service-icon">${service.icon}</span>
          <div class="service-info">
            <h3>${service.name}</h3>
            <p>${service.description}</p>
          </div>
          <span class="status-badge ${service.connected ? 'status-connected' : 'status-disconnected'}">
            ${service.connected ? 'Connected' : 'Not connected'}
          </span>
        </div>
        ${accountsList ? `<div class="accounts-list">${accountsList}</div>` : ''}
        <div class="service-actions">
          ${actionButton}
          ${service.connected ? `<a href="/services/${service.id}/disconnect" class="btn btn-danger">Disconnect</a>` : ''}
        </div>
      </div>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <title>Majordomo Dashboard</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      color: #333;
      line-height: 1.6;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 20px;
    }
    header {
      background: #000;
      color: #fff;
      padding: 20px;
      margin-bottom: 30px;
    }
    header h1 { font-size: 24px; font-weight: 600; }
    header .user-info {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 10px;
      font-size: 14px;
      opacity: 0.8;
    }
    header .user-info img {
      width: 32px;
      height: 32px;
      border-radius: 50%;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: #fff;
      padding: 20px;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .stat-card h4 { color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    .stat-card .value { font-size: 32px; font-weight: 600; margin-top: 5px; }

    section { margin-bottom: 30px; }
    section h2 {
      font-size: 18px;
      margin-bottom: 15px;
      color: #333;
    }

    .service-card {
      background: #fff;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 15px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      border-left: 4px solid #ddd;
    }
    .service-card.connected { border-left-color: #22c55e; }
    .service-header {
      display: flex;
      align-items: flex-start;
      gap: 15px;
    }
    .service-icon { font-size: 32px; }
    .service-info { flex: 1; }
    .service-info h3 { font-size: 16px; font-weight: 600; }
    .service-info p { font-size: 13px; color: #666; }
    .status-badge {
      font-size: 12px;
      padding: 4px 10px;
      border-radius: 20px;
      font-weight: 500;
    }
    .status-connected { background: #dcfce7; color: #166534; }
    .status-disconnected { background: #f3f4f6; color: #6b7280; }
    .accounts-list {
      margin: 15px 0;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .account-badge {
      background: #e5e7eb;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 13px;
    }
    .service-actions {
      display: flex;
      gap: 10px;
      margin-top: 15px;
    }

    .btn {
      display: inline-block;
      padding: 8px 16px;
      border-radius: 8px;
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      border: none;
    }
    .btn-primary { background: #000; color: #fff; }
    .btn-primary:hover { background: #333; }
    .btn-secondary { background: #f3f4f6; color: #333; }
    .btn-secondary:hover { background: #e5e7eb; }
    .btn-danger { background: #fee2e2; color: #dc2626; }
    .btn-danger:hover { background: #fecaca; }

    .config-box {
      background: #fff;
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .config-box h3 { font-size: 14px; margin-bottom: 10px; }
    .config-box pre {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 8px;
      overflow-x: auto;
      font-size: 12px;
      line-height: 1.5;
    }
    .config-box code { font-family: 'Monaco', 'Consolas', monospace; }

    .copy-btn {
      margin-top: 10px;
      background: #f3f4f6;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
    }
    .copy-btn:hover { background: #e5e7eb; }

    footer {
      text-align: center;
      padding: 30px;
      color: #666;
      font-size: 13px;
    }
    footer a { color: #333; }
  </style>
</head>
<body>
  <header>
    <div class="container">
      <h1>Majordomo</h1>
      <div class="user-info">
        ${user.picture ? `<img src="${user.picture}" alt="">` : ''}
        <span>${user.name || user.email}</span>
        <span>•</span>
        <a href="/auth/logout" style="color: #fff; opacity: 0.7;">Logout</a>
      </div>
    </div>
  </header>

  <main class="container">
    <div class="stats">
      <div class="stat-card">
        <h4>Connected Services</h4>
        <div class="value">${connectedCount}</div>
      </div>
      <div class="stat-card">
        <h4>Available Tools</h4>
        <div class="value">${connectedCount * 3}+</div>
      </div>
    </div>

    <section>
      <h2>Connected Services</h2>
      ${serviceCards}
    </section>

    <section>
      <h2>Notifications</h2>
      <div class="config-box">
        <p style="margin-bottom: 15px; color: #666;">
          Get notified when things happen in Linear, Notion, and other services.
        </p>
        <form method="POST" action="/settings/notifications" style="display: flex; flex-direction: column; gap: 15px;">
          <div>
            <label style="display: block; margin-bottom: 8px; font-weight: 500;">Notification Channel</label>
            <select name="channel" style="width: 100%; padding: 10px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 14px;">
              <option value="none" ${notificationChannel === 'none' ? 'selected' : ''}>Disabled</option>
              <option value="slack" ${notificationChannel === 'slack' ? 'selected' : ''} ${!hasSlack ? 'disabled' : ''}>
                Slack ${!hasSlack ? '(connect Slack first)' : ''}
              </option>
              <option value="email" ${notificationChannel === 'email' ? 'selected' : ''}>Email (via Gmail)</option>
            </select>
          </div>
          <button type="submit" class="btn btn-primary" style="align-self: flex-start;">Save Preferences</button>
        </form>
      </div>

      <div class="config-box" style="margin-top: 15px;">
        <h3>Webhook URLs</h3>
        <p style="font-size: 13px; color: #666; margin-bottom: 10px;">
          Configure these URLs in Linear and Notion to receive real-time updates.
        </p>
        <div style="margin-bottom: 10px;">
          <label style="font-size: 12px; color: #888;">Linear Webhook URL:</label>
          <code style="display: block; background: #f8f9fa; padding: 8px; border-radius: 4px; font-size: 12px;">${BASE_URL}/webhooks/linear</code>
        </div>
        <div>
          <label style="font-size: 12px; color: #888;">Notion Webhook URL:</label>
          <code style="display: block; background: #f8f9fa; padding: 8px; border-radius: 4px; font-size: 12px;">${BASE_URL}/webhooks/notion</code>
        </div>
      </div>
    </section>

    <section>
      <h2>MCP Configuration</h2>
      <div class="config-box">
        <h3>One-Click Install</h3>
        <p style="font-size: 13px; color: #666; margin-bottom: 15px;">
          Click to add Majordomo to your favorite editor:
        </p>
        <div style="display: flex; flex-wrap: wrap; gap: 10px;">
          ${(() => {
            const mcpConfig = {
              url: `${BASE_URL}/mcp/sse`,
              headers: { Authorization: `Bearer ${apiKey}` }
            };
            const cursorConfig = Buffer.from(JSON.stringify(mcpConfig)).toString('base64');
            const cursorLink = `cursor://anysphere.cursor-deeplink/mcp/install?name=Majordomo&config=${cursorConfig}`;

            const vscodeConfig = { name: 'majordomo', ...mcpConfig };
            const vscodeLink = `vscode:mcp/install?${encodeURIComponent(JSON.stringify(vscodeConfig))}`;
            const vscodeInsidersLink = `vscode-insiders:mcp/install?${encodeURIComponent(JSON.stringify(vscodeConfig))}`;

            return `
              <a href="${cursorLink}" class="install-btn" style="background: #000; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500; display: inline-flex; align-items: center; gap: 8px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                Add to Cursor
              </a>
              <a href="${vscodeLink}" class="install-btn" style="background: #007ACC; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500; display: inline-flex; align-items: center; gap: 8px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.583 2.265L8.542 9.448 4.135 6.21l-1.468.813v9.953l1.468.813 4.407-3.238 9.041 7.183 3.75-1.851V4.116l-3.75-1.85zM6 15.57V8.43l3.417 3.57L6 15.57zm11.583 1.393l-6.25-4.963 6.25-4.963v9.926z"/></svg>
                Add to VS Code
              </a>
              <a href="${vscodeInsidersLink}" class="install-btn" style="background: #24A97A; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500; display: inline-flex; align-items: center; gap: 8px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.583 2.265L8.542 9.448 4.135 6.21l-1.468.813v9.953l1.468.813 4.407-3.238 9.041 7.183 3.75-1.851V4.116l-3.75-1.85zM6 15.57V8.43l3.417 3.57L6 15.57zm11.583 1.393l-6.25-4.963 6.25-4.963v9.926z"/></svg>
                VS Code Insiders
              </a>
            `;
          })()}
        </div>
      </div>

      <div class="config-box" style="margin-top: 15px;">
        <h3>Claude Desktop</h3>
        <p style="font-size: 13px; color: #666; margin-bottom: 10px;">
          In Claude Desktop, go to Settings &rarr; MCP &rarr; Add Server. Enter the URL below and sign in with Google.
        </p>
        <pre><code>${BASE_URL}/mcp/sse</code></pre>
        <button class="copy-btn" onclick="navigator.clipboard.writeText('${BASE_URL}/mcp/sse')">
          Copy URL
        </button>
        <p style="font-size: 11px; color: #888; margin-top: 8px;">
          Claude Desktop uses OAuth - it will open a sign-in page automatically.
        </p>
      </div>

      <div class="config-box" style="margin-top: 15px;">
        <h3>Claude Code &amp; Other Clients</h3>
        <p style="font-size: 13px; color: #666; margin-bottom: 10px;">
          For Claude Code CLI and clients that use API keys:
        </p>
        <pre><code>{
  "mcpServers": {
    "majordomo": {
      "url": "${BASE_URL}/mcp/sse",
      "headers": {
        "Authorization": "Bearer ${apiKey}"
      }
    }
  }
}</code></pre>
        <button class="copy-btn" onclick="navigator.clipboard.writeText(this.previousElementSibling.textContent)">
          Copy Configuration
        </button>
      </div>

      <div class="config-box" style="margin-top: 15px;">
        <h3>Your API Key</h3>
        <pre><code>${apiKey}</code></pre>
        <p style="font-size: 12px; color: #666; margin-top: 10px;">
          Keep this key secret. Use it to authenticate MCP requests.
        </p>
      </div>
    </section>
  </main>

  <footer>
    <a href="/">Home</a> •
    <a href="/mcp/tools">View Tools</a> •
    <a href="https://github.com/vjohannesb/majordomo">GitHub</a>
  </footer>
</body>
</html>
  `;
}

/**
 * Render API key setup page for a service
 */
export function renderApiKeySetup(service: string): string {
  const configs: Record<string, { name: string; instructions: string; placeholder: string }> = {
    // Currently all services use OAuth, but keeping this structure for future API key services
  };

  const config = configs[service];
  if (!config) {
    return '<html><body>Unknown service</body></html>';
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <title>Connect ${config.name} - Majordomo</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: #fff;
      border-radius: 16px;
      padding: 40px;
      max-width: 500px;
      width: 100%;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    }
    h1 { font-size: 24px; margin-bottom: 10px; }
    .instructions {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 8px;
      margin: 20px 0;
      font-size: 14px;
      color: #666;
    }
    label { display: block; font-weight: 500; margin-bottom: 8px; }
    input[type="text"] {
      width: 100%;
      padding: 12px;
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      font-size: 14px;
      font-family: monospace;
    }
    input[type="text"]:focus {
      outline: none;
      border-color: #000;
    }
    .form-group { margin-bottom: 20px; }
    button {
      width: 100%;
      padding: 14px;
      background: #000;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 500;
      cursor: pointer;
    }
    button:hover { background: #333; }
    .back-link {
      display: block;
      text-align: center;
      margin-top: 20px;
      color: #666;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Connect ${config.name}</h1>
    <div class="instructions">${config.instructions}</div>

    <form method="POST" action="/services/${service}/setup">
      <div class="form-group">
        <label>Account Name</label>
        <input type="text" name="accountName" placeholder="e.g., work, personal" required>
      </div>
      <div class="form-group">
        <label>API Key</label>
        <input type="text" name="apiKey" placeholder="${config.placeholder}" required>
      </div>
      <button type="submit">Connect ${config.name}</button>
    </form>

    <a href="/dashboard" class="back-link">← Back to Dashboard</a>
  </div>
</body>
</html>
  `;
}

/**
 * Render service management page
 */
export async function renderServiceManage(userId: string, service: string): Promise<string> {
  const tokens = await getOAuthTokens(userId, service);

  const serviceNames: Record<string, string> = {
    google: 'Google',
    slack: 'Slack',
    linear: 'Linear',
    notion: 'Notion',
  };

  const accountsList = tokens.map(t => `
    <div class="account-item">
      <span>${t.accountName}</span>
      <a href="/services/${service}/disconnect?account=${encodeURIComponent(t.accountName)}" class="btn btn-danger btn-sm">Remove</a>
    </div>
  `).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <title>Manage ${serviceNames[service] || service} - Majordomo</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      min-height: 100vh;
      padding: 40px 20px;
    }
    .container { max-width: 600px; margin: 0 auto; }
    h1 { font-size: 24px; margin-bottom: 30px; }
    .account-item {
      background: #fff;
      padding: 15px 20px;
      border-radius: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .btn {
      padding: 8px 16px;
      border-radius: 6px;
      text-decoration: none;
      font-size: 14px;
    }
    .btn-danger { background: #fee2e2; color: #dc2626; }
    .btn-primary { background: #000; color: #fff; }
    .btn-sm { padding: 6px 12px; font-size: 13px; }
    .actions { margin-top: 30px; display: flex; gap: 10px; }
    .back-link { color: #666; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Manage ${serviceNames[service] || service}</h1>

    <h3 style="margin-bottom: 15px; font-size: 14px; color: #666;">Connected Accounts</h3>
    ${accountsList || '<p style="color: #666;">No accounts connected.</p>'}

    <div class="actions">
      ${['google', 'slack', 'linear', 'notion'].includes(service)
        ? `<a href="/auth/${service}" class="btn btn-primary">Add Another Account</a>`
        : `<a href="/services/${service}/setup" class="btn btn-primary">Add Another Account</a>`
      }
      <a href="/dashboard" class="back-link">← Back to Dashboard</a>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Render a callback result page (success or error)
 */
export function renderCallbackPage(options: {
  type: 'success' | 'error';
  title: string;
  message: string;
  service?: string;
  redirectUrl?: string;
  redirectDelay?: number;
}): string {
  const {
    type,
    title,
    message,
    service,
    redirectUrl = '/dashboard',
    redirectDelay = 3,
  } = options;

  const icons: Record<string, string> = {
    google: '📧',
    slack: '💬',
    linear: '📋',
    notion: '📝',
  };

  const icon = type === 'success'
    ? (service ? icons[service] || '✓' : '✓')
    : '⚠️';

  const bgColor = type === 'success' ? '#22c55e' : '#ef4444';
  const bgColorLight = type === 'success' ? '#dcfce7' : '#fee2e2';

  return `
<!DOCTYPE html>
<html>
<head>
  <title>${title} - Majordomo</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="${redirectDelay};url=${redirectUrl}">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #f5f5f5 0%, #e5e5e5 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: #fff;
      border-radius: 20px;
      padding: 50px 40px;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 10px 40px rgba(0,0,0,0.1);
      text-align: center;
      animation: slideUp 0.4s ease-out;
    }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .icon {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: ${bgColorLight};
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
      font-size: 36px;
    }
    .icon-inner {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: ${bgColor};
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 28px;
    }
    h1 {
      font-size: 24px;
      font-weight: 600;
      color: #111;
      margin-bottom: 12px;
    }
    .message {
      font-size: 16px;
      color: #666;
      line-height: 1.5;
      margin-bottom: 32px;
    }
    .redirect-notice {
      font-size: 13px;
      color: #999;
      margin-bottom: 16px;
    }
    .progress-bar {
      width: 100%;
      height: 4px;
      background: #e5e7eb;
      border-radius: 2px;
      overflow: hidden;
      margin-bottom: 24px;
    }
    .progress-fill {
      height: 100%;
      background: ${bgColor};
      border-radius: 2px;
      animation: progress ${redirectDelay}s linear forwards;
    }
    @keyframes progress {
      from { width: 0%; }
      to { width: 100%; }
    }
    .btn {
      display: inline-block;
      padding: 12px 24px;
      background: #000;
      color: #fff;
      text-decoration: none;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 500;
      transition: background 0.2s;
    }
    .btn:hover {
      background: #333;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <div class="icon-inner">${icon}</div>
    </div>
    <h1>${title}</h1>
    <p class="message">${message}</p>
    <p class="redirect-notice">Redirecting to dashboard in ${redirectDelay} seconds...</p>
    <div class="progress-bar">
      <div class="progress-fill"></div>
    </div>
    <a href="${redirectUrl}" class="btn">Go to Dashboard</a>
  </div>
</body>
</html>
  `;
}
