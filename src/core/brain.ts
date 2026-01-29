/**
 * Brain - The AI decision maker
 *
 * Spawns Claude Code with access to Majordomo's tools via MCP.
 * Claude has full access to all its native tools PLUS our integrations.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Debug mode - set via environment variable or programmatically
export let DEBUG = process.env.MAJORDOMO_DEBUG === '1' || process.env.DEBUG === '1';

export function setDebug(enabled: boolean) {
  DEBUG = enabled;
}

function debug(label: string, ...args: unknown[]) {
  if (DEBUG) {
    console.log(`\x1b[90m[${label}]\x1b[0m`, ...args);
  }
}

// Build MCP config for our tools
function getMcpConfig(): object {
  const mcpServerPath = join(__dirname, '..', 'mcp-server.js');

  return {
    mcpServers: {
      majordomo: {
        command: 'node',
        args: [mcpServerPath],
      },
    },
  };
}

const SYSTEM_PROMPT_ADDITION = `
You are Majordomo, a personal AI assistant with access to various integrations.

You have access to Majordomo tools (prefixed with majordomo_) for:
- Slack: Send/read messages, list channels and users
- Email (Gmail): Send/read/search emails
- Calendar (Google): List/create/delete events
- Discord: Send/read messages, list servers
- Linear: List/create/update issues
- Notion: Search/read/create pages

When the user asks you to do something with these services, use the appropriate majordomo_ tool.
You also have access to all your normal tools (web search, file operations, etc.) - use whatever is most helpful.

Be concise and helpful. When executing actions that send messages or create things, confirm with the user first.
`;

export interface ThinkResult {
  response: string;
  sessionId?: string;
}

/**
 * Ask Claude to handle a user request.
 * Claude has full access to all its tools plus Majordomo integrations via MCP.
 */
export async function think(userMessage: string, sessionId?: string): Promise<ThinkResult> {
  const mcpConfig = getMcpConfig();

  const args = [
    '-p',
    '--output-format', 'json',
    '--append-system-prompt', SYSTEM_PROMPT_ADDITION,
    '--mcp-config', JSON.stringify(mcpConfig),
  ];

  // Continue session if provided
  if (sessionId) {
    args.push('--resume', sessionId);
  }

  args.push(userMessage);

  if (DEBUG) {
    debug('brain', 'spawning claude with args:', args);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (DEBUG) {
        debug('brain', 'exit code:', code);
        debug('brain', 'stdout:', stdout);
        if (stderr) debug('brain', 'stderr:', stderr);
      }

      if (code !== 0) {
        reject(new Error(`Claude exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        const response = JSON.parse(stdout);

        resolve({
          response: response.result || stdout,
          sessionId: response.session_id,
        });
      } catch {
        // If JSON parsing fails, return raw output
        resolve({
          response: stdout.trim(),
        });
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });
  });
}

/**
 * Interactive mode - spawn Claude in interactive mode with MCP tools.
 * Returns the child process so caller can manage it.
 */
export function spawnInteractive(): ChildProcess {
  const mcpConfig = getMcpConfig();

  const args = [
    '--append-system-prompt', SYSTEM_PROMPT_ADDITION,
    '--mcp-config', JSON.stringify(mcpConfig),
  ];

  if (DEBUG) {
    args.push('--verbose');
  }

  return spawn('claude', args, {
    stdio: 'inherit',
    env: { ...process.env },
  });
}
