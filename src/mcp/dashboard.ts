/**
 * Dashboard UI
 *
 * Provides HTML pages for user configuration and service management.
 */

import type { User } from './db.js';
import { getOAuthTokens } from './db.js';
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
  const discordTokens = tokens.filter(t => t.provider === 'discord');

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
      authType: 'apikey',
      connected: linearTokens.length > 0,
      accounts: linearTokens.map(t => ({ name: t.accountName })),
    },
    {
      id: 'notion',
      name: 'Notion',
      icon: '📝',
      description: 'Notes and documentation',
      authType: 'apikey',
      connected: notionTokens.length > 0,
      accounts: notionTokens.map(t => ({ name: t.accountName })),
    },
    {
      id: 'discord',
      name: 'Discord',
      icon: '🎮',
      description: 'Discord messaging',
      authType: 'apikey',
      connected: discordTokens.length > 0,
      accounts: discordTokens.map(t => ({ name: t.accountName })),
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
      <h2>MCP Configuration</h2>
      <div class="config-box">
        <h3>Add to Claude Desktop / Claude Code</h3>
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
    linear: {
      name: 'Linear',
      instructions: 'Go to Linear Settings → Account → Security & Access → Personal API keys → Create key',
      placeholder: 'lin_api_xxxxxxxxxxxx',
    },
    notion: {
      name: 'Notion',
      instructions: 'Go to notion.so/my-integrations → Create new integration → Copy the Internal Integration Token',
      placeholder: 'ntn_xxxxxxxxxxxx or secret_xxxxxxxxxxxx',
    },
    discord: {
      name: 'Discord',
      instructions: 'Go to discord.com/developers/applications → Create application → Bot → Copy token',
      placeholder: 'MTxxxxxx.xxxxxx.xxxxxx',
    },
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
    discord: 'Discord',
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
      ${service === 'google' || service === 'slack'
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
