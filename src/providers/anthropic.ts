/**
 * Anthropic Provider
 *
 * Uses the Anthropic SDK for Claude models.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ContentBlock as AnthropicContentBlock } from '@anthropic-ai/sdk/resources/messages';
import type { AIProvider, CompletionRequest, CompletionResponse, StreamEvent, ContentBlock, Message } from './base.js';

export class AnthropicProvider implements AIProvider {
  readonly name = 'Anthropic';
  readonly model: string;
  private client: Anthropic;

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model || 'claude-sonnet-4-20250514';
  }

  async isConfigured(): Promise<boolean> {
    try {
      // Try a minimal request to verify the key works
      await this.client.messages.create({
        model: this.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      });
      return true;
    } catch {
      return false;
    }
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: request.maxTokens || 8192,
      system: request.systemPrompt,
      messages: this.convertMessages(request.messages),
      tools: request.tools as Anthropic.Tool[],
    });

    return {
      content: response.content.map(this.convertContentBlock),
      stopReason: response.stop_reason === 'tool_use' ? 'tool_use' :
                  response.stop_reason === 'max_tokens' ? 'max_tokens' : 'end_turn',
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamEvent> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: request.maxTokens || 8192,
      system: request.systemPrompt,
      messages: this.convertMessages(request.messages),
      tools: request.tools as Anthropic.Tool[],
    });

    let currentToolUse: { id: string; name: string; input: string } | null = null;

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'tool_use') {
          currentToolUse = {
            id: event.content_block.id,
            name: event.content_block.name,
            input: '',
          };
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          yield { type: 'text', text: event.delta.text };
        } else if (event.delta.type === 'input_json_delta' && currentToolUse) {
          currentToolUse.input += event.delta.partial_json;
        }
      } else if (event.type === 'content_block_stop') {
        if (currentToolUse) {
          try {
            const input = JSON.parse(currentToolUse.input || '{}');
            yield {
              type: 'tool_use',
              toolCall: {
                id: currentToolUse.id,
                name: currentToolUse.name,
                input,
              },
            };
          } catch {
            yield {
              type: 'tool_use',
              toolCall: {
                id: currentToolUse.id,
                name: currentToolUse.name,
                input: {},
              },
            };
          }
          currentToolUse = null;
        }
      }
    }

    yield { type: 'done' };
  }

  private convertMessages(messages: Message[]): MessageParam[] {
    return messages
      .filter(m => m.role !== 'system') // System is handled separately
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : m.content as AnthropicContentBlock[],
      }));
  }

  private convertContentBlock(block: AnthropicContentBlock): ContentBlock {
    if (block.type === 'text') {
      return { type: 'text', text: block.text };
    } else if (block.type === 'tool_use') {
      return {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.input,
      };
    }
    return { type: 'text', text: '' };
  }
}
