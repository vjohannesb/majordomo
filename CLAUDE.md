# Majordomo Development Notes

## Architecture

```
User → Majordomo CLI → Claude Code (brain) → Majordomo (tools) → Slack/Email/etc
```

- **Majordomo CLI** (`src/cli.ts`) - Interactive prompt where user types commands
- **Brain** (`src/core/brain.ts`) - Spawns Claude Code to decide what to do
- **Tools** (`src/core/tools.ts`) - Executes actions (Slack, etc.)

Claude Code is the brain. Majordomo is the hands.

## Claude Code CLI Reference

### CLI Commands

| Command                         | Description                                            | Example                                           |
| :------------------------------ | :----------------------------------------------------- | :------------------------------------------------ |
| `claude`                        | Start interactive REPL                                 | `claude`                                          |
| `claude "query"`                | Start REPL with initial prompt                         | `claude "explain this project"`                   |
| `claude -p "query"`             | Query via SDK, then exit                               | `claude -p "explain this function"`               |
| `cat file \| claude -p "query"` | Process piped content                                  | `cat logs.txt \| claude -p "explain"`             |
| `claude -c`                     | Continue most recent conversation in current directory | `claude -c`                                       |
| `claude -c -p "query"`          | Continue via SDK                                       | `claude -c -p "Check for type errors"`            |
| `claude -r "<session>" "query"` | Resume session by ID or name                           | `claude -r "auth-refactor" "Finish this PR"`      |
| `claude update`                 | Update to latest version                               | `claude update`                                   |
| `claude mcp`                    | Configure Model Context Protocol (MCP) servers         | See MCP documentation                             |

### Key CLI Flags

| Flag                       | Description                                                              | Example                                                |
| :------------------------- | :----------------------------------------------------------------------- | :----------------------------------------------------- |
| `--model`                  | Sets the model (`sonnet`, `opus`, `haiku`, or full name)                 | `claude --model haiku`                                 |
| `--output-format`          | Output format: `text`, `json`, `stream-json`                             | `claude -p "query" --output-format json`               |
| `--system-prompt`          | Replace entire system prompt                                             | `claude --system-prompt "You are a Python expert"`     |
| `--append-system-prompt`   | Append to default system prompt                                          | `claude --append-system-prompt "Always use TypeScript"`|
| `--json-schema`            | Get validated JSON output matching schema (print mode only)              | `claude -p --json-schema '{"type":"object"...}' "q"`   |
| `--tools`                  | Restrict which tools Claude can use (`""` to disable all)                | `claude --tools "Bash,Edit,Read"`                      |
| `--max-turns`              | Limit agentic turns (print mode only)                                    | `claude -p --max-turns 3 "query"`                      |
| `--max-budget-usd`         | Maximum spend before stopping (print mode only)                          | `claude -p --max-budget-usd 5.00 "query"`              |
| `--verbose`                | Enable verbose logging                                                   | `claude --verbose`                                     |
| `--debug`                  | Enable debug mode                                                        | `claude --debug "api,mcp"`                             |
| `-p`, `--print`            | Print response without interactive mode                                  | `claude -p "query"`                                    |
| `-c`, `--continue`         | Continue most recent conversation                                        | `claude -c`                                            |
| `-r`, `--resume`           | Resume specific session                                                  | `claude -r session-id`                                 |

### System Prompt Flags

| Flag                          | Behavior                       | Modes               |
| :---------------------------- | :----------------------------- | :------------------ |
| `--system-prompt`             | Replaces entire default prompt | Interactive + Print |
| `--system-prompt-file`        | Replaces with file contents    | Print only          |
| `--append-system-prompt`      | Appends to default prompt      | Interactive + Print |
| `--append-system-prompt-file` | Appends file contents          | Print only          |

### JSON Output Format

When using `--output-format json`, Claude returns:
```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "duration_ms": 3374,
  "result": "",
  "session_id": "...",
  "total_cost_usd": 0.002,
  "structured_output": { ... },  // When using --json-schema
  "usage": { ... }
}
```

### Custom Subagents

Use `--agents` flag with JSON:
```bash
claude --agents '{
  "code-reviewer": {
    "description": "Expert code reviewer",
    "prompt": "You are a senior code reviewer...",
    "tools": ["Read", "Grep", "Glob"],
    "model": "sonnet"
  }
}'
```

## Full Documentation

Fetch complete docs at: https://code.claude.com/docs/llms.txt
