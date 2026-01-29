/**
 * Ollama Provider
 *
 * Uses local Ollama server for running models locally.
 * No API key required - completely free.
 */

import type { AIProvider, CompletionRequest, CompletionResponse, StreamEvent, ContentBlock, Message, ToolDefinition } from './base.js';

export class OllamaProvider implements AIProvider {
  readonly name = 'Ollama';
  readonly model: string;
  private baseUrl: string;

  constructor(model?: string, baseUrl?: string) {
    this.model = model || 'llama3.2';
    this.baseUrl = baseUrl || 'http://localhost:11434';
  }

  async isConfigured(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const messages = this.convertMessages(request.messages, request.systemPrompt);

    // Ollama supports OpenAI-compatible API
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        tools: request.tools ? this.convertTools(request.tools) : undefined,
        stream: false,
      }),
    });

    if (!response.ok) {
      // Fall back to native Ollama API if OpenAI compat not available
      return this.completeNative(request);
    }

    const data = await response.json() as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: Array<{
            id: string;
            function: { name: string; arguments: string };
          }>;
        };
        finish_reason: string;
      }>;
    };

    const choice = data.choices[0];
    if (!choice) throw new Error('No response from Ollama');

    const content: ContentBlock[] = [];

    if (choice.message.content) {
      content.push({ type: 'text', text: choice.message.content });
    }

    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        });
      }
    }

    return {
      content,
      stopReason: choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
    };
  }

  private async completeNative(request: CompletionRequest): Promise<CompletionResponse> {
    // Native Ollama API (no tool support)
    const messages = this.convertMessagesNative(request.messages, request.systemPrompt);

    // Add tool descriptions to system prompt if tools provided
    let systemContent = request.systemPrompt || '';
    if (request.tools && request.tools.length > 0) {
      systemContent += '\n\nYou have access to the following tools. To use a tool, respond with JSON in this format:\n';
      systemContent += '{"tool": "tool_name", "params": {...}}\n\n';
      systemContent += 'Available tools:\n';
      for (const tool of request.tools) {
        systemContent += `- ${tool.name}: ${tool.description}\n`;
      }
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [
          ...(systemContent ? [{ role: 'system', content: systemContent }] : []),
          ...messages,
        ],
        stream: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${error}`);
    }

    const data = await response.json() as {
      message: { content: string };
    };

    // Try to parse tool calls from response
    const content: ContentBlock[] = [];
    const text = data.message.content;

    // Check if response is a tool call JSON
    try {
      const toolMatch = text.match(/\{[\s\S]*"tool"[\s\S]*\}/);
      if (toolMatch) {
        const toolCall = JSON.parse(toolMatch[0]) as { tool: string; params: unknown };
        content.push({
          type: 'tool_use',
          id: `tool_${Date.now()}`,
          name: toolCall.tool,
          input: toolCall.params,
        });
        return { content, stopReason: 'tool_use' };
      }
    } catch {
      // Not a tool call
    }

    content.push({ type: 'text', text });
    return { content, stopReason: 'end_turn' };
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamEvent> {
    const messages = this.convertMessagesNative(request.messages, request.systemPrompt);

    let systemContent = request.systemPrompt || '';
    if (request.tools && request.tools.length > 0) {
      systemContent += '\n\nYou have access to tools. To use a tool, respond with JSON: {"tool": "name", "params": {...}}\n';
      systemContent += 'Available tools:\n';
      for (const tool of request.tools) {
        systemContent += `- ${tool.name}: ${tool.description}\n`;
      }
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [
          ...(systemContent ? [{ role: 'system', content: systemContent }] : []),
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      yield { type: 'error', error: `Ollama API error: ${error}` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as { message?: { content: string }; done: boolean };
          if (parsed.message?.content) {
            yield { type: 'text', text: parsed.message.content };
            fullText += parsed.message.content;
          }
        } catch {
          // Ignore parse errors
        }
      }
    }

    // Check if the full response was a tool call
    try {
      const toolMatch = fullText.match(/\{[\s\S]*"tool"[\s\S]*\}/);
      if (toolMatch) {
        const toolCall = JSON.parse(toolMatch[0]) as { tool: string; params: unknown };
        yield {
          type: 'tool_use',
          toolCall: {
            id: `tool_${Date.now()}`,
            name: toolCall.tool,
            input: toolCall.params,
          },
        };
      }
    } catch {
      // Not a tool call
    }

    yield { type: 'done' };
  }

  private convertMessages(messages: Message[], systemPrompt?: string): Array<{ role: string; content: string }> {
    const result: Array<{ role: string; content: string }> = [];

    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }

    for (const m of messages) {
      if (typeof m.content === 'string') {
        result.push({ role: m.role, content: m.content });
      } else {
        const text = m.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('');
        if (text) {
          result.push({ role: m.role, content: text });
        }
      }
    }

    return result;
  }

  private convertMessagesNative(messages: Message[], _systemPrompt?: string): Array<{ role: string; content: string }> {
    return messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content :
          m.content.filter(b => b.type === 'text').map(b => b.text).join(''),
      }));
  }

  private convertTools(tools: ToolDefinition[]) {
    return tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }
}
