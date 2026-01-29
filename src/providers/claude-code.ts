/**
 * Claude Code CLI Provider
 *
 * Uses the Claude Code CLI to run completions.
 * Works with existing Claude Code authentication (API key or Claude Max subscription).
 *
 * Benefits:
 * - No separate API key needed if you have Claude Max
 * - Uses your existing Claude Code setup
 * - Respects Claude Code's rate limits and billing
 */

import { spawn } from 'node:child_process';
import type { AIProvider, CompletionRequest, CompletionResponse, StreamEvent, ContentBlock, ToolDefinition } from './base.js';

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
    // Build the message to send to Claude Code
    const lastUserMessage = request.messages
      .filter(m => m.role === 'user')
      .map(m => typeof m.content === 'string' ? m.content :
           m.content.filter(b => b.type === 'text').map(b => b.text).join(''))
      .pop() || '';

    // Build tool instructions if tools are provided
    let prompt = lastUserMessage;
    if (request.tools && request.tools.length > 0) {
      prompt = this.buildToolPrompt(request.tools, lastUserMessage);
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

  private buildToolPrompt(tools: ToolDefinition[], userMessage: string): string {
    const toolDescriptions = tools.map(t =>
      `- ${t.name}: ${t.description}`
    ).join('\n');

    return `You have access to the following tools. To use a tool, respond ONLY with JSON in this exact format:
{"tool": "tool_name", "params": {...}}

Available tools:
${toolDescriptions}

User request: ${userMessage}

If you need to use a tool, respond with the JSON. If you can answer directly, just respond normally.`;
  }
}
