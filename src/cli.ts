#!/usr/bin/env node
/**
 * Majordomo CLI
 *
 * Your personal AI assistant.
 * Access to Slack, Email, Calendar, Discord, Linear, Notion, and more.
 *
 * Usage:
 *   majordomo                     - Interactive mode
 *   majordomo "what's up today?"  - Quick query
 *   majordomo -c                  - Continue last conversation
 *   majordomo --setup             - Configure accounts
 *   majordomo --serve             - Start HTTP gateway server
 */

import { createInterface } from 'node:readline';
import { AgentRunner, SessionManager } from './agent/index.js';

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

// Parse arguments
const args = process.argv.slice(2);
const continueSession = args.includes('-c') || args.includes('--continue');
const showHelp = args.includes('-h') || args.includes('--help');
const runSetup = args.includes('--setup');
const runServe = args.includes('--serve');
const portArg = args.find((a) => a.startsWith('--port='));
const port = portArg ? parseInt(portArg.split('=')[1] || '3000') : 3000;

// Filter out flags to get the message
const message = args.filter((a) => !a.startsWith('-')).join(' ');

function printBanner() {
  console.log(`
${CYAN}╔══════════════════════════════════════════════════════════════╗
║                       ${BOLD}MAJORDOMO${RESET}${CYAN}                               ║
║              Your AI-powered life manager                    ║
╚══════════════════════════════════════════════════════════════╝${RESET}
`);
}

function printHelp() {
  console.log(`
${BOLD}Usage:${RESET}
  majordomo                     Interactive mode
  majordomo "message"           Quick query (non-interactive)
  majordomo -c                  Continue last conversation
  majordomo -c "message"        Continue with a new message
  majordomo --setup             Configure accounts
  majordomo --serve             Start HTTP gateway server
  majordomo --serve --port=8080 Start gateway on custom port

${BOLD}Examples:${RESET}
  majordomo "what's on my calendar today?"
  majordomo "check my slack messages"
  majordomo "send an email to bob@example.com"
  majordomo -c "what else did they say?"

${BOLD}API Endpoints (when using --serve):${RESET}
  POST /api/chat          Send a message (JSON: {message, sessionId?})
  POST /api/chat/stream   Send with SSE streaming
  GET  /api/sessions      List all sessions
  GET  /api/sessions/:id  Get session details
  GET  /health            Health check

${BOLD}Environment:${RESET}
  ANTHROPIC_API_KEY    Required. Your Anthropic API key.
`);
}

async function runSingleQuery(userMessage: string, sessionId?: string) {
  const agent = new AgentRunner();
  let currentText = '';

  // Stream text as it arrives
  agent.on('text', (chunk) => {
    process.stdout.write(chunk);
    currentText += chunk;
  });

  // Show tool usage
  agent.on('tool:start', (name, input) => {
    process.stdout.write(`\n${DIM}[Using ${name}...]${RESET}\n`);
  });

  agent.on('tool:done', (name, result) => {
    // Don't show full result, just confirmation
    process.stdout.write(`${DIM}[${name} complete]${RESET}\n`);
  });

  agent.on('error', (err) => {
    console.error(`\n${YELLOW}Error: ${err.message}${RESET}`);
  });

  try {
    const result = await agent.run(userMessage, { sessionId });
    console.log('\n');
    return result.sessionId;
  } catch (err) {
    console.error(`\n${YELLOW}Error: ${err instanceof Error ? err.message : err}${RESET}`);
    process.exit(1);
  }
}

async function runInteractive(initialSessionId?: string) {
  printBanner();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const sessionManager = new SessionManager();
  let sessionId = initialSessionId || sessionManager.createSession();

  console.log(`${DIM}Session: ${sessionId.slice(0, 8)}...${RESET}`);
  console.log(`${DIM}Type 'exit' to quit, 'new' for a new session${RESET}\n`);

  const prompt = () => {
    rl.question(`${GREEN}You:${RESET} `, async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
        console.log(`${DIM}Goodbye!${RESET}`);
        rl.close();
        process.exit(0);
      }

      if (trimmed.toLowerCase() === 'new') {
        sessionId = sessionManager.createSession();
        console.log(`${DIM}Started new session: ${sessionId.slice(0, 8)}...${RESET}\n`);
        prompt();
        return;
      }

      console.log(`\n${CYAN}Majordomo:${RESET} `);

      try {
        const agent = new AgentRunner();

        agent.on('text', (chunk) => {
          process.stdout.write(chunk);
        });

        agent.on('tool:start', (name) => {
          process.stdout.write(`\n${DIM}[${name}...]${RESET}`);
        });

        agent.on('tool:done', () => {
          process.stdout.write(`${DIM} done${RESET}\n`);
        });

        await agent.run(trimmed, { sessionId });
        console.log('\n');
      } catch (err) {
        console.error(`\n${YELLOW}Error: ${err instanceof Error ? err.message : err}${RESET}\n`);
      }

      prompt();
    });
  };

  prompt();
}

async function main() {
  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(`${YELLOW}Error: ANTHROPIC_API_KEY environment variable is required.${RESET}`);
    console.error(`\nGet your API key from: https://console.anthropic.com/\n`);
    process.exit(1);
  }

  if (showHelp) {
    printHelp();
    process.exit(0);
  }

  if (runSetup) {
    // Dynamic import to avoid loading setup dependencies in normal runs
    const { runSetup: doSetup } = await import('./setup/index.js');
    await doSetup();
    process.exit(0);
  }

  if (runServe) {
    // Start HTTP gateway server
    const { startGateway } = await import('./gateway/index.js');
    await startGateway(port);
    return; // Keep running
  }

  const sessionManager = new SessionManager();
  let sessionId: string | undefined;

  if (continueSession) {
    sessionId = sessionManager.getMostRecentSession() || undefined;
    if (!sessionId) {
      console.log(`${DIM}No previous session found. Starting new session.${RESET}`);
    }
  }

  if (message) {
    // Single query mode
    await runSingleQuery(message, sessionId);
  } else {
    // Interactive mode
    await runInteractive(sessionId);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
