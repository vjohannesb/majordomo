# Majordomo Development Notes

## Workflow Rules

**Before ending any session:**
1. Run any available tests/linters
2. Commit all changes with a descriptive message
3. Push to origin

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│  Next.js        │     │  MCP Clients    │
│  Dashboard      │     │  (Claude, etc)  │
└────────┬────────┘     └────────┬────────┘
         │                       │
         │  REST API             │  MCP Protocol
         │                       │
         └───────────┬───────────┘
                     │
              ┌──────▼──────┐
              │ MCP Server  │
              │  (Hono)     │
              └──────┬──────┘
                     │
              ┌──────▼──────┐
              │ PostgreSQL  │
              └─────────────┘
```

- **MCP Server** (`/server`) - Hono/Bun API server exposing MCP tools
- **Dashboard** (`/dashboard`) - Next.js app for user configuration

## Project Structure

```
majordomo/
├── server/                    # MCP Server (Hono/Bun)
│   ├── src/
│   │   ├── index.ts          # Entry point
│   │   ├── db.ts             # Database operations
│   │   ├── auth.ts           # OAuth handling
│   │   ├── routes/
│   │   │   ├── auth.ts       # OAuth routes
│   │   │   ├── mcp.ts        # MCP endpoints
│   │   │   ├── webhooks.ts   # Webhook handlers
│   │   │   └── api.ts        # Dashboard API routes
│   │   └── services/
│   │       ├── google.ts     # Gmail + Calendar
│   │       ├── slack.ts
│   │       ├── linear.ts
│   │       ├── notion.ts
│   │       └── notifications.ts
│   └── package.json
│
├── dashboard/                 # Next.js Dashboard
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx
│   │   │   └── dashboard/page.tsx
│   │   ├── components/
│   │   │   ├── ui/           # shadcn-style components
│   │   │   ├── service-card.tsx
│   │   │   ├── mcp-config.tsx
│   │   │   └── notification-settings.tsx
│   │   └── lib/
│   │       ├── api.ts        # Server API client
│   │       └── utils.ts
│   └── package.json
│
└── package.json              # Root workspace
```

## Development

```bash
# Install all dependencies
cd server && bun install
cd ../dashboard && npm install

# Run both in development
npm run dev

# Or run individually
npm run dev:server    # http://localhost:3000
npm run dev:dashboard # http://localhost:3001
```

## Environment Variables

### Server (`server/.env`)
```
DATABASE_URL=postgres://...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
SLACK_CLIENT_ID=...          # Optional
SLACK_CLIENT_SECRET=...      # Optional
LINEAR_CLIENT_ID=...         # Optional
LINEAR_CLIENT_SECRET=...     # Optional
NOTION_CLIENT_ID=...         # Optional
NOTION_CLIENT_SECRET=...     # Optional
BASE_URL=http://localhost:3000
DASHBOARD_URL=http://localhost:3001
```

### Dashboard (`dashboard/.env.local`)
```
NEXT_PUBLIC_SERVER_URL=http://localhost:3000
```

## API Endpoints

### Dashboard API (REST)
- `GET /api/me` - Current user info
- `GET /api/services` - List services + connection status
- `GET /api/services/:id` - Service details
- `DELETE /api/services/:id/:account` - Disconnect account
- `GET /api/settings` - User settings
- `PUT /api/settings` - Update settings
- `GET /api/mcp-config` - Get MCP config (API key, URLs)

### MCP Endpoints
- `GET /mcp/sse` - SSE endpoint for MCP clients
- `GET /mcp/tools` - List available tools
- `POST /mcp/tools/:toolName` - Execute a tool

### OAuth
- `GET /auth/google` - Start Google OAuth
- `GET /auth/slack` - Start Slack OAuth
- `GET /auth/linear` - Start Linear OAuth
- `GET /auth/notion` - Start Notion OAuth

## Deployment

Both services can be deployed to Railway:

1. Create two services in Railway
2. Connect each to `/server` and `/dashboard` directories
3. Set environment variables
4. Server: `BASE_URL=https://your-server.railway.app`
5. Server: `DASHBOARD_URL=https://your-dashboard.railway.app`
6. Dashboard: `NEXT_PUBLIC_SERVER_URL=https://your-server.railway.app`

## Claude Code CLI Reference

### Key CLI Commands

| Command | Description |
|:--------|:------------|
| `claude` | Start interactive REPL |
| `claude -p "query"` | Query via SDK, then exit |
| `claude -c` | Continue most recent conversation |
| `claude mcp` | Configure MCP servers |

### Adding Majordomo MCP to Claude Code

```bash
claude mcp add majordomo https://your-server.railway.app/mcp/sse --header "Authorization: Bearer YOUR_API_KEY"
```

Or add to `~/.claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "majordomo": {
      "url": "https://your-server.railway.app/mcp/sse",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```
