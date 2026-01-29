/**
 * Claude Code CLI Provider
 *
 * Uses the Claude Code CLI to run completions.
 * Works with existing Claude Code authentication (API key or Claude Max subscription).
 *
 * Benefits:
 * - No separate API key needed if you have Claude Max
 * - Uses your existing Claude Code setup
 * - Claude has access to all its built-in tools (file system, web, etc.)
 * - Plus access to Majordomo's external tools (Slack, Email, Calendar, etc.)
 */

import { spawn } from 'node:child_process';
import type { AIProvider, CompletionRequest, CompletionResponse, StreamEvent, ContentBlock, ToolDefinition, Message } from './base.js';

export class ClaudeCodeProvider implements AIProvider {
  readonly name = 'Claude Code';
  readonly model = 'claude-code';

  async isConfigured(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('claude', ['--version'], { stdio: 'pipe' });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    // Build the full conversation as a prompt
    const conversationText = this.buildConversationPrompt(request.messages);

    // Build the full prompt with tool instructions
    let prompt = conversationText;
    if (request.tools && request.tools.length > 0) {
      prompt = this.buildToolPrompt(request.tools, conversationText);
    }

    const args = ['-p', '--output-format', 'json'];

    if (request.systemPrompt) {
      args.push('--append-system-prompt', request.systemPrompt);
    }

    args.push(prompt);

    return new Promise((resolve, reject) => {
      const proc = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Claude Code exited with code ${code}: ${stderr}`));
          return;
        }

        try {
          const response = JSON.parse(stdout) as { result?: string };
          const text = response.result || stdout;

          // Try to parse tool calls from response
          const content: ContentBlock[] = [];
          try {
            const toolMatch = text.match(/\{[\s\S]*"tool"[\s\S]*\}/);
            if (toolMatch && request.tools) {
              const toolCall = JSON.parse(toolMatch[0]) as { tool: string; params: unknown };
              content.push({
                type: 'tool_use',
                id: `tool_${Date.now()}`,
                name: toolCall.tool,
                input: toolCall.params,
              });
              resolve({ content, stopReason: 'tool_use' });
              return;
            }
          } catch {
            // Not a tool call
          }

          content.push({ type: 'text', text });
          resolve({ content, stopReason: 'end_turn' });
        } catch {
          resolve({
            content: [{ type: 'text', text: stdout.trim() }],
            stopReason: 'end_turn',
          });
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn Claude Code: ${err.message}`));
      });
    });
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamEvent> {
    // Claude Code CLI doesn't support streaming in a way we can easily consume
    // So we'll run the full completion and emit it all at once
    try {
      const response = await this.complete(request);

      for (const block of response.content) {
        if (block.type === 'text' && block.text) {
          yield { type: 'text', text: block.text };
        } else if (block.type === 'tool_use' && block.id && block.name) {
          yield {
            type: 'tool_use',
            toolCall: {
              id: block.id,
              name: block.name,
              input: block.input,
            },
          };
        }
      }

      yield { type: 'done' };
    } catch (err) {
      yield { type: 'error', error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }

  private buildConversationPrompt(messages: Message[]): string {
    // Convert messages to a readable conversation format
    const parts: string[] = [];

    for (const msg of messages) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      let content: string;

      if (typeof msg.content === 'string') {
        content = msg.content;
      } else {
        // Handle content blocks (text, tool_result, etc.)
        content = msg.content
          .map(block => {
            if (block.type === 'text' && block.text) {
              return block.text;
            } else if (block.type === 'tool_result' && block.content) {
              return `[Tool Result: ${block.content}]`;
            }
            return '';
          })
          .filter(Boolean)
          .join('\n');
      }

      if (content) {
        parts.push(`${role}: ${content}`);
      }
    }

    return parts.join('\n\n');
  }

  private buildToolPrompt(tools: ToolDefinition[], conversation: string): string {
    const toolDescriptions = tools.map(t =>
      `- ${t.name}: ${t.description}`
    ).join('\n');

    return `## Conversation History
${conversation}

---

## External Tools (Majordomo)

You have access to external tools through Majordomo. These are SEPARATE from your built-in Claude Code tools.

To use an external Majordomo tool, respond with ONLY this JSON format (nothing else):
{"tool": "tool_name", "params": {...}}

Available external tools:
${toolDescriptions}

## Instructions

1. You can use your built-in Claude Code tools freely (file system, web search, etc.)
2. For Slack, Email, Calendar, Linear, Notion, Discord, Jira, iMessage - use the external tools above
3. To call an external tool, just output the JSON. No approval needed. The tool will execute and you'll get the result.
4. Read operations are safe - just call them directly
5. For write operations (sending messages, creating issues), confirm with the user first

Now respond to the user's latest message:`;
  }
}
