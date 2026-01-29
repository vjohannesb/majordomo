/**
 * Providers Module
 *
 * Factory for creating AI providers based on configuration.
 */

import type { AIProvider } from './base.js';
import type { ProviderConfig, ProviderType } from './types.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { OllamaProvider } from './ollama.js';
import { ClaudeCodeProvider } from './claude-code.js';

export * from './types.js';
export * from './base.js';
export { AnthropicProvider } from './anthropic.js';
export { OpenAIProvider } from './openai.js';
export { OllamaProvider } from './ollama.js';
export { ClaudeCodeProvider } from './claude-code.js';

/**
 * Create an AI provider based on configuration
 */
export function createProvider(config: ProviderConfig): AIProvider {
  switch (config.provider) {
    case 'anthropic':
      if (!config.apiKey) {
        throw new Error('Anthropic provider requires an API key');
      }
      return new AnthropicProvider(config.apiKey, config.model);

    case 'openai':
      if (!config.apiKey) {
        throw new Error('OpenAI provider requires an API key');
      }
      return new OpenAIProvider(config.apiKey, config.model, config.baseUrl);

    case 'ollama':
      return new OllamaProvider(config.model, config.baseUrl || 'http://localhost:11434');

    case 'claude-code':
      return new ClaudeCodeProvider();

    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

/**
 * Detect available providers based on environment
 */
export async function detectAvailableProviders(): Promise<ProviderType[]> {
  const available: ProviderType[] = [];

  // Check Anthropic
  if (process.env.ANTHROPIC_API_KEY) {
    available.push('anthropic');
  }

  // Check OpenAI
  if (process.env.OPENAI_API_KEY) {
    available.push('openai');
  }

  // Check Ollama
  try {
    const response = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(1000),
    });
    if (response.ok) {
      available.push('ollama');
    }
  } catch {
    // Ollama not running
  }

  // Check Claude Code
  const claudeCode = new ClaudeCodeProvider();
  if (await claudeCode.isConfigured()) {
    available.push('claude-code');
  }

  return available;
}

/**
 * Get provider from environment variables (auto-detect)
 */
export function getProviderFromEnv(): ProviderConfig | null {
  // Priority: ANTHROPIC > OPENAI > OLLAMA > CLAUDE_CODE

  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: 'anthropic',
      authMode: 'api_key',
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL,
    };
  }

  if (process.env.OPENAI_API_KEY) {
    return {
      provider: 'openai',
      authMode: 'api_key',
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL,
    };
  }

  // For Ollama and Claude Code, we'll detect at runtime
  return null;
}
