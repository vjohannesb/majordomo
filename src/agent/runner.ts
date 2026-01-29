/**
 * Agent Runner - Multi-Provider AI Integration
 *
 * Runs completions via any configured provider (Anthropic, OpenAI, Ollama, Claude Code).
 * Handles streaming, tool execution, and session management.
 */

import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadConfig } from '../config.js';
import { AVAILABLE_TOOLS, executeTool, type ToolCall } from '../core/tools.js';
import { createToolContext, type ToolContext } from '../core/accounts.js';
import { SessionManager, type Session } from './session.js';
import { buildSystemPrompt } from './system-prompt.js';
import {
  createProvider,
  type AIProvider,
  type Message,
  type ContentBlock,
  type ToolDefinition,
  type StreamEvent,
  type ProviderConfig,
} from '../providers/index.js';

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

// Convert our tool format to provider format
function convertToolsToProvider(): ToolDefinition[] {
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
  private provider: AIProvider;
  private sessionManager: SessionManager;
  private toolContext: ToolContext | null = null;

  constructor(providerOrConfig?: AIProvider | ProviderConfig) {
    super();

    if (providerOrConfig && 'complete' in providerOrConfig) {
      // It's an AIProvider instance
      this.provider = providerOrConfig;
    } else if (providerOrConfig) {
      // It's a ProviderConfig
      this.provider = createProvider(providerOrConfig);
    } else {
      // Try to auto-detect from config or environment
      this.provider = this.initializeProvider();
    }

    this.sessionManager = new SessionManager();
  }

  private initializeProvider(): AIProvider {
    // Priority: Config file > Environment variables > Error
    const config = loadConfigSync();

    if (config?.provider) {
      return createProvider(config.provider);
    }

    // Fall back to environment-based detection
    if (process.env.ANTHROPIC_API_KEY) {
      return createProvider({
        provider: 'anthropic',
        authMode: 'api_key',
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: process.env.ANTHROPIC_MODEL,
      });
    }

    if (process.env.OPENAI_API_KEY) {
      return createProvider({
        provider: 'openai',
        authMode: 'api_key',
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL,
      });
    }

    throw new Error(
      'No AI provider configured. Run `majordomo --setup` to configure a provider, ' +
      'or set ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable.'
    );
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
    const tools = convertToolsToProvider();
    const toolContext = await this.getToolContext();

    let fullResponse = '';
    const toolsUsed: string[] = [];
    let turns = 0;

    // Convert session messages to provider format
    const providerMessages: Message[] = session.messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content as string | ContentBlock[],
    }));

    while (turns < maxTurns) {
      turns++;

      if (stream) {
        const result = await this.runStreamingTurn(
          systemPrompt,
          providerMessages,
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
        providerMessages.push({
          role: 'assistant',
          content: result.contentBlocks,
        });

        // Execute tools and add results
        const toolResults: ContentBlock[] = [];
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

        // Add tool results as user message
        providerMessages.push({
          role: 'user',
          content: toolResults,
        });
      } else {
        // Non-streaming
        const response = await this.provider.complete({
          messages: providerMessages,
          systemPrompt,
          tools,
          maxTokens: 8192,
        });

        // Process response
        for (const block of response.content) {
          if (block.type === 'text' && block.text) {
            fullResponse = block.text;
            this.emit('text', block.text);
          } else if (block.type === 'tool_use' && block.id && block.name) {
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

        if (response.stopReason !== 'tool_use') {
          break;
        }
      }
    }

    // Update session with final messages
    session.messages = providerMessages.map((m) => ({
      role: m.role,
      content: m.content,
    })) as typeof session.messages;

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
    messages: Message[],
    tools: ToolDefinition[],
    toolContext: ToolContext
  ): Promise<{
    text: string;
    toolCalls: Array<{ id: string; name: string; input: unknown }>;
    toolsUsed: string[];
    contentBlocks: ContentBlock[];
  }> {
    let text = '';
    const toolCalls: Array<{ id: string; name: string; input: unknown }> = [];
    const toolsUsed: string[] = [];
    const contentBlocks: ContentBlock[] = [];

    for await (const event of this.provider.stream({
      messages,
      systemPrompt,
      tools,
      maxTokens: 8192,
    })) {
      switch (event.type) {
        case 'text':
          if (event.text) {
            text += event.text;
            this.emit('text', event.text);
          }
          break;

        case 'tool_use':
          if (event.toolCall) {
            toolCalls.push({
              id: event.toolCall.id,
              name: event.toolCall.name,
              input: event.toolCall.input,
            });
            toolsUsed.push(event.toolCall.name);
            contentBlocks.push({
              type: 'tool_use',
              id: event.toolCall.id,
              name: event.toolCall.name,
              input: event.toolCall.input,
            });
          }
          break;

        case 'error':
          this.emit('error', new Error(event.error || 'Unknown streaming error'));
          break;

        case 'done':
          // Stream complete
          break;
      }
    }

    // Add text content block if present
    if (text) {
      contentBlocks.unshift({ type: 'text', text });
    }

    return { text, toolCalls, toolsUsed, contentBlocks };
  }

  get providerName(): string {
    return this.provider.name;
  }

  get modelName(): string {
    return this.provider.model;
  }
}

// Synchronous config loader (for constructor)
function loadConfigSync() {
  try {
    const configPath = join(homedir(), '.majordomo', 'config.json');
    const content = readFileSync(configPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// Typed event emitter helper
export declare interface AgentRunner {
  on<K extends keyof AgentEvents>(event: K, listener: AgentEvents[K]): this;
  emit<K extends keyof AgentEvents>(event: K, ...args: Parameters<AgentEvents[K]>): boolean;
}
