#!/usr/bin/env node
/**
 * Majordomo CLI
 *
 * Your personal AI assistant. Type commands, Claude decides what to do,
 * Majordomo executes the actions.
 *
 * Architecture:
 *   You → Majordomo → Claude Code (brain) → Majordomo (hands) → Slack/Email/etc
 *
 * Usage:
 *   npm start           - Normal mode
 *   npm start -- --debug - Debug mode (logs everything)
 */

import * as readline from 'node:readline';
import { think, formatResponse, setDebug, DEBUG } from './core/brain.js';
import { executeTool, AVAILABLE_TOOLS } from './core/tools.js';

// Parse args
const args = process.argv.slice(2);
if (args.includes('--debug') || args.includes('-d')) {
  setDebug(true);
  console.log('\x1b[90m[debug mode enabled]\x1b[0m\n');
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                      MAJORDOMO                               ║
║              Your AI-powered life manager                    ║
╠══════════════════════════════════════════════════════════════╣
║  Slack:    "tell david i'll be there in 5"                   ║
║            "read my dms from sarah"                          ║
║  Email:    "show my recent emails"                           ║
║            "send an email to bob about the meeting"          ║
║  Calendar: "what's on my calendar today"                     ║
║            "schedule lunch with alice tomorrow at noon"      ║
║                                                              ║
║  Type 'exit' to quit.                                        ║
╚══════════════════════════════════════════════════════════════╝
`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    rl.question('\x1b[36myou:\x1b[0m ', async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
        console.log('\nGoodbye!\n');
        rl.close();
        process.exit(0);
      }

      try {
        // Ask Claude what to do
        if (!DEBUG) {
          process.stdout.write('\x1b[90mthinking...\x1b[0m');
        }

        const response = await think(trimmed, AVAILABLE_TOOLS);

        // Clear the "thinking..." line (only if not in debug mode)
        if (!DEBUG) {
          process.stdout.write('\r\x1b[K');
        }

        // If there are tool calls that need confirmation
        if (response.toolCalls.length > 0 && response.requiresConfirmation) {
          console.log(`\x1b[33mmajordomo:\x1b[0m ${response.message}`);
          console.log('\nActions to take:');
          for (const call of response.toolCalls) {
            console.log(`  • ${call.tool}: ${JSON.stringify(call.params)}`);
          }

          const confirm = await new Promise<string>((resolve) => {
            rl.question('\nExecute? (y/n): ', resolve);
          });

          if (confirm.toLowerCase() !== 'y') {
            console.log('Cancelled.\n');
            prompt();
            return;
          }
        }

        // Execute tool calls
        const toolResults: Array<{ tool: string; result: string }> = [];
        for (const call of response.toolCalls) {
          if (!DEBUG) {
            process.stdout.write(`\x1b[90mexecuting ${call.tool}...\x1b[0m`);
          }
          const result = await executeTool(call);
          if (!DEBUG) {
            process.stdout.write('\r\x1b[K');
          }
          toolResults.push({ tool: call.tool, result });
        }

        // If we have tool results, format them nicely with a second Claude pass
        if (toolResults.length > 0) {
          if (!DEBUG) {
            process.stdout.write('\x1b[90mformatting...\x1b[0m');
          }
          const formattedResponse = await formatResponse(trimmed, toolResults);
          if (!DEBUG) {
            process.stdout.write('\r\x1b[K');
          }
          console.log(`\x1b[33mmajordomo:\x1b[0m ${formattedResponse}`);
        } else if (response.message) {
          // No tools called, just show the message
          console.log(`\x1b[33mmajordomo:\x1b[0m ${response.message}`);
        }

        console.log();
      } catch (err) {
        process.stdout.write('\r\x1b[K');
        console.error('\x1b[31mError:\x1b[0m', err instanceof Error ? err.message : err);
        console.log();
      }

      prompt();
    });
  };

  prompt();

  rl.on('close', () => {
    console.log('\nGoodbye!\n');
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
