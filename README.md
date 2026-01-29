# Majordomo

Your AI-powered life manager. Access to Slack, Email, Calendar, Discord, Linear, Jira, Notion, iMessage, and more.

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Set your Anthropic API key
export ANTHROPIC_API_KEY=sk-ant-...

# Run setup to connect your accounts
npm run setup

# Start Majordomo
npm start
```

## Usage

### Interactive Mode (default)

```bash
npm start
# or
majordomo
```

Start an interactive session. Type naturally:
- "what's up today?" - Get a briefing of your calendar, emails, messages, and tasks
- "check my slack messages" - See recent Slack activity
- "send an email to bob@example.com about the meeting" - Draft and send emails
- "what's on my calendar this week?" - Check your schedule
- "create a linear issue for the login bug" - Create tasks
- "search notion for meeting notes" - Find notes

### Single Query Mode

```bash
majordomo "what's up today?"
```

Run a single query and exit.

### Continue Session

```bash
majordomo -c
# or
majordomo -c "what else did they say?"
```

Continue the last conversation.

### HTTP Gateway

```bash
majordomo --serve
# or
majordomo --serve --port=8080
```

Start an HTTP server for web/API access:
- `POST /api/chat` - Send a message
- `POST /api/chat/stream` - Send with streaming (SSE)
- `GET /api/sessions` - List sessions
- `GET /api/sessions/:id` - Get session details
- `GET /health` - Health check

### Setup

```bash
npm run setup
# or
majordomo --setup
```

Interactive setup wizard for connecting accounts.

## Integrations

| Service | Tools | Auth |
|---------|-------|------|
| **Slack** | Send/read DMs, channels, list users | OAuth |
| **Gmail** | Send, read, search emails | OAuth |
| **Calendar** | List, create, delete events | OAuth |
| **Discord** | Send/read messages, list servers | Bot token |
| **Linear** | List, create, update issues | API key |
| **Jira** | Search, create, update, comment | API token |
| **Notion** | Search, read, create pages | Integration token |
| **iMessage** | Send, read messages (macOS only) | Local access |

### Tool List

<details>
<summary>Slack (6 tools)</summary>

- `slack_send_dm` - Send a direct message
- `slack_send_channel` - Send to a channel
- `slack_list_users` - List workspace users
- `slack_read_dms` - Read DMs from someone
- `slack_read_channel` - Read channel messages
- `slack_list_channels` - List your channels

</details>

<details>
<summary>Email (4 tools)</summary>

- `email_send` - Send an email
- `email_list` - List recent emails
- `email_read` - Read a specific email
- `email_search` - Search emails

</details>

<details>
<summary>Calendar (3 tools)</summary>

- `calendar_list` - List upcoming events
- `calendar_create` - Create an event
- `calendar_delete` - Delete an event

</details>

<details>
<summary>Discord (3 tools)</summary>

- `discord_send_message` - Send a message
- `discord_list_servers` - List servers
- `discord_read_channel` - Read channel messages

</details>

<details>
<summary>Linear (3 tools)</summary>

- `linear_list_issues` - Search issues
- `linear_create_issue` - Create an issue
- `linear_update_issue` - Update an issue

</details>

<details>
<summary>Jira (6 tools)</summary>

- `jira_search` - Search with JQL
- `jira_get_issue` - Get issue details
- `jira_create_issue` - Create an issue
- `jira_update_issue` - Update an issue
- `jira_add_comment` - Add a comment
- `jira_my_issues` - Your assigned issues

</details>

<details>
<summary>Notion (3 tools)</summary>

- `notion_search` - Search pages
- `notion_read_page` - Read page content
- `notion_create_page` - Create a page

</details>

<details>
<summary>iMessage (3 tools) - macOS only</summary>

- `imessage_send` - Send an iMessage
- `imessage_read` - Read recent messages
- `imessage_conversations` - List conversations

</details>

<details>
<summary>Memory (4 tools)</summary>

- `memory_remember` - Store a fact/note/task
- `memory_search` - Search memories
- `memory_list` - List memories by type
- `memory_forget` - Delete a memory

</details>

## Configuration

Config is stored in `~/.majordomo/config.json`.

### Environment Variables

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...

# Optional (for setup without prompts)
SLACK_CLIENT_ID=...
SLACK_CLIENT_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

### Multi-Account Support

All integrations support multiple accounts:

```json
{
  "accounts": {
    "slack": [
      { "name": "work", "isDefault": true, "userToken": "..." },
      { "name": "personal", "userToken": "..." }
    ],
    "google": [
      { "name": "work", "isDefault": true, "email": "me@company.com", "refreshToken": "..." },
      { "name": "personal", "email": "me@gmail.com", "refreshToken": "..." }
    ]
  }
}
```

Use the account name in queries:
- "check my work slack"
- "send from personal email"

## Memory System

Majordomo can remember things about you:

```
You: Remember that I prefer morning meetings
Majordomo: Got it! I'll remember that you prefer morning meetings.

You: What do you know about my preferences?
Majordomo: [searches memory] You prefer morning meetings.
```

Memories are stored in `~/.majordomo/memory/`.

## Sessions

Conversation history is saved to `~/.majordomo/sessions/` as JSONL files.

- Sessions persist across restarts
- Use `-c` to continue the last session
- Type `new` in interactive mode to start fresh

## Architecture

```
CLI/Web/API
    │
    ▼
Gateway Server (HTTP/SSE)
    │
    ▼
Agent Runner (Anthropic SDK)
    │
    ├── Tools (integrations)
    ├── Memory (persistent knowledge)
    └── Sessions (conversation history)
```

## Development

```bash
# Dev mode with auto-rebuild
npm run dev

# Build
npm run build

# Type check
npm run typecheck
```

## License

MIT
