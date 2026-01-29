/**
 * Base Provider Interface
 *
 * All AI providers must implement this interface.
 */

import type { Tool } from '@anthropic-ai/sdk/resources/messages';

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentBlock[];
}

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export interface StreamEvent {
  type: 'text' | 'tool_use' | 'done' | 'error';
  text?: string;
  toolCall?: {
    id: string;
    name: string;
    input: unknown;
  };
  error?: string;
}

export interface CompletionRequest {
  messages: Message[];
  systemPrompt?: string;
  tools?: ToolDefinition[];
  maxTokens?: number;
  stream?: boolean;
}

export interface CompletionResponse {
  content: ContentBlock[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error';
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;

  /**
   * Check if the provider is properly configured
   */
  isConfigured(): Promise<boolean>;

  /**
   * Run a completion (non-streaming)
   */
  complete(request: CompletionRequest): Promise<CompletionResponse>;

  /**
   * Run a streaming completion
   */
  stream(request: CompletionRequest): AsyncGenerator<StreamEvent>;
}
