/**
 * System Prompt Builder
 *
 * Constructs the system prompt for the agent based on:
 * - Core identity
 * - Available tools and their descriptions
 * - User context and preferences
 * - Current date/time
 */

import { loadConfig, type MajordomoConfig } from '../config.js';
import { AVAILABLE_TOOLS } from '../core/tools.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const MEMORIES_DIR = join(homedir(), '.majordomo', 'memories');

export async function buildSystemPrompt(): Promise<string> {
  const config = await loadConfig();
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const sections: string[] = [];

  // Core identity
  sections.push(`
# Identity

You are Majordomo, a highly capable personal AI assistant. You have access to the user's digital life - their email, calendar, Slack, Discord, Linear, Notion, and more.

Your job is to help them manage their life efficiently. You can:
- Check and summarize their communications (email, Slack, Discord)
- Manage their calendar
- Track and update their tasks (Linear)
- Search and manage their notes (Notion)
- Send messages on their behalf (with their permission)

Be concise, helpful, and proactive. If you notice something important (like a missed message or upcoming deadline), mention it.
`.trim());

  // Date and time context
  sections.push(`
# Current Context

- Date: ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
- Time: ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
- Timezone: ${timezone}
`.trim());

  // Account summary
  const accountSummary = buildAccountSummary(config);
  if (accountSummary) {
    sections.push(`
# Connected Accounts

${accountSummary}
`.trim());
  }

  // Available tools summary (the actual tools are passed separately)
  const toolsSummary = buildToolsSummary();
  sections.push(`
# Available Tools

${toolsSummary}
`.trim());

  // Load user memories/preferences if they exist
  const memories = loadMemories();
  if (memories) {
    sections.push(`
# User Context & Memories

${memories}
`.trim());
  }

  // Behavioral guidelines
  sections.push(`
# Guidelines

1. **Be proactive**: If the user asks "what's up today?", check their calendar, recent emails, Slack messages, and any urgent Linear issues.

2. **Ask before sending**: Before sending any message (email, Slack, Discord) on the user's behalf, always confirm with them first. Show them the exact message you'll send.

3. **Be concise**: Summarize information rather than dumping raw data. Highlight what's important.

4. **Handle errors gracefully**: If a tool fails, explain what happened and suggest alternatives.

5. **Remember context**: Use information from earlier in the conversation. Don't ask for things the user already told you.

6. **Respect privacy**: Don't share sensitive information from one service with another unless the user explicitly asks.

7. **Use memory tools**: When you learn important things about the user (preferences, important people, recurring tasks), use \`memory_remember\` to store them. Before answering questions about the user's past or preferences, use \`memory_search\` to check what you know.
`.trim());

  return sections.join('\n\n---\n\n');
}

function buildAccountSummary(config: MajordomoConfig): string {
  const lines: string[] = [];
  const accounts = config.accounts || {};

  if (accounts.slack?.length) {
    const slackNames = accounts.slack.map((a) => a.name + (a.isDefault ? ' (default)' : ''));
    lines.push(`- **Slack**: ${slackNames.join(', ')}`);
  }

  if (accounts.google?.length) {
    const googleNames = accounts.google.map((a) => {
      const label = a.email || a.name;
      return label + (a.isDefault ? ' (default)' : '');
    });
    lines.push(`- **Google (Gmail/Calendar)**: ${googleNames.join(', ')}`);
  }

  if (accounts.discord?.length) {
    const discordNames = accounts.discord.map((a) => a.name + (a.isDefault ? ' (default)' : ''));
    lines.push(`- **Discord**: ${discordNames.join(', ')}`);
  }

  if (accounts.linear?.length) {
    const linearNames = accounts.linear.map((a) => a.name + (a.isDefault ? ' (default)' : ''));
    lines.push(`- **Linear**: ${linearNames.join(', ')}`);
  }

  if (accounts.notion?.length) {
    const notionNames = accounts.notion.map((a) => a.name + (a.isDefault ? ' (default)' : ''));
    lines.push(`- **Notion**: ${notionNames.join(', ')}`);
  }

  if (lines.length === 0) {
    return 'No accounts configured. Run `majordomo setup` to connect services.';
  }

  return lines.join('\n');
}

function buildToolsSummary(): string {
  const toolsByCategory: Record<string, string[]> = {};

  for (const tool of AVAILABLE_TOOLS) {
    const category = tool.name.split('_')[0] || 'other'; // e.g., "slack" from "slack_send_dm"
    if (!toolsByCategory[category]) {
      toolsByCategory[category] = [];
    }
    toolsByCategory[category]!.push(`- \`${tool.name}\`: ${tool.description}`);
  }

  const sections: string[] = [];
  for (const [category, tools] of Object.entries(toolsByCategory)) {
    sections.push(`**${category.charAt(0).toUpperCase() + category.slice(1)}**\n${tools.join('\n')}`);
  }

  return sections.join('\n\n');
}

function loadMemories(): string | null {
  const memoriesFile = join(MEMORIES_DIR, 'user.md');
  if (existsSync(memoriesFile)) {
    return readFileSync(memoriesFile, 'utf-8').trim();
  }

  // Create a starter memories file
  const starterMemories = `
# About the User

(Majordomo will learn about you as you interact. You can also edit this file directly.)

## Preferences

- Preferred communication style: (e.g., concise, detailed)
- Work hours: (e.g., 9am-6pm)
- Timezone: (auto-detected, but can override)

## Important People

(Majordomo will remember people you frequently interact with)

## Recurring Tasks

(Regular tasks or check-ins)

## Notes

(Anything else Majordomo should know)
`.trim();

  try {
    const { mkdirSync, writeFileSync } = require('node:fs');
    mkdirSync(MEMORIES_DIR, { recursive: true });
    writeFileSync(memoriesFile, starterMemories);
    return starterMemories;
  } catch {
    return null;
  }
}
