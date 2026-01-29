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
import { getMemoryStore } from '../memory/store.js';
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

You are Majordomo, a highly capable personal AI assistant. You have access to the user's digital life - their email, calendar, Slack, Discord, Linear, Jira, Notion, iMessage, and more.

Your job is to help them manage their life efficiently. You can:
- Check and summarize their communications (email, Slack, Discord, iMessage)
- Manage their calendar
- Track and update their tasks (Linear, Jira)
- Search and manage their notes (Notion)
- Send messages on their behalf (with their permission)

Be concise, helpful, and proactive. If you notice something important (like a missed message or upcoming deadline), mention it.

## Daily Briefing

When the user asks "what's up today?", "what's happening?", "briefing", or similar, you should proactively check:
1. Today's calendar events
2. Unread/recent emails (last 24h)
3. Recent Slack messages and DMs
4. Your assigned Linear/Jira issues
5. Recent iMessage conversations (if on macOS)

Summarize everything concisely, highlighting:
- Urgent items that need attention
- Upcoming meetings (next 24h)
- Messages that need responses
- Tasks that are due or overdue
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

7. **Use memory proactively**:
   - **Remember** (use \`memory_remember\`): When the user tells you their preferences, important contacts, work context, or anything they'd want you to remember long-term
   - **Search** (use \`memory_search\`): Before answering questions about the user's preferences, past decisions, or people they've mentioned
   - **Types**: Use "fact" for preferences/info, "note" for misc, "task" for recurring reminders
   - Examples of things to remember:
     - "I prefer morning meetings" → remember as fact with tags: ["preference", "calendar"]
     - "Bob is my manager" → remember as fact with tags: ["people", "work"]
     - "Use TypeScript for new projects" → remember as fact with tags: ["preference", "coding"]
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
  const sections: string[] = [];

  // Load facts from MemoryStore
  try {
    const store = getMemoryStore();
    const facts = store.listByType('fact');

    if (facts.length > 0) {
      const factsList = facts
        .slice(0, 20) // Limit to avoid huge prompts
        .map(f => {
          const tags = f.tags.length > 0 ? ` [${f.tags.join(', ')}]` : '';
          return `- ${f.content}${tags}`;
        })
        .join('\n');

      sections.push(`## Remembered Facts\n\n${factsList}`);
    }
  } catch {
    // MemoryStore not available
  }

  // Load user markdown file
  const memoriesFile = join(MEMORIES_DIR, 'user.md');
  if (existsSync(memoriesFile)) {
    const userNotes = readFileSync(memoriesFile, 'utf-8').trim();
    if (userNotes && !userNotes.includes('(Majordomo will learn')) {
      // Only include if user has actually added content
      sections.push(`## User Notes\n\n${userNotes}`);
    }
  } else {
    // Create starter file
    const starterMemories = `# About the User

(Edit this file to add permanent notes for Majordomo)

## Preferences

## Important People

## Notes
`.trim();

    try {
      const { mkdirSync, writeFileSync } = require('node:fs');
      mkdirSync(MEMORIES_DIR, { recursive: true });
      writeFileSync(memoriesFile, starterMemories);
    } catch {
      // Ignore
    }
  }

  return sections.length > 0 ? sections.join('\n\n') : null;
}
