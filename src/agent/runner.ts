/**
 * Agent Runner - Direct Anthropic API Integration
 *
 * Runs Claude directly via the Anthropic SDK.
 * Handles streaming, tool execution, and session management.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, Tool, ContentBlock, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages';
import { EventEmitter } from 'node:events';
import { loadConfig } from '../config.js';
import { AVAILABLE_TOOLS, executeTool, type ToolCall } from '../core/tools.js';
import { createToolContext, type ToolContext } from '../core/accounts.js';
import { SessionManager, type Session } from './session.js';
import { buildSystemPrompt } from './system-prompt.js';

// Agent events
export interface AgentEvents {
  'thinking': (text: string) => void;
  'text': (text: string) => void;
  'text:done': (fullText: string) => void;
  'tool:start': (name: string, input: Record<string, unknown>) => void;
  'tool:done': (name: string, result: string) => void;
  'error': (error: Error) => void;
  'done': (response: AgentResponse) => void;
}

export interface AgentResponse {
  text: string;
  toolsUsed: string[];
  sessionId: string;
}

export interface RunOptions {
  sessionId?: string;
  stream?: boolean;
  maxTurns?: number;
}

// Convert our tool format to Anthropic format
function convertToolsToAnthropic(): Tool[] {
  return AVAILABLE_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: 'object' as const,
      properties: Object.fromEntries(
        Object.entries(tool.parameters).map(([name, param]) => [
          name,
          {
            type: param.type,
            description: param.description,
          },
        ])
      ),
      required: Object.entries(tool.parameters)
        .filter(([_, param]) => param.required)
        .map(([name]) => name),
    },
  }));
}

export class AgentRunner extends EventEmitter {
  private client: Anthropic;
  private sessionManager: SessionManager;
  private toolContext: ToolContext | null = null;
  private model: string;

  constructor(options: { model?: string } = {}) {
    super();

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }

    this.client = new Anthropic({ apiKey });
    this.sessionManager = new SessionManager();
    this.model = options.model || 'claude-sonnet-4-20250514';
  }

  private async getToolContext(): Promise<ToolContext> {
    if (!this.toolContext) {
      this.toolContext = await createToolContext();
    }
    return this.toolContext;
  }

  async run(userMessage: string, options: RunOptions = {}): Promise<AgentResponse> {
    const {
      sessionId = this.sessionManager.createSession(),
      stream = true,
      maxTurns = 10,
    } = options;

    // Load or create session
    const session = this.sessionManager.getSession(sessionId);

    // Add user message to history
    session.messages.push({
      role: 'user',
      content: userMessage,
    });

    const systemPrompt = await buildSystemPrompt();
    const tools = convertToolsToAnthropic();
    const toolContext = await this.getToolContext();

    let fullResponse = '';
    const toolsUsed: string[] = [];
    let turns = 0;

    while (turns < maxTurns) {
      turns++;

      if (stream) {
        const result = await this.runStreamingTurn(
          systemPrompt,
          session.messages,
          tools,
          toolContext
        );

        fullResponse = result.text;
        toolsUsed.push(...result.toolsUsed);

        // If no tool calls, we're done
        if (result.toolCalls.length === 0) {
          break;
        }

        // Add assistant message with tool calls
        session.messages.push({
          role: 'assistant',
          content: result.contentBlocks,
        });

        // Execute tools and add results
        const toolResults: ToolResultBlockParam[] = [];
        for (const toolCall of result.toolCalls) {
          const toolInput = toolCall.input as Record<string, unknown>;
          this.emit('tool:start', toolCall.name, toolInput);

          try {
            const toolResult = await executeTool(
              { tool: toolCall.name, params: toolInput },
              toolContext
            );
            this.emit('tool:done', toolCall.name, toolResult);

            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolCall.id,
              content: toolResult,
            });
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.emit('tool:done', toolCall.name, `Error: ${errorMsg}`);

            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolCall.id,
              content: `Error: ${errorMsg}`,
              is_error: true,
            });
          }
        }

        // Add tool results
        session.messages.push({
          role: 'user',
          content: toolResults,
        });
      } else {
        // Non-streaming (simpler but less responsive)
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 8192,
          system: systemPrompt,
          messages: session.messages,
          tools,
        });

        // Process response
        for (const block of response.content) {
          if (block.type === 'text') {
            fullResponse = block.text;
            this.emit('text', block.text);
          } else if (block.type === 'tool_use') {
            toolsUsed.push(block.name);
            this.emit('tool:start', block.name, block.input as Record<string, unknown>);

            try {
              const result = await executeTool(
                { tool: block.name, params: block.input as Record<string, unknown> },
                toolContext
              );
              this.emit('tool:done', block.name, result);
            } catch (err) {
              this.emit('tool:done', block.name, `Error: ${err}`);
            }
          }
        }

        if (response.stop_reason !== 'tool_use') {
          break;
        }
      }
    }

    // Add final assistant response
    if (fullResponse) {
      session.messages.push({
        role: 'assistant',
        content: fullResponse,
      });
    }

    // Save session
    this.sessionManager.saveSession(sessionId);

    this.emit('text:done', fullResponse);

    const result: AgentResponse = {
      text: fullResponse,
      toolsUsed,
      sessionId,
    };

    this.emit('done', result);
    return result;
  }

  private async runStreamingTurn(
    systemPrompt: string,
    messages: MessageParam[],
    tools: Tool[],
    toolContext: ToolContext
  ): Promise<{
    text: string;
    toolCalls: Array<{ id: string; name: string; input: unknown }>;
    toolsUsed: string[];
    contentBlocks: ContentBlock[];
  }> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 8192,
      system: systemPrompt,
      messages,
      tools,
    });

    let text = '';
    const toolCalls: Array<{ id: string; name: string; input: unknown }> = [];
    const toolsUsed: string[] = [];
    const contentBlocks: ContentBlock[] = [];

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          text += event.delta.text;
          this.emit('text', event.delta.text);
        }
      } else if (event.type === 'content_block_stop') {
        // Block completed
      } else if (event.type === 'message_delta') {
        // Message metadata update
      }
    }

    // Get the final message to extract tool calls
    const finalMessage = await stream.finalMessage();

    for (const block of finalMessage.content) {
      contentBlocks.push(block);
      if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input,
        });
        toolsUsed.push(block.name);
      }
    }

    return { text, toolCalls, toolsUsed, contentBlocks };
  }
}

// Typed event emitter helper
export declare interface AgentRunner {
  on<K extends keyof AgentEvents>(event: K, listener: AgentEvents[K]): this;
  emit<K extends keyof AgentEvents>(event: K, ...args: Parameters<AgentEvents[K]>): boolean;
}
